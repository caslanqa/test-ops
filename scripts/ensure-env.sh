#!/usr/bin/env bash
# Creates .env from .env.example if it does not exist; if JWT_SECRET is empty or
# still the example value, generates a random secret. Because the app refuses to
# start in production with a default/short secret (apps/api/src/config/jwt-secret.ts),
# start.sh runs this step on every invocation. Leaves the file untouched when a
# valid secret is already set.
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
  # mktemp creates the file with 600 permissions, which is what we want since .env holds a secret.
  tmp="$(mktemp .env.XXXXXX)"
  awk -v s="$secret" '/^JWT_SECRET=/ { print "JWT_SECRET=" s; next } { print }' .env > "$tmp"
  mv "$tmp" .env
else
  printf '\nJWT_SECRET=%s\n' "$secret" >> .env
fi
echo ".env: generated a random JWT_SECRET (existing sessions are invalidated; sign in again)."
