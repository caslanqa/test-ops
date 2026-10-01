#!/usr/bin/env bash
# Bir sonraki sürümü son `vX.Y.Z` tag'inden ve o tag'den bu yana gelen commit
# mesajlarından hesaplar; çıktıyı GitHub Actions output biçiminde yazar
# (`version=X.Y.Z`, `skip=true|false`). release.yml tarafından kullanılır.
#
#   - Hiç sürüm tag'i yoksa: package.json'daki `version` (ilk sürüm)
#   - `BREAKING CHANGE:` satırı veya `type!:` öneki → major
#   - `feat:` / `feat(scope):` öneki                 → minor
#   - diğer her şey                                   → patch
#   - HEAD zaten sürüm tag'liyse                      → skip=true (tekrar çalıştırma)
#
# Prerelease tag'leri (ör. v1.0.0-rc.1) hesaba katılmaz.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

release_tags() {
  git tag --list 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true
}

existing="$(git tag --points-at HEAD --list 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1 || true)"
if [ -n "$existing" ]; then
  echo "version=${existing#v}"
  echo "skip=true"
  exit 0
fi

last="$(release_tags | head -n 1)"
if [ -z "$last" ]; then
  version="$(node -p 'require("./package.json").version')"
else
  IFS=. read -r major minor patch <<< "${last#v}"
  log="$(git log --format='%s%n%b' "${last}..HEAD")"
  if grep -qE '^[[:space:]]*BREAKING[ -]CHANGE:|^[a-z]+(\([^)]*\))?!:' <<< "$log"; then
    major=$((major + 1)); minor=0; patch=0
  elif grep -qE '^feat(\([^)]*\))?:' <<< "$log"; then
    minor=$((minor + 1)); patch=0
  else
    patch=$((patch + 1))
  fi
  version="${major}.${minor}.${patch}"
fi

echo "version=${version}"
echo "skip=false"
