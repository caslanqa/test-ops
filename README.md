# TestOps

A self-hosted test management tool for requirements, test cases, manual and automated runs, results, and defects. The web app and REST API run in one container; PostgreSQL stores application data and a persistent volume stores attachments.

## Contents

- [What is TestOps?](#what-is-testops)
- [Install](#install)
- [First sign-in](#first-sign-in)
- [Operations and backups](#operations-and-backups)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [API](#api)
- [Development](#development)

## What is TestOps?

TestOps brings these QA activities together:

- Organize test cases in suites and link them to requirements.
- Create reusable plans and manual or automated test runs.
- Record results, retries, comments, step results, and evidence.
- Track defects and link them to failed results.
- Submit automation results through the REST API.

TestOps is self-hosted. The app image is published at [ghcr.io/caslanqa/testops](https://github.com/caslanqa/test-ops/pkgs/container/testops) for `linux/amd64` and `linux/arm64`.

## Install

You need Docker Engine 24 or later and Docker Compose v2.

### Recommended: installer

Run this on the machine where TestOps should be hosted:

```bash
curl -fsSL https://raw.githubusercontent.com/caslanqa/test-ops/master/install.sh | bash
```

The installer creates `~/testops`, generates the required secrets, starts PostgreSQL and TestOps, waits for the app to become ready, then creates the first admin account and starter workspace. It prints the initial password once.

On the same machine, open **http://localhost:8080** and sign in with the credentials shown by the installer. From another device, use the server's hostname or IP address and the selected port.

Common installer options:

| Variable | Default | Purpose |
|---|---|---|
| `TESTOPS_DIR` | `~/testops` | Installation directory |
| `TESTOPS_PORT` | `8080` | Host port for the web app; also updates an existing installation |
| `TESTOPS_VERSION` | `latest` | Image version, such as `0.3.0` |
| `TESTOPS_ADMIN_EMAIL` | `admin@testops.local` | First admin account email |

For example, to use port 9090:

```bash
curl -fsSL https://raw.githubusercontent.com/caslanqa/test-ops/master/install.sh | TESTOPS_PORT=9090 bash
```

To review the script before running it:

```bash
curl -fsSL https://raw.githubusercontent.com/caslanqa/test-ops/master/install.sh -o install.sh
less install.sh
bash install.sh
```

### Manual Docker Compose install

Use this if you want to manage each setup step yourself:

```bash
mkdir testops
cd testops

curl -fsSLO https://raw.githubusercontent.com/caslanqa/test-ops/master/docker-compose.yml

(umask 077
cat > .env <<EOF
JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
EOF
)

docker compose up -d --wait
docker compose exec -T -e SEED_ADMIN_PASSWORD="$(openssl rand -base64 18)" app node prisma/seed.js
```

The seed command prints the first admin credentials. Set `SEED_ADMIN_EMAIL` as an additional `-e` value to choose another email. Running the seed again does not reset an existing account's password. You can also create the first account from the sign-in page if self-registration is enabled.

## First sign-in

The installer creates an admin account with a starter workspace and demo project. Change the initial password from **Account** after signing in.

By default, users can sign up from the sign-in page. Set `SELF_REGISTRATION=false` in `.env` to disable sign-up; people then join through invitation links that workspace admins create under **Members**, and the link also lets them create their account.

## Operations and backups

Run commands from the installation directory, usually `~/testops`.

| Task | Command |
|---|---|
| Check containers | `docker compose ps` |
| Follow app logs | `docker compose logs -f app` |
| Stop services and keep data | `docker compose down` |
| Start services | `docker compose up -d --wait` |
| Upgrade using the installer | Run the same installer command again |
| Pull the selected image and restart | `docker compose pull && docker compose up -d --wait` |

Upgrades preserve `.env` and the database/attachment volumes. Database migrations are applied when the app starts. To pin a release, set `APP_IMAGE=ghcr.io/caslanqa/testops:0.3.0` in `.env`. Run the installer with `TESTOPS_VERSION=latest` to switch a pinned installation back to the latest image.

A full backup includes the database, attachments, and `.env` file:

```bash
docker compose exec -T postgres pg_dump -U testops testops > testops.sql
docker compose cp app:/data/attachments ./attachments-backup
```

The commands above use the default database user and name. Keep the database dump and attachment backup together with a secure copy of `.env`; it contains the JWT and database secrets.

**Uninstalling deletes data:** `docker compose down -v` removes the database and attachment volumes. Make and verify your backups before running it.

## Configuration

The installer creates `.env` with secure values. Keep it private and keep a backup. Do not change `POSTGRES_PASSWORD` after the database volume has been created.

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET` | Generated by installer | Signs sessions. Changing it signs users out. |
| `POSTGRES_PASSWORD` | Generated by installer | App-to-database password. Keep the original value for the lifetime of the database. |
| `APP_PORT` | `8080` | Host port published for the web app and API. |
| `APP_IMAGE` | `ghcr.io/caslanqa/testops:latest` | Container image; set a version tag to pin releases. |
| `SELF_REGISTRATION` | `true` | Set to `false` to disable self sign-up. |
| `TRUST_PROXY` | unset | Set to `1` when one trusted reverse proxy is in front of the app. |

Rate limits, the largest JSON request size (10 MiB by default, enough for a bulk upload of 500 results) and attachment size/type limits can also be changed in `.env`. See [`.env.example`](.env.example) for the full list.

### HTTPS and reverse proxies

TestOps serves HTTP on its own. Before exposing it outside a trusted network, put a TLS reverse proxy such as Caddy, nginx, or Traefik in front of it. If there is one trusted proxy hop, set `TRUST_PROXY=1`; use the correct hop count if your setup has more than one proxy.

## Troubleshooting

Start with the app logs:

```bash
cd ~/testops
docker compose ps
docker compose logs --tail 100 app
```

| Symptom | What to check |
|---|---|
| Installer says port 8080 is in use | Choose another port with `TESTOPS_PORT=9090` and rerun the installer. |
| App does not become ready | Check `docker compose ps` and `docker compose logs app`. The app listens on port 3000 inside the container; Compose publishes it on `APP_PORT` (8080 by default). |
| `JWT_SECRET` missing, too short, or rejected | Check that `.env` contains the generated secret and that it has not been replaced with the example value. |
| `P1000: Authentication failed against database server` | The password in `.env` no longer matches the password stored in the existing PostgreSQL volume. Restore the original `.env`; changing the password in the file alone does not change the database password. |
| `pull access denied` | Check `APP_IMAGE` in `.env`. For a public release, use `ghcr.io/caslanqa/testops:latest` or a published version tag. |
| `Too many attempts. Try again in N seconds.` | Wait for the stated interval. Sign-in and registration have separate rate limits. |
| `Too many requests without valid credentials. Try again in N seconds.` | A client at this address sent many requests with a missing, expired or wrong token. Fix the token (in CI, check the secret) and wait for the stated interval. Signed-in browser sessions are not affected. |
| API returns `401 Unauthorized` | Use an API token from **Account → API tokens** in the `Authorization: Bearer <token>` header. |

Health checks are available at `/health` and `/ready`. `/health` confirms the process is running; `/ready` confirms the database is reachable.

## API

The REST API base path is `/api/v1`. Open the interactive reference at **http://localhost:8080/api/docs** (replace the port if you changed `APP_PORT`). The OpenAPI documents are available at `/api/docs-json` and `/api/docs-yaml`.

Create a token under **Account → API tokens**, then send it as:

```http
Authorization: Bearer <token>
```

The **Help & support** page also links to the API reference and includes an example for submitting automation results from CI.

## Development

Requirements: Node.js 20 or later, pnpm 12.8.1, and Docker.

```bash
git clone https://github.com/caslanqa/test-ops.git
cd test-ops
pnpm install
pnpm start
```

`pnpm start` prepares the local environment, builds and starts the Docker stack, seeds demo data, and opens the app. Run the smoke checks against the running stack with:

```bash
pnpm test:smoke
```

The repository is a pnpm workspace:

- `apps/api` — NestJS API and Prisma data layer.
- `apps/web` — React and Vite UI.
- [Design document](design-doc.md) · [Development plan](PLAN.md).

Compose commands run inside the repository also load `docker-compose.override.yml`, which builds the local image and exposes PostgreSQL only on `127.0.0.1:5432`. The installer uses `docker-compose.yml` alone.
