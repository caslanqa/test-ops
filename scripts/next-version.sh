#!/usr/bin/env bash
# Computes the next version from the latest `vX.Y.Z` tag and the commit messages
# since that tag; writes the result in GitHub Actions output format
# (`version=X.Y.Z`, `skip=true|false`). Used by release.yml.
#
#   - No version tag at all: `version` from package.json (first release)
#   - `BREAKING CHANGE:` line or `type!:` prefix  → major
#   - `feat:` / `feat(scope):` prefix             → minor
#   - anything else                               → patch
#   - HEAD already has a version tag              → skip=true (re-run)
#
# Prerelease tags (e.g. v1.0.0-rc.1) are ignored.
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
