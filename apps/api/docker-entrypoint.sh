#!/bin/sh
# Container başlangıcı: önkoşulu açık bir mesajla kontrol eder, veritabanı hazır
# olana kadar migration'ı yeniden dener ve uygulamayı PID 1 olarak başlatır.
# `exec` sayesinde `docker stop`un SIGTERM'i araya giren sh'a takılmadan Node'a ulaşır.
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  cat >&2 <<'EOF'
TestOps: DATABASE_URL is not set.
TestOps needs a PostgreSQL database. The easiest way to run it is Docker Compose,
which starts PostgreSQL and sets DATABASE_URL for you:
  https://github.com/caslanqa/test-ops#readme
EOF
  exit 1
fi

# `docker run` ile Postgres'ten hemen sonra başlatıldığında DB henüz bağlantı kabul
# etmiyor olabilir; compose'da depends_on bunu zaten bekler.
attempts="${DB_WAIT_ATTEMPTS:-30}"
i=1
until node_modules/.bin/prisma migrate deploy; do
  if [ "$i" -ge "$attempts" ]; then
    echo "TestOps: database migration failed after $attempts attempts; check DATABASE_URL and that PostgreSQL is reachable." >&2
    exit 1
  fi
  echo "TestOps: database not ready (attempt $i/$attempts), retrying in 2 s..." >&2
  i=$((i + 1))
  sleep 2
done

exec node dist/main.js
