#!/usr/bin/env bash
# Brings TestOps up with a single command: prepares .env, builds the single image
# and starts the compose stack, waits until the app is ready, seeds the demo data
# and opens the UI in the browser.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

bash scripts/ensure-env.sh

APP_PORT="$(grep -E '^APP_PORT=' .env | cut -d= -f2 || true)"
APP_PORT="${APP_PORT:-8080}"
APP_URL="http://localhost:${APP_PORT}"

docker compose up -d --build

echo "Waiting for the app to become ready..."
ready=false
for _ in $(seq 1 60); do
  if curl -sf "${APP_URL}/ready" > /dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done

# If the app refused to start (e.g. invalid JWT_SECRET), make the reason visible.
if [ "$ready" != true ]; then
  echo "The app did not become ready within 120 s. Latest logs:" >&2
  docker compose logs --tail 40 app >&2
  exit 1
fi

docker compose exec -T app node prisma/seed.js || true

# The seed prints the login credentials (or says the password was left unchanged if the user already existed).
echo "Ready: $APP_URL"

if command -v open > /dev/null 2>&1; then
  open "$APP_URL"
elif command -v xdg-open > /dev/null 2>&1; then
  xdg-open "$APP_URL"
fi
