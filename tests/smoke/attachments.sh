#!/usr/bin/env bash
# Attachment güvenliği smoke testi (FR-045/FR-046, design-doc bölüm 8).
# Çalışan bir compose stack'ine karşı koşar ve kendi verisini oluşturur:
#   docker compose up -d --wait && docker compose exec -T app node prisma/seed.js
#   bash tests/smoke/attachments.sh
# BASE, ADMIN_EMAIL, ADMIN_PASSWORD env'leri ile hedef değiştirilebilir.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@testops.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-ChangeMe123!}"
BASE="${BASE:-http://localhost:8080/api/v1}"
W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT
fail=0
sfx="$(date +%s)"

# macOS'ta sha256sum yok, Linux runner'larda shasum her zaman kurulu değil.
sha256() { if command -v sha256sum > /dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
j() { node -pe "JSON.parse(require('fs').readFileSync(0))$1"; }
api() { curl -s -X "$1" "$BASE$2" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' ${3:+-d "$3"}; }
check() { # label expected actual
  if [ "$2" = "$3" ]; then echo "PASS [$3] $1"; else echo "FAIL [$3 != $2] $1"; fail=$((fail + 1)); fi
}
upload() { # label expected curl-form-args...
  local label="$1" expected="$2"; shift 2
  local code
  code="$(curl -s -o "$W/out.json" -w '%{http_code}' -X POST "$BASE/projects/$PID/results/$RID/attachments" -H "authorization: Bearer $TOKEN" "$@")"
  check "$label" "$expected" "$code"
}

TOKEN="$(curl -s -X POST "$BASE/auth/login" -H 'content-type: application/json' -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | j .accessToken)"
WS="$(api POST /workspaces "{\"name\":\"Att\",\"slug\":\"att-$sfx\"}" | j .id)"
PID="$(api POST "/workspaces/$WS/projects" '{"key":"ATT","name":"Att"}' | j .id)"
CID="$(api POST "/projects/$PID/cases" '{"title":"c"}' | j .id)"
RUN="$(api POST "/projects/$PID/runs" "{\"title\":\"r\",\"testCaseIds\":[\"$CID\"]}" | j .id)"
RID="$(api POST "/projects/$PID/runs/$RUN/results" "{\"testCaseId\":\"$CID\",\"status\":\"FAILED\"}" | j .id)"

printf '\x89PNG\r\n\x1a\nfake-png-body' > "$W/shot.png"
cp "$W/shot.png" "$W/ekran görüntüsü şğı.png"
echo "MZ" > "$W/tool.exe"
echo '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' > "$W/x.svg"
echo "noext" > "$W/README"
head -c $((33 * 1024 * 1024)) /dev/zero > "$W/big.log"
head -c $((30 * 1024 * 1024)) /dev/zero > "$W/part.log"

echo "--- Kabul edilenler ---"
upload "Türkçe karakterli png yükleme" 201 -F "files=@$W/ekran görüntüsü şğı.png;type=text/html"
AID="$(j '[0].id' < "$W/out.json")"
check "istemcinin bildirdiği text/html yerine image/png saklandı" "image/png" "$(j '[0].mimeType' < "$W/out.json")"
check "checksum doğru" "$(sha256 "$W/shot.png")" "$(j '[0].checksumSha256' < "$W/out.json")"
code="$(curl -s -D "$W/h.txt" -o "$W/dl.bin" -w '%{http_code}' "$BASE/projects/$PID/attachments/$AID" -H "authorization: Bearer $TOKEN")"
check "Türkçe adlı dosyayı indirme (eskiden 500)" 200 "$code"
LC_ALL=C grep -aqi "filename\*=UTF-8''ekran%20g%C3%B6r%C3%BCnt%C3%BCs%C3%BC%20%C5%9F%C4%9F%C4%B1.png" "$W/h.txt" && check "Content-Disposition RFC 6266 filename*" ok ok || check "Content-Disposition RFC 6266 filename*" ok "$(grep -i disposition "$W/h.txt")"
check "Content-Type uzantıdan" "image/png" "$(grep -i '^content-type' "$W/h.txt" | tr -d '\r' | cut -d' ' -f2 | cut -d';' -f1)"
check "nosniff header" "nosniff" "$(grep -i '^x-content-type-options' "$W/h.txt" | tr -d '\r' | cut -d' ' -f2)"
check "indirilen içerik aynı" "$(sha256 "$W/shot.png")" "$(sha256 "$W/dl.bin")"

echo "--- Reddedilenler ---"
upload ".exe reddi" 415 -F "files=@$W/tool.exe"
upload ".svg reddi (varsayılan listede yok)" 415 -F "files=@$W/x.svg"
upload "uzantısız dosya reddi" 415 -F "files=@$W/README"
upload "geçerli + geçersiz karışık istek tümden reddedilir" 415 -F "files=@$W/shot.png" -F "files=@$W/tool.exe"
upload "33 MB tek dosya (limit 32 MB)" 413 -F "files=@$W/big.log"
args=(); for _ in $(seq 1 21); do args+=(-F "files=@$W/shot.png"); done
upload "21 dosya (limit 20)" 400 "${args[@]}"
args=(); for _ in $(seq 1 5); do args+=(-F "files=@$W/part.log"); done
start=$(date +%s)
upload "5×30 MB = 150 MB toplam (limit 128 MB), gövde okunmadan" 413 "${args[@]}"
check "erken red (<5 sn)" yes "$([ $(( $(date +%s) - start )) -lt 5 ] && echo yes || echo no)"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/projects/$PID/results/$RID/attachments" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}')"
check "multipart olmayan istek (eskiden 500)" 400 "$code"

echo "--- Geçici dizin temizliği ---"
leftover="$(docker compose exec -T app sh -c 'ls -A /data/attachments/.tmp | wc -l' | tr -d ' ')"
check "reddedilen yüklemelerden geçici dosya kalmadı" 0 "$leftover"

echo
[ "$fail" -eq 0 ] && echo "TÜMÜ GEÇTİ" || echo "$fail BAŞARISIZ"
exit "$fail"
