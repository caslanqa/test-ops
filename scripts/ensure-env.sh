#!/usr/bin/env bash
# Creates .env from .env.example if it does not exist, then fills the two secrets the app needs:
#  - JWT_SECRET, when empty or still the example value. The app refuses to start in production
#    with a default/short secret (apps/api/src/config/jwt-secret.ts).
#  - AI_ENCRYPTION_KEY, when empty. AI provider keys saved in the app are encrypted with it.
# start.sh runs this step on every invocation. A secret that is already set is never replaced: a
# new JWT_SECRET signs everyone out, and a new AI_ENCRYPTION_KEY makes the saved provider keys
# unreadable.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

[ -f .env ] || cp .env.example .env

random_hex() {
  if command -v openssl > /dev/null 2>&1; then
    openssl rand -hex 32
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

# The value of NAME in .env (last occurrence wins, surrounding double quotes removed).
value_of() {
  local value
  value="$(grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- || true)"
  value="${value%\"}"
  value="${value#\"}"
  printf '%s' "$value"
}

# Puts NAME=<random secret> in .env: replaces the line if there is one, appends it otherwise.
set_secret() {
  local tmp secret
  secret="$(random_hex)"
  if grep -qE "^$1=" .env; then
    # mktemp creates the file with 600 permissions, which is what we want since .env holds secrets.
    tmp="$(mktemp .env.XXXXXX)"
    awk -v name="$1" -v secret="$secret" 'index($0, name "=") == 1 { print name "=" secret; next } { print }' .env > "$tmp"
    mv "$tmp" .env
  else
    printf '\n%s=%s\n' "$1" "$secret" >> .env
  fi
}

case "$(value_of JWT_SECRET)" in
  "" | "change-me-in-production")
    set_secret JWT_SECRET
    echo ".env: generated a random JWT_SECRET (existing sessions are invalidated; sign in again)."
    ;;
esac

if [ -z "$(value_of AI_ENCRYPTION_KEY)" ]; then
  set_secret AI_ENCRYPTION_KEY
  echo ".env: generated a random AI_ENCRYPTION_KEY (saved AI provider keys need it; keep a copy of .env)."
fi
