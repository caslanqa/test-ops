#!/bin/sh
# Container startup: checks the prerequisite with a clear message, retries the
# migration until the database is ready and starts the app as PID 1.
# Thanks to `exec`, `docker stop`'s SIGTERM reaches Node without getting stuck in sh.
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

# When started with `docker run` right after Postgres, the DB may not be accepting
# connections yet; in compose, depends_on already waits for this.
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
