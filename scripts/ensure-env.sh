#!/usr/bin/env bash
# .env yoksa .env.example'dan oluşturur; JWT_SECRET boş veya örnek değerdeyse
# rastgele bir secret üretir. Uygulama production'da varsayılan/kısa secret ile
# başlamayı reddettiği için (apps/api/src/config/jwt-secret.ts) start.sh bu adımı
# her çalıştırmada uygular. Geçerli bir secret varsa dosyaya dokunmaz.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

[ -f .env ] || cp .env.example .env

current="$(grep -E '^JWT_SECRET=' .env | tail -n 1 | cut -d= -f2- || true)"
current="${current%\"}"
current="${current#\"}"
case "$current" in
  "" | "change-me-in-production") ;;
  *) exit 0 ;;
esac

if command -v openssl > /dev/null 2>&1; then
  secret="$(openssl rand -hex 32)"
else
  secret="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
fi

if grep -qE '^JWT_SECRET=' .env; then
  # mktemp dosyası 600 izinle oluşur; .env secret içerdiği için bu istenen durum.
  tmp="$(mktemp .env.XXXXXX)"
  awk -v s="$secret" '/^JWT_SECRET=/ { print "JWT_SECRET=" s; next } { print }' .env > "$tmp"
  mv "$tmp" .env
else
  printf '\nJWT_SECRET=%s\n' "$secret" >> .env
fi
echo ".env: generated a random JWT_SECRET (existing sessions are invalidated; sign in again)."
