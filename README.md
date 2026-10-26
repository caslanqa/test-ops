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

By default, users can sign up from the sign-in page. Set `SELF_REGISTRATION=false` in `.env` to disable sign-up; people then join through invitation links that workspace admins create under **Members**, and the link also lets them create their account. While sign-up is disabled, only admins of an existing workspace can create another workspace, so other users can't bring new accounts in by inviting people into workspaces of their own. Being the admin of one's own [demo workspace](#demo-workspace) doesn't count, and demo workspaces can't send invitations then. Invitations and role changes need a signed-in person; API tokens get 403 for them. This is an interim rule: a separate Installation Admin role (design-doc FR-090) is not implemented yet, so any admin of any workspace can still invite people.

### Roles and who can see what

The roles form one ladder, from the top: **Workspace admin**, **Project admin**, **Tester**, **Automation**, **Viewer**. A workspace admin is an admin in every project of the workspace; the other four are roles in one project, held together with workspace membership.

| Role | Can give | Can change or remove members who are |
|---|---|---|
| Workspace admin | every role, Workspace admin included | any role |
| Project admin | Tester, Automation, Viewer | Tester, Automation, Viewer |
| Tester, Automation, Viewer | nothing | nothing |

So a project admin cannot raise anyone to their own level, touch another project admin, or demote or remove themselves; a workspace admin does that. The server enforces this, and the web app lists only the roles you may give.

- **Inviting.** Workspace admins invite people under **Members** and choose one of the five types. Every type but Workspace admin is given for a project chosen in the form: the person joins the workspace and gets that role in that project. Project admins add people who are already workspace members, from the project's **Members** page.
- **Changing roles.** Workspace admins change a workspace role (Admin or Member) on the workspace's **Members** page and a project role on the project's **Members** page; project admins change project roles there, within the limit above. There is no separate permissions page.
- **Who sees what.** **Members** (of a project) is for workspace admins and project admins. **Integrations** is for them and for Automation users, who see the Playwright reporter and GitHub Actions guides; the CI webhook, which holds credentials, is for the admins only. The other roles don't see these sections, and their addresses lead to the project's Test cases.
- **API tokens** cannot invite people or change roles; do that from a signed-in session.

The workspace's **Settings** tab renames or deletes the workspace. On the **Projects** tab, project admins edit, archive and restore their projects, and workspace admins can delete an archived project for good.

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

Stopping or upgrading waits up to 30 seconds for running requests, such as uploads and CI result submissions, to finish. Upgrades preserve `.env` and the database/attachment volumes. Database migrations are applied when the app starts. To pin a release, set `APP_IMAGE=ghcr.io/caslanqa/testops:0.3.0` in `.env`. Run the installer with `TESTOPS_VERSION=latest` to switch a pinned installation back to the latest image.

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
| `SELF_REGISTRATION` | `true` | Set to `false` to disable self sign-up; invitation links still create accounts, and only workspace admins can create new workspaces. |
| `DEMO_WORKSPACE` | `true` | Gives every user a DEMO workspace of their own with an example project. Set to `false` to make no new ones; existing ones stay. See [Demo workspace](#demo-workspace). |
| `PUBLIC_URL` | unset | The app's public address, for links in CI webhook calls. Unset, the address requests come to is used. |
| `WEBHOOK_ALLOW_PRIVATE_NETWORKS` | `false` | Lets CI webhooks reach private and local network addresses, for CI on the internal network. See [CI webhook](#ci-webhook). |
| `TRUST_PROXY` | unset | Set to `1` when one trusted reverse proxy is in front of the app. |

Rate limits, the largest JSON request size of a bulk result upload (`JSON_MAX_REQUEST_SIZE_BYTES`, 10 MiB by default, enough for 500 results; all other JSON requests are limited to 100 KB) and attachment size/type limits can also be changed in `.env`. See [`.env.example`](.env.example) for the full list.

Result submissions are also capped: a result's `comment` may hold up to 10,000 characters and a result up to 200 `stepResults` (each comment up to 2,000 characters); a bulk upload holds up to 500 results. Larger values return 400. Attach long logs as files.

### Demo workspace

Every user, including someone who has just signed up, gets a **DEMO** workspace of their own to try what TestOps does. It holds the project of an example web shop with:

- suites, and cases with steps, both automated and manual;
- requirements and their coverage, a milestone and a release plan;
- a manual run with step results, and an automated Playwright run;
- defects linked to the failures.

The shop and its Playwright tests are in [`examples/demo-shop`](examples/demo-shop).

- **Made for each user.** The server makes the workspace the first time a user opens their workspace list; there is nothing to set up. Existing users get theirs the same way after an upgrade.
- **Theirs to change.** The user is the workspace's admin: they can start runs from the plan, assign cases, record results, file defects, rename it or delete it, and invite people while sign-up is open. Nobody else sees it unless they invite them.
- **Made once.** A deleted demo doesn't come back by itself. **Create a demo workspace** on the Workspaces page makes a fresh one (`POST /api/v1/demo-workspace`).
- **Switching it off.** Set `DEMO_WORKSPACE=false` to make no new demos; existing ones stay.
- **Earlier versions** had one shared, read-only DEMO workspace. The server deletes it at startup.

### CI webhook

A project admin can connect CI under **Integrations**; Automation users see the section too, without the webhook settings, and the other roles don't see it. When a run starts with cases set to **Automation** (set per case in the plan's case list, next to the assignee, or by the cases' automation status), TestOps POSTs the run to the webhook URL so CI can run those cases.

- **Body.** It has the shape of a GitHub `repository_dispatch` (`event_type: "testops.run.started"`, `client_payload` with the run, the API address and the automated cases), so `https://api.github.com/repos/OWNER/REPO/dispatches` can be the webhook itself.
- **Headers and signature.** Extra headers, such as `Authorization`, are stored encrypted and never shown again. Every call is signed in `X-TestOps-Signature-256` (HMAC-SHA256 of the body with the webhook's secret).
- **Retries.** Failed calls (network errors, 5xx, 429) are tried twice more. The run page shows how the last call went and can trigger CI again.
- **No loops.** Runs that CI starts itself never call the webhook.
- **TestOps address.** The calls carry the TestOps address (`api_url`, run links) from `PUBLIC_URL`, or else from the address the admin saved the webhook from. It is never taken from the request that starts a run, so whoever starts one can't send CI, and the token CI reports with, to another server.
- **Private addresses.** Webhooks can't reach private or local network addresses, which is checked again when the call is made, unless `WEBHOOK_ALLOW_PRIVATE_NETWORKS=true`.

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
| API returns `401 Unauthorized` | Use an API token from **Account → API tokens** in the `Authorization: Bearer <token>` header. The token may have expired (they last 90 days by default) or been revoked; create a new one. A password change revokes all of your API tokens. |
| API returns `403 Forbidden` on token or member management | API tokens cannot manage API tokens or invitations, add project members or change workspace or project roles. Do this from a signed-in web session. |

Health checks are available at `/health` and `/ready`. `/health` confirms the process is running; `/ready` confirms the database is reachable.

## API

The REST API base path is `/api/v1`. Open the interactive reference at **http://localhost:8080/api/docs** (replace the port if you changed `APP_PORT`). The OpenAPI documents are available at `/api/docs-json` and `/api/docs-yaml`.

Create a token under **Account → API tokens**, then send it as:

```http
Authorization: Bearer <token>
```

Tokens expire after 90 days by default. `POST /api-tokens` accepts `expiresInDays` (1-365); omit it for the 90-day default, or send `null` for a token that never expires. Tokens created before this limit existed keep working without an expiry until you revoke them.

An API token cannot create, list or revoke API tokens, change a password, create or revoke workspace invitations, add project members, or change workspace or project roles; these calls return `403` and need a signed-in web session. This way a leaked token cannot keep or widen its access. Changing your password (`PATCH /auth/me/password`) returns `200` with a fresh session token for the client that made the change, signs out every other session and revokes all of your API tokens.

The **Help & support** page also links to the API reference and includes an example for submitting automation results from CI.

For a complete Playwright integration example, see [`examples/demo-shop`](examples/demo-shop). Install the [`@testops/reporter` npm package](packages/reporter), configure it in `playwright.config.ts`, and link tests to TestOps cases with `testops('<test-case-uuid>')`. Run `npx testops-sync --apply` in CI to sync linked test titles and automation status when the tests change. The reporter creates and completes CI runs, or reports into a run started by TestOps, uploads failure screenshots and links failures to known defects. The package's framework-neutral reporting core is the contract for future JUnit, Cucumber and Cypress adapters. Every user's [DEMO workspace](#demo-workspace) has the example project.

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

## License

TestOps is open source under the [MIT License](LICENSE). Third-party components bundled with it, such as the interface font, keep their own licenses; see [NOTICE](NOTICE).
