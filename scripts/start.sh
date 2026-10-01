#!/usr/bin/env bash
# Tek komutla TestOps'u ayağa kaldırır: .env hazırlar, tek imajı build edip
# compose stack'i başlatır, uygulama hazır olana kadar bekler, demo veriyi
# seed eder ve arayüzü tarayıcıda açar.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

bash scripts/ensure-env.sh

APP_PORT="$(grep -E '^APP_PORT=' .env | cut -d= -f2 || true)"
APP_PORT="${APP_PORT:-8080}"
APP_URL="http://localhost:${APP_PORT}"

docker compose up -d --build

echo "Uygulama hazır olana kadar bekleniyor..."
ready=false
for _ in $(seq 1 60); do
  if curl -sf "${APP_URL}/ready" > /dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done

# Uygulama başlamayı reddettiyse (ör. geçersiz JWT_SECRET) sebebi görünür olsun.
if [ "$ready" != true ]; then
  echo "Uygulama 120 sn içinde hazır olmadı. Son loglar:" >&2
  docker compose logs --tail 40 app >&2
  exit 1
fi

docker compose exec -T app node prisma/seed.js || true

echo "Hazır: $APP_URL (admin@testops.local / ChangeMe123!)"

if command -v open > /dev/null 2>&1; then
  open "$APP_URL"
elif command -v xdg-open > /dev/null 2>&1; then
  xdg-open "$APP_URL"
fi
