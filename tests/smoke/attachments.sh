#!/usr/bin/env bash
# Attachment security smoke test (FR-045/FR-046, design-doc section 8).
# Runs against a running compose stack and creates its own data:
#   docker compose up -d --wait && docker compose exec -T app node prisma/seed.js
#   bash tests/smoke/attachments.sh
# The target can be changed with the BASE, ADMIN_EMAIL and ADMIN_PASSWORD env vars.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@testops.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-ChangeMe123!}"
BASE="${BASE:-http://localhost:8080/api/v1}"
W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT
fail=0
sfx="$(date +%s)"

# macOS has no sha256sum, and shasum is not always installed on Linux runners.
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
# The non-ASCII (Turkish) file name is deliberate: it exercises UTF-8 file name handling
# on upload and the RFC 6266 filename* header asserted below (downloads used to return 500).
cp "$W/shot.png" "$W/ekran görüntüsü şğı.png"
echo "MZ" > "$W/tool.exe"
echo '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' > "$W/x.svg"
echo "noext" > "$W/README"
head -c $((33 * 1024 * 1024)) /dev/zero > "$W/big.log"
head -c $((30 * 1024 * 1024)) /dev/zero > "$W/part.log"

echo "--- Accepted ---"
upload "upload a png with Turkish characters in its name" 201 -F "files=@$W/ekran görüntüsü şğı.png;type=text/html"
AID="$(j '[0].id' < "$W/out.json")"
check "image/png stored instead of the client-declared text/html" "image/png" "$(j '[0].mimeType' < "$W/out.json")"
check "checksum is correct" "$(sha256 "$W/shot.png")" "$(j '[0].checksumSha256' < "$W/out.json")"
code="$(curl -s -D "$W/h.txt" -o "$W/dl.bin" -w '%{http_code}' "$BASE/projects/$PID/attachments/$AID" -H "authorization: Bearer $TOKEN")"
check "download a file with a Turkish name (used to return 500)" 200 "$code"
LC_ALL=C grep -aqi "filename\*=UTF-8''ekran%20g%C3%B6r%C3%BCnt%C3%BCs%C3%BC%20%C5%9F%C4%9F%C4%B1.png" "$W/h.txt" && check "Content-Disposition RFC 6266 filename*" ok ok || check "Content-Disposition RFC 6266 filename*" ok "$(grep -i disposition "$W/h.txt")"
check "Content-Type from the extension" "image/png" "$(grep -i '^content-type' "$W/h.txt" | tr -d '\r' | cut -d' ' -f2 | cut -d';' -f1)"
check "nosniff header" "nosniff" "$(grep -i '^x-content-type-options' "$W/h.txt" | tr -d '\r' | cut -d' ' -f2)"
check "downloaded content is identical" "$(sha256 "$W/shot.png")" "$(sha256 "$W/dl.bin")"

echo "--- Rejected ---"
upload ".exe rejected" 415 -F "files=@$W/tool.exe"
upload ".svg rejected (not in the default list)" 415 -F "files=@$W/x.svg"
upload "file without an extension rejected" 415 -F "files=@$W/README"
upload "mixed valid + invalid request is rejected as a whole" 415 -F "files=@$W/shot.png" -F "files=@$W/tool.exe"
upload "33 MB single file (limit 32 MB)" 413 -F "files=@$W/big.log"
args=(); for _ in $(seq 1 21); do args+=(-F "files=@$W/shot.png"); done
upload "21 files (limit 20)" 400 "${args[@]}"
args=(); for _ in $(seq 1 5); do args+=(-F "files=@$W/part.log"); done
start=$(date +%s)
upload "5×30 MB = 150 MB total (limit 128 MB), without reading the body" 413 "${args[@]}"
check "early rejection (<5 s)" yes "$([ $(( $(date +%s) - start )) -lt 5 ] && echo yes || echo no)"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/projects/$PID/results/$RID/attachments" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}')"
check "non-multipart request (used to return 500)" 400 "$code"

echo "--- Temporary directory cleanup ---"
leftover="$(docker compose exec -T app sh -c 'ls -A /data/attachments/.tmp | wc -l' | tr -d ' ')"
check "no temporary files left from rejected uploads" 0 "$leftover"

echo
[ "$fail" -eq 0 ] && echo "ALL PASSED" || echo "$fail CHECKS FAILED"
exit "$fail"
