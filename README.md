# TestOps

A test management tool you can run on your own server, bringing test case management, test runs and automation results together in one place. The API and the web UI ship in a single Docker image; data is stored in a separate PostgreSQL database.

- Image: `ghcr.io/caslanqa/testops` (linux/amd64 and linux/arm64, public)
- Requirements: Docker Engine 24+ and Docker Compose v2 (check with `docker compose version`)

## Quick start (recommended)

No source code is needed; two files and three commands are enough.

```bash
mkdir testops && cd testops

# 1. Download the Compose file (PostgreSQL + TestOps)
curl -fsSLO https://raw.githubusercontent.com/caslanqa/test-ops/master/docker-compose.yml

# 2. Create the .env file containing the two required secrets
cat > .env <<EOF
JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
EOF

# 3. Start it; --wait blocks until the app is ready (images are downloaded the first time)
docker compose up -d --wait
```

Then open **http://localhost:8080** in your browser.

> The `.env` file contains secrets; keep it safe and do not share it. In particular, `POSTGRES_PASSWORD` must not be changed after the first installation (see [Troubleshooting](#troubleshooting)).

### First sign-in

A new installation has no users. You have two options:

- **Create an account:** Sign up with the **Create account** link on the sign-in screen, then create your first workspace with **New workspace**. The person who creates a workspace becomes its admin and adds the other users from there.
- **Load demo data:** Creates a sample workspace, project and admin user.

  ```bash
  docker compose exec -e SEED_ADMIN_PASSWORD="$(openssl rand -base64 18)" app node prisma/seed.js
  ```

  The command prints the sign-in details on the `Seed complete. Sign in with: admin@testops.local / …` line; the email can be changed with `SEED_ADMIN_EMAIL`. If `SEED_ADMIN_PASSWORD` is not given, the password is `ChangeMe123!`; in that case change it on the **Account** page right after signing in. Running the command again is safe: it does not touch existing records or the user's password, and its output says so.

If you have turned off registration with `SELF_REGISTRATION=false`, create the first user with the demo data command.

## Day-to-day operations

Run the commands in the folder that contains `docker-compose.yml`.

| Task | Command |
|---|---|
| Status | `docker compose ps` |
| Logs | `docker compose logs -f app` |
| Stop (data is kept) | `docker compose down` |
| Restart | `docker compose up -d --wait` |
| Update | `docker compose pull && docker compose up -d --wait` |
| Database backup | `docker compose exec -T postgres pg_dump -U testops testops > testops.sql` |
| Attachment backup | `docker compose cp app:/data/attachments ./attachments-backup` |
| Delete everything (**including data**) | `docker compose down -v` |

When you update, database migrations are applied automatically as the app starts. To stay on a specific version, add `APP_IMAGE=ghcr.io/caslanqa/testops:0.2.0` to the `.env` file. Published tags: `latest`, `X.Y.Z`, `X.Y` and `sha-<commit>`. Versions and changes are listed on the [Releases](https://github.com/caslanqa/test-ops/releases) page.

## Configuration

Settings are read from the `.env` file; after changing them, apply them with `docker compose up -d --wait`. A list of all variables with descriptions is in [`.env.example`](.env.example).

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | — (required) | Signs session tokens. At least 32 characters; `openssl rand -hex 32`. Changing it signs everyone out. |
| `POSTGRES_PASSWORD` | — (required) | Database password. Postgres stores it when the volume is first created. |
| `POSTGRES_USER`, `POSTGRES_DB` | `testops` | Database user and name. |
| `APP_PORT` | `8080` | Host port on which the UI is exposed. |
| `APP_IMAGE` | `ghcr.io/caslanqa/testops:latest` | Image to run; use it to pin a version. |
| `JWT_EXPIRES_IN` | `8h` | Session duration. |
| `SELF_REGISTRATION` | `true` | If `false`, users can only be added by workspace admins. |
| `RATE_LIMIT_PER_MINUTE` | `600` | Request limit per minute per user (or anonymous IP); `0` turns it off. |
| `AUTH_RATE_LIMIT_PER_MINUTE` | `10` | Per-account limit for sign-in, registration and password change. |
| `AUTH_IP_RATE_LIMIT_PER_MINUTE` | `60` | Limit on authentication attempts from a single IP across all accounts. |
| `TRUST_PROXY` | off | `true` or the hop count (e.g. `1`) if you are behind a reverse proxy; see below. |
| `ATTACHMENT_MAX_FILE_SIZE_BYTES` | 32 MB | Size limit for a single attachment. |
| `ATTACHMENT_MAX_REQUEST_SIZE_BYTES` | 128 MB | Total upload limit for a single request. |
| `ATTACHMENT_MAX_FILES_PER_REQUEST` | `20` | Number of files in a single request. |
| `ATTACHMENT_ALLOWED_EXTENSIONS` | images, video, text, pdf, archives | Comma-separated extensions, e.g. `png,jpg,log,zip`. |

### Reverse proxy and HTTPS

On its own, TestOps serves plain HTTP. If you are going to expose it to the internet, put a TLS-terminating reverse proxy (nginx, Caddy, Traefik) in front of it and point the proxy at `http://localhost:8080`. In that case, add `TRUST_PROXY=1` to the `.env` file. Otherwise the app treats every request as coming from the proxy's IP, and all users share the same rate limit counter. If the app is exposed directly to the internet, leave `TRUST_PROXY` empty; otherwise clients can bypass the limit by forging the `X-Forwarded-For` header.

## Without Compose (`docker run`)

The image does not include a database; you first need to start PostgreSQL on the same Docker network. The app container listens on port **3000** internally, so the port mapping must be `-p <host-port>:3000`.

```bash
PGPW=$(openssl rand -hex 16)      # keep these two values; a reinstall needs the same ones
JWT=$(openssl rand -hex 32)

docker network create testops

docker run -d --name testops-db --network testops --restart unless-stopped \
  -e POSTGRES_USER=testops -e POSTGRES_PASSWORD="$PGPW" -e POSTGRES_DB=testops \
  -v testops-pgdata:/var/lib/postgresql/data \
  postgres:16-alpine

docker run -d --name testops --network testops --restart unless-stopped \
  -e DATABASE_URL="postgresql://testops:$PGPW@testops-db:5432/testops?schema=public" \
  -e JWT_SECRET="$JWT" \
  -e ATTACHMENTS_DIR=/data/attachments -v testops-attachments:/data/attachments \
  -p 8080:3000 \
  ghcr.io/caslanqa/testops:latest
```

The app retries migrations until the database accepts connections. You can check that it is ready with `docker inspect -f '{{.State.Health.Status}}' testops` (`healthy`) or with `curl http://localhost:8080/ready`.

## Troubleshooting

First look at the output of `docker compose logs app` (or `docker logs testops`).

| Symptom | Cause and fix |
|---|---|
| `TestOps: DATABASE_URL is not set` or `Environment variable not found: DATABASE_URL` | The image was run on its own, without a database. Use the Compose setup from the [Quick start](#quick-start-recommended) section, or start PostgreSQL as well and pass `DATABASE_URL` as shown in the [Without Compose](#without-compose-docker-run) section. |
| `JWT_SECRET is not set; add it to .env (scripts/start.sh generates one)` (compose) or `JWT_SECRET is not set / is a placeholder / is too short` | Put a value generated with `JWT_SECRET=$(openssl rand -hex 32)` into the `.env` file. |
| The container is `healthy` but the page does not open in the browser | Wrong port mapping: the container listens on 3000. Use `-p 8080:3000` (not `-p 8080:8080`). |
| `port is already allocated` / `address already in use` | Port 8080 is used by another application. Put e.g. `APP_PORT=9090` in the `.env` file and use http://localhost:9090. |
| `P1000: Authentication failed against database server` | `POSTGRES_PASSWORD` was changed after the first installation; Postgres keeps using the old password. Switch back to the old password. If you are willing to lose the data, run `docker compose down -v` and then start again. |
| `pull access denied for testops` | An old `APP_IMAGE=testops:local` line is left in `.env`; delete that line. |
| `docker: invalid reference format` or `--name: command not found` | In a multi-line command, `\` must be the last character on the line; if whitespace follows it, the command gets split. |
| `Too many attempts. Try again in N seconds.` on sign-in | Too many attempts were made in a short time; wait for the stated amount of time. The limits are in the table above. |

Health endpoints: `/health` (is the process up) and `/ready` (is the database reachable). The API documentation is at `/api/docs`.

## Development

Running from source requires Node 20+, pnpm (the version is in the `packageManager` field of `package.json`) and Docker.

```bash
git clone https://github.com/caslanqa/test-ops.git && cd test-ops
pnpm install
pnpm start        # prepares .env, builds the image from source, loads the demo data and opens the browser
pnpm test:smoke   # smoke tests against the running stack
```

`docker compose` commands run inside the repo also load `docker-compose.override.yml` automatically. That file builds the image from the working copy instead of pulling it from the registry (`testops:local`) and exposes PostgreSQL to the host on `127.0.0.1:5432`. Installation only needs `docker-compose.yml`.

- Monorepo: `apps/api` (NestJS + Prisma), `apps/web` (React + Vite). Design: [`design-doc.md`](design-doc.md), roadmap: [`PLAN.md`](PLAN.md).
- Every change merged into `master` is versioned automatically after it passes CI; the image is pushed to GHCR, and a git tag and a GitHub Release are created. The version is determined from the commit message: `feat:` bumps minor, `fix:` and everything else bump patch, `feat!:` or `BREAKING CHANGE:` bumps major.
