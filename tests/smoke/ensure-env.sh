#!/usr/bin/env bash
# Checks scripts/ensure-env.sh in a throwaway tree, so the real .env is never touched:
# a fresh .env gets both secrets, a second run changes nothing, an existing install gains the
# AI_ENCRYPTION_KEY without losing its JWT_SECRET, and a key that is set is never replaced
# (a new one would make every saved AI provider key unreadable).
#   bash tests/smoke/ensure-env.sh
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/scripts"
cp "$repo/scripts/ensure-env.sh" "$tmp/scripts/"
cp "$repo/.env.example" "$tmp/.env.example"

failures=0
check() {
  if [ "$2" = true ]; then
    echo "PASS $1"
  else
    echo "FAIL $1"
    failures=$((failures + 1))
  fi
}
is_true() { if "$@"; then echo true; else echo false; fi; }
value() { (grep -E "^$1=" "$tmp/.env" || true) | tail -n 1 | cut -d= -f2-; }
is_hex64() { [[ "$1" =~ ^[0-9a-f]{64}$ ]]; }
run() { (cd "$tmp" && bash scripts/ensure-env.sh) > /dev/null; }

run
jwt="$(value JWT_SECRET)"
key="$(value AI_ENCRYPTION_KEY)"
check "a fresh .env gets a 64-character JWT_SECRET" "$(is_true is_hex64 "$jwt")"
check "a fresh .env gets a 64-character AI_ENCRYPTION_KEY" "$(is_true is_hex64 "$key")"
check "the two secrets differ" "$(is_true test "$jwt" != "$key")"

cp "$tmp/.env" "$tmp/first.env"
run
check "a second run changes nothing" "$(is_true cmp -s "$tmp/.env" "$tmp/first.env")"

# An installation from before the AI assistant: a valid JWT_SECRET and no key.
grep -v '^AI_ENCRYPTION_KEY=' "$tmp/first.env" > "$tmp/.env"
run
check "an existing .env gains an AI_ENCRYPTION_KEY" "$(is_true is_hex64 "$(value AI_ENCRYPTION_KEY)")"
check "...and keeps its JWT_SECRET" "$(is_true test "$(value JWT_SECRET)" = "$jwt")"

fixed="$(printf '%064d' 0 | tr 0 a)"
{ grep -v '^AI_ENCRYPTION_KEY=' "$tmp/first.env"; echo "AI_ENCRYPTION_KEY=$fixed"; } > "$tmp/.env"
run
check "a key that is set is kept" "$(is_true test "$(value AI_ENCRYPTION_KEY)" = "$fixed")"

# The placeholder JWT_SECRET is replaced; the AI key beside it is not.
{ grep -v '^JWT_SECRET=' "$tmp/.env"; echo "JWT_SECRET=change-me-in-production"; } > "$tmp/.env.next"
mv "$tmp/.env.next" "$tmp/.env"
run
check "a placeholder JWT_SECRET is replaced" "$(is_true is_hex64 "$(value JWT_SECRET)")"
check "...while the AI_ENCRYPTION_KEY stays" "$(is_true test "$(value AI_ENCRYPTION_KEY)" = "$fixed")"

# Someone running the API outside Docker copies apps/api/.env.example, so it names the key too.
check "apps/api/.env.example names AI_ENCRYPTION_KEY" "$(is_true grep -q '^AI_ENCRYPTION_KEY=' "$repo/apps/api/.env.example")"

[ "$failures" -eq 0 ] || { echo "$failures check(s) failed"; exit 1; }
echo "All checks passed"
