#!/usr/bin/env bash
# TestOps installer and upgrader.
#
#   curl -fsSL https://raw.githubusercontent.com/caslanqa/test-ops/master/install.sh | bash
#
# First run: creates the install directory, downloads docker-compose.yml, writes .env
# with random secrets, starts PostgreSQL + TestOps and creates the first admin account.
# Later runs upgrade the install: they refresh docker-compose.yml, pull the newer image
# and restart. Existing secrets and data are never changed.
#
# Options (environment variables, e.g. `curl -fsSL ... | TESTOPS_PORT=9090 bash`):
#   TESTOPS_DIR          install directory                     (default: ~/testops)
#   TESTOPS_PORT         port the web UI is published on       (default: 8080)
#   TESTOPS_VERSION      image version to run, e.g. 0.3.0      (default: latest)
#   TESTOPS_ADMIN_EMAIL  email of the first admin account      (default: admin@testops.local)
#
# Written for bash 3.2 (macOS /bin/bash) and newer; needs curl and Docker with Compose v2.
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/caslanqa/test-ops/master"
IMAGE="ghcr.io/caslanqa/testops"

if [ -t 1 ]; then
  BOLD=$'\033[1m' RED=$'\033[31m' RESET=$'\033[0m'
else
  BOLD="" RED="" RESET=""
fi

say() { printf '%s==>%s %s\n' "$BOLD" "$RESET" "$*"; }
fail() {
  printf '%sError:%s %s\n' "$RED" "$RESET" "$*" >&2
  exit 1
}

# Hex secret; openssl is preferred, /dev/urandom keeps the installer working without it.
random_hex() {
  if command -v openssl > /dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'
  fi
}

# 20-character alphanumeric password. Avoids `tr < /dev/urandom | head`, whose SIGPIPE
# would abort the script under `set -o pipefail`.
random_password() {
  if command -v openssl > /dev/null 2>&1; then
    openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-20
  else
    random_hex 10
  fi
}

# Value of KEY in .env (last occurrence wins, surrounding double quotes removed).
env_get() {
  awk -v k="$1" 'index($0, k "=") == 1 { v = substr($0, length(k) + 2) } END { print v }' .env |
    sed -e 's/^"//' -e 's/"$//'
}

# Sets KEY=value in .env: replaces the first occurrence or appends; other lines are kept.
env_set() {
  local tmp
  tmp="$(mktemp .env.XXXXXX)"
  awk -v k="$1" -v v="$2" '
    index($0, k "=") == 1 { if (!done) print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' .env > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" .env
}

# True when something already listens on the local port (bash's /dev/tcp, no extra tools).
port_in_use() {
  (exec 3<> "/dev/tcp/127.0.0.1/$1") 2> /dev/null
}

# Compose's default project name for a directory: lowercased, only [a-z0-9_-].
project_name() {
  basename "$1" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-' | sed 's/^[^a-z0-9]*//'
}

# Version label of the running app container, empty when it is not running.
app_version() {
  local id
  id="$(docker compose ps -q --status running app 2> /dev/null || true)"
  [ -n "$id" ] || return 0
  docker inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$id" 2> /dev/null || true
}

# Everything runs from main(), called on the last line: if the download is cut off
# halfway through `curl | bash`, nothing runs instead of half a script.
main() {
  local dir="${TESTOPS_DIR:-$HOME/testops}"
  case "${TESTOPS_ADMIN_EMAIL:-admin@testops.local}" in
    *@*.*) ;;
    *) fail "TESTOPS_ADMIN_EMAIL must be an email address (got '${TESTOPS_ADMIN_EMAIL:-}')." ;;
  esac

  command -v curl > /dev/null 2>&1 || fail "curl is required."
  command -v docker > /dev/null 2>&1 ||
    fail "Docker is not installed. Install Docker Desktop or Docker Engine first: https://docs.docker.com/get-docker/"
  docker compose version > /dev/null 2>&1 ||
    fail "Docker Compose v2 (the 'docker compose' command) is required. Update Docker Desktop or install the compose plugin."
  docker info > /dev/null 2>&1 ||
    fail "Cannot reach the Docker daemon. Start Docker Desktop (or the docker service) and run the installer again."

  mkdir -p "$dir"
  cd "$dir"
  dir="$(pwd)"

  # A fresh database (no data volume yet) decides whether to create the first admin;
  # .env alone would not, e.g. after an earlier run stopped at the port check.
  local volume fresh_db=true
  volume="$(project_name "$dir")_pgdata"
  if docker volume inspect "$volume" > /dev/null 2>&1; then fresh_db=false; fi
  if [ ! -f .env ] && [ "$fresh_db" = false ]; then
    # Without .env the database password is unknown; a new random one would not match
    # the existing database and the app could never connect (P1000).
    fail "Found existing TestOps data (Docker volume '$volume') but no .env file in $dir.
       Restore the .env file from your backup and run the installer again.
       To start over and DELETE that data instead: docker volume rm $volume ${volume%_pgdata}_attachments"
  fi

  # The port is checked before anything is written, so a conflict leaves no half-made
  # install behind. Our own running app holds the port during an upgrade; anything else
  # would otherwise only surface as a cryptic error from Docker.
  local port previous=""
  if [ -n "${TESTOPS_PORT:-}" ]; then
    port="$TESTOPS_PORT"
  elif [ -f .env ]; then
    port="$(env_get APP_PORT)"
  fi
  port="${port:-8080}"
  # Only ask Compose when this directory has a compose file; otherwise it would search
  # the parent directories and could report an unrelated project.
  if [ -f docker-compose.yml ] && [ -f .env ]; then previous="$(app_version)"; fi
  if [ -z "$previous" ] && port_in_use "$port"; then
    fail "Port $port is already in use on this machine. Pick another one, for example:
       curl -fsSL $REPO_RAW/install.sh | TESTOPS_PORT=9090 bash"
  fi

  say "Downloading docker-compose.yml into $dir"
  local tmp
  tmp="$(mktemp docker-compose.yml.XXXXXX)"
  if ! curl -fsSL "$REPO_RAW/docker-compose.yml" -o "$tmp"; then
    rm -f "$tmp"
    fail "Could not download $REPO_RAW/docker-compose.yml"
  fi
  if [ -f docker-compose.yml ] && ! cmp -s "$tmp" docker-compose.yml; then
    cp docker-compose.yml docker-compose.yml.bak
    say "Updated docker-compose.yml (previous version saved as docker-compose.yml.bak)"
  fi
  chmod 644 "$tmp"
  mv "$tmp" docker-compose.yml

  if [ ! -f .env ]; then
    say "Creating .env with random secrets"
    (
      umask 077
      cat > .env << EOF
# TestOps settings, created by install.sh on $(date +%Y-%m-%d).
# Keep a copy of this file: the database password cannot be recovered without it.
# All options: https://github.com/caslanqa/test-ops#configuration
JWT_SECRET=$(random_hex 32)
POSTGRES_PASSWORD=$(random_hex 16)
APP_PORT=$port
EOF
    )
  else
    # Same rule as the app: an empty or placeholder secret would stop it from starting.
    case "$(env_get JWT_SECRET)" in
      "" | change-me-in-production)
        say "Generating the missing JWT_SECRET in .env"
        env_set JWT_SECRET "$(random_hex 32)"
        ;;
    esac
    if [ -n "${TESTOPS_PORT:-}" ]; then env_set APP_PORT "$port"; fi
  fi
  if [ -n "${TESTOPS_VERSION:-}" ]; then env_set APP_IMAGE "$IMAGE:${TESTOPS_VERSION#v}"; fi

  say "Pulling images"
  docker compose pull --quiet
  say "Starting TestOps (waits until it is ready)"
  if ! docker compose up -d --wait; then
    docker compose logs --tail 40 app >&2 || true
    fail "TestOps did not become ready; see the logs above."
  fi

  local admin_email="" admin_password="" seed_output
  if [ "$fresh_db" = true ]; then
    admin_email="${TESTOPS_ADMIN_EMAIL:-admin@testops.local}"
    admin_password="$(random_password)"
    say "Creating the first admin account with a starter workspace and demo project"
    if ! seed_output="$(docker compose exec -T -e SEED_ADMIN_EMAIL="$admin_email" \
      -e SEED_ADMIN_PASSWORD="$admin_password" app node prisma/seed.js 2>&1)"; then
      printf '%s\n' "$seed_output" >&2
      fail "TestOps is running, but the admin account could not be created."
    fi
    case "$seed_output" in
      *"already existed"*) admin_password="" ;;
    esac
  fi

  local version
  version="$(app_version)"
  echo
  if [ -n "$previous" ] && [ "$previous" != "$version" ]; then
    # Neutral wording: TESTOPS_VERSION can also pin an older version.
    say "TestOps ${version:-unknown} is running (was $previous): http://localhost:$port"
  else
    say "TestOps${version:+ $version} is running: http://localhost:$port"
  fi
  if [ -n "$admin_email" ]; then
    echo
    if [ -n "$admin_password" ]; then
      echo "    Admin account:  $admin_email"
      echo "    Password:       $admin_password"
      echo "    The password is shown only once; change it under Account after signing in."
    else
      echo "    $admin_email already existed; its password was not changed."
    fi
  fi
  echo
  echo "    Install directory: $dir (keep its .env file; it holds the database password)"
  echo "    Upgrade:           run the same install command again"
  echo "    Stop / start:      cd \"$dir\" && docker compose stop   (or: docker compose start)"
}

main "$@"
