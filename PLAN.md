# TestOps — Development Plan (post-Phase 1)

**Status:** The Phase 1 core works end to end and has been verified (see repo memory / previous conversation summary). This document collects in one place the **remaining work**, organized by the phases in design-doc.md, and the **known gaps** found in the code review.

## 0. Priority technical debt (independent of phases, to be addressed first)

- [ ] **The audit log is never written.** The `AuditLog` Prisma model exists, but no service ever inserts into it. Design-doc section 8: "Critical user actions must be written to the audit log" — currently not met. Suggestion: record an entry for critical actions such as write/delete/role change via `AccessControlService` or a separate `AuditService`.
- [x] **Rate limiting is not actually enforced.** _(2 October 2026: `@nestjs/throttler` 6 + `common/rate-limit.ts` `AppThrottlerGuard`. The general limit is 600 per minute per user/anonymous IP (a single counter for the whole API, not per route); sign-in/registration/password change additionally get 10 per account+IP and 60 per IP. On 429: the standard `Retry-After` header and the `Too many attempts. Try again in N seconds.` message; `X-RateLimit-Limit/-Remaining/-Reset` headers; `/health` and `/ready` are exempt from the limit. `RATE_LIMIT_PER_MINUTE`, `AUTH_RATE_LIMIT_PER_MINUTE`, `AUTH_IP_RATE_LIMIT_PER_MINUTE` (0 = off) and `TRUST_PROXY` for a reverse proxy. The sign-in screen shows the 429 message. `tests/smoke/ratelimit.mjs` runs in CI. Remaining: counters are kept in memory (multiple replicas need Redis storage); no account lockout against distributed attempts on a single account from different IPs; no `RateLimit-Policy` header, the `X-RateLimit-*` equivalent is used instead.)_ We document the FR-077 header format, but there is no guard such as `@nestjs/throttler`; a client can send as many requests as it wants.
- [ ] **No automated tests.** There are no tests on either the API side (Jest/e2e) or the web side (component/e2e). At a minimum, smoke-level e2e tests should be added for auth + access control + the run/result flow.
- [ ] **The backup/restore procedure is not written down.** _(2 October 2026: the backup commands are in the README (`pg_dump`, `docker compose cp`); the restore steps have not been written or tested yet.)_ Design-doc section 8 and MVP acceptance criterion 7: the backup/restore steps for PostgreSQL + the attachment volume are not documented.
- [ ] **FR-017 (auto-case-creation from automation results) is not in the backend yet.** Currently `results.service.ts` simply returns 404 when a result does not match an existing `testCaseId`; there is no fallback matching by name/suite and no automatic case creation.

### 0.1 Code review findings (2 October 2026)

**Security**

- [x] **No cross-project/cross-workspace ID validation (FR-003, section 8).** _(2 October 2026: scope checks added to `AccessControlService`; all of the points below were fixed and verified with a 34-scenario smoke test against the running stack.)_ Foreign keys in the request body are not checked to belong to the project in the URL:
  - `defects.service.ts` create/linkResults `resultIds`: another project's result can be linked and then read via `getOne`, including `caseSnapshot`.
  - `requirements.service.ts` linkCases, `plans.service.ts` create/addCases `testCaseIds`: another project's case can be linked and its full content read.
  - `unlinkCase` / `removeCase` / `unlinkResult`: the parent record is not checked to belong to the project → links in another project can be deleted.
  - `suiteId`, `parentId`, `milestoneId`, `assigneeId` are not validated; there is no cycle check for suite `parentId` (moving a suite into its own child suite).
  - `workspaces.service.ts` / `projects.service.ts` `updateMemberRole` / `removeMember`: `memberId` is not checked to belong to the workspace/project in the URL → anyone who is an admin in their own workspace can make their membership in another workspace ADMIN or remove members (**privilege escalation**).
- [x] **Default JWT secret.** _(2 October 2026: `config/jwt-secret.ts` stops bootstrap in production when the secret is empty, the example value or shorter than 32 characters; compose rejects an empty value via `${JWT_SECRET:?}`; `scripts/ensure-env.sh` generates a random secret; `start.sh` shows the logs and exits with an error if the app does not become ready, and the bug where it exited silently when `APP_PORT` was missing from `.env` was fixed.)_ `configuration.ts` and `docker-compose.yml` use `change-me-in-production`; because `start.sh` copies `.env.example`, JWTs can be forged on a default installation. It should refuse to start in production with a default/empty secret.
- [x] **Postgres is exposed to the host.** _(2 October 2026: the port is bound only to `127.0.0.1`; `prisma migrate dev` from the host keeps working. The default DB password still comes from `.env` — it is not generated automatically because of the risk of a mismatch with an existing volume.)_ `docker-compose.yml` exposes 5432 externally with the default password; it should be closed by default (with an override file if needed).
- [x] **Attachment security.** _(2 October 2026: an extension allowlist (`ATTACHMENT_ALLOWED_EXTENSIONS`, no svg by default) and a Content-Type derived server-side from the extension; RFC 6266 `filename*` via `res.attachment`; multer disk storage (`.tmp` inside the volume + atomic rename, checksum computed while streaming, cleanup on rejection); 413 based on `Content-Length` before the body is read; the ATTACHMENT_* limits are configurable from compose and the app refuses to start on an invalid value. Additionally: Turkish file names being stored garbled in the DB (`gÃ¶rÃ¼ntÃ¼`) was fixed, and the direct `multer` dependency was upgraded from the CVE-affected 1.4.5-lts (later to 2.4.0; see Dependency vulnerabilities). The 18-scenario smoke test passed. No content/magic-byte validation.)_
  - The MIME/extension check from section 8 is missing (size only).
  - `attachments.controller.ts` writes the file name raw into `Content-Disposition`; names with non-Latin-1 characters (ş, ğ, ı) return 500 on download, and `"` breaks the header → RFC 5987 `filename*=UTF-8''…`.
  - `memoryStorage`: the 128 MB total check happens after the files have been loaded into RAM (~640 MB for a single request) → disk-based storage or streaming.
- [ ] **Minor items.** The token revocation response returns `tokenHash`; the container runs as root.
- [x] **Dependency vulnerabilities.** _(2 October 2026: the direct `multer` dependency was upgraded to 2.4.0; because `@nestjs/platform-express` 10.x pins multer to exactly 2.0.2 and that copy is the one that handles uploads, 2.4.0 is forced across the whole tree via `pnpm-workspace.yaml` `overrides`. The same-major patches for lodash, js-yaml, qs and body-parser were also pulled in via overrides. `pnpm audit --prod` went down from 20+ warnings to 4; the remaining ones are in the Nest 11 item below.)_
- [ ] **Nest 11 migration (remaining audit warnings).** `pnpm audit --prod` still reports the following; none of them were forced via overrides because they all require a major version:
  - `@nestjs/core` GHSA-36xv-jgw5-4q75 (moderate) → 11.1.18+ only.
  - `path-to-regexp` 0.2.5 (via `@nestjs/serve-static`) GHSA-9wv6-86v2-598j (high) → ≥1.9.0; comes with serve-static 5.x.
  - `file-type` 20.4.1 (via `@nestjs/common`) GHSA-5v7r-6r5c-r473, GHSA-j47w-4g3g-c36v (moderate) → ≥21.3.2. Not currently reachable, since the code does not use `FileTypeValidator`/`ParseFilePipe`.
  - Recommended to do together with the Node 22 migration (below); the Express 5 route syntax and the `ServeStaticModule` exclude patterns need to be reviewed.

**Correctness / functional**

- [ ] **FR-072 is missing.** No list endpoint has pagination/sorting.
- [ ] **Coverage bug.** `requirements.service.ts` `take: 200` truncates the results of all linked cases together; with frequently run cases, the latest status of the other cases is lost. Also N+1 queries per requirement.
- [ ] **Bulk submit is not atomic.** `results.service.ts` `bulkSubmit` is sequential and has no transaction; a single bad item returns 404 but the earlier results stay written, and the client cannot tell which ones were saved.
- [ ] **Idempotency race.** The `externalTestId` check is outside the transaction; concurrent CI jobs can create duplicate records. If an old attempt's `externalTestId` comes in, `RunCase.status` is reverted to the old result.
- [x] **Delete/unlink returns 500.** Prisma `delete` throws P2025 when the record does not exist, and there is no global exception filter → 500 instead of 404. _(Unlink operations were changed to `deleteMany` + 404, and the other deletes check for existence first. There is still no general Prisma exception filter.)_

**Toolchain**

- [ ] **API lint is broken.** `pnpm lint` → `eslint: command not found`; eslint is neither installed nor configured.
- [x] **No CI gate.** The only workflow is a Docker publish on tag; no build + typecheck + test on PR/push. _(2 October 2026: `ci.yml` — on PRs and pushes to master: build, typecheck, web lint and smoke tests against the Docker stack (`tests/smoke/`); publish depends on this workflow via `needs:`. API lint is still left out.)_
- [ ] **Node 20 EOL.** Node 20 support ended on 30 April 2026; the Dockerfile (`node:20-bookworm-slim`) and CI should move to Node 22 LTS (after verifying Prisma 5 compatibility).

## 1. Phase 2 — Automation and evidence

- [ ] **Web UI for bulk result ingestion.** The backend already has `POST .../results/bulk`; the UI has no screen for bulk viewing/uploading.
- [ ] **JUnit XML import.** FR-078: generic REST + JUnit XML are defined as the first automation inputs; there is no endpoint/CLI that parses JUnit XML and turns it into a `bulkSubmit`.
- [ ] **First framework reporter (Playwright or pytest).** No reporter package has been written yet.
- [ ] **Attachment upload/download UI.** The API side is complete (`attachments.controller.ts`), but the web app has no file upload/download screen — it is only possible through the backend REST API.
- [ ] **Run history / dashboard.** Currently only the progress of a single run is shown; there are no project-wide past runs, pass-rate trend or recent failed tests (FR-060, FR-061).
- [ ] **Advanced filtering/search.** FR-061: filtering by case/requirement/run/date/status/user/tag/milestone — currently missing.
- [ ] **API rate limit + idempotency improvements.** (Can be handled together with item 0.) _(The rate limit part was done on 2 October 2026; the idempotency race is still open in section 0.)_

## 2. Phase 3 — Integration and team scale

- [ ] **Jira/GitHub issue links (a real adapter).** Currently `Defect.externalProvider/externalIssueId/externalUrl` are just free-text fields; the adapter architecture from FR-053 (automatic issue creation, status sync) is missing.
- [ ] **Webhook infrastructure.** FR-079: subscriptions to run completion, result creation and defect change events + retries/visibility of failed deliveries — missing.
- [ ] **Chat notification integrations** (Slack/Teams/Discord/Mattermost) — depend on the webhook infrastructure, not available yet.
- [ ] **UI for custom fields.** The backend already has `TestCase.customFields` (Json), but there is no UI for defining/displaying a per-project field schema.
- [ ] **Case review flow, report sharing, additional reporters.**
- [ ] **CSV import/export.** FR-062.

## 3. Missing screens in the web UI (backend ready within Phase 1 scope, UI minimal/missing)

**UI redesigned (2 October 2026):** a Qase-like workflow (left-hand project navigation, suite tree + case table + detail panel, run progress bar and inline result entry, a shared case picker in the plan/run/requirement dialogs) with its own visual identity; no branding/visual design was copied (design-doc section 1). WCAG 2.2 AA: no violations in the axe scan, no horizontal scrolling at 390 px. Fixed the Plans page crashing with the first plan.

- [ ] Milestone management screen (the API only has list/create; no update/delete, no UI).
- [x] API token creation/revocation screen (API exists, no UI). _(2 October 2026: on the Account page; the token is shown only once, and revocation asks for confirmation. The revocation response no longer returns tokenHash.)_
- [ ] Screen for enabling/disabling a run's "public share" link (API exists, no UI).
- [x] Workspace/project member management screen — none of the UI for listing, adding, updating roles or removing exists (MVP acceptance criterion 1 is currently met only through the API). _(2 October 2026: a "Members" tab for workspaces and a "Members" section for projects; role selection with descriptions; an admin can create a new account with a temporary password. The UI hides actions based on the user's role, and the role is shown in the sidebar.)_
- [x] User registration and account settings. _(Registration screen (`SELF_REGISTRATION`, on by default), profile and password change; email matching is case-insensitive.)_
- [x] Membership security. _(Only workspace members can be added to a project; when someone is removed from a workspace, their project memberships in that workspace are removed too (previously they kept access to the projects); the last admin of a workspace cannot be removed/demoted; members only see the names of the projects they are members of. `tests/smoke/users.mjs`: 33 scenarios.)_
- [ ] Password reset and email invitations — no SMTP infrastructure; currently an admin creates new accounts with a temporary password, and there is no way to reset a forgotten password (nor can an admin reset another user's password).
- [x] Rate limit for sign-in/registration — the registration endpoint is public; the rate limiting item in section 0 is now a higher priority. _(2 October 2026: done together with the rate limiting in section 0.)_
- [x] Suite hierarchy (child suite/folder tree) — currently a single-level list. _(2 October 2026: a nested suite tree in the Repository, counts that include child suites, and a case list grouped in tree order.)_
- [ ] Step-level result entry — currently a single status per case.
- [ ] Editing/archiving/deleting — the web app never calls `PATCH`/`DELETE`; cases, requirements, plans, runs and defects can only be created (FR-011).
- [x] Requirement coverage view (FR-022, flow 5.1 step 3). _(A "no tests" label and a latest-results strip in the requirement list.)_
- [ ] Case change history (FR-015) — API exists, no UI.
- [x] The UI language is English. _(2 October 2026: all UI text, API error messages, and seed and startup script output are in English. 3 October 2026: the rest of the repository (code comments, docs, smoke tests, scripts, CI) was translated to English as well. Dates use `en-US`; search ignores the i/ı/İ distinction. There is no multi-language (i18n) infrastructure — if a second language is needed, the strings should be moved into a dictionary.)_
- [x] Light/dark theme. _(System / Light / Dark choice in the top bar and on the sign-in screen; the preference is stored in the browser and synced across tabs; `public/theme-init.js` applies it before the first paint (a separate file because the CSP does not allow inline scripts). Axe scans of 11 pages are clean in both themes.)_

## 4. Release — container registry publish

**Reproducible build:** `package.json` `packageManager: pnpm@12.8.1` — Docker (corepack), CI (`pnpm/action-setup`) and local pnpm all use the same version; the version is recorded in the lockfile with its integrity hash.

**Current state (2 October 2026):** No manual steps. On every push/merge to master (except when only `.md` files change), `release.yml` runs CI, computes the version with `scripts/next-version.sh` (the first version comes from `package.json`; after that `feat:` → minor, `type!:` / `BREAKING CHANGE:` → major, everything else → patch), publishes the image to `ghcr.io/caslanqa/testops`, verifies that it can be pulled anonymously, and then creates the `vX.Y.Z` tag + a GitHub Release (automatic notes). Because the tag is created with `GITHUB_TOKEN`, it does not trigger other workflows; the release happens within the same run.

- [x] **The repo is not on git/GitHub yet** — the workflow can never run. _(2 October 2026: `github.com/caslanqa/test-ops`; the first `v0.1.0` is released automatically on the first merge to master.)_
- [x] **No quality gate before publish.** _(`ci.yml` is called as a reusable workflow.)_ The image is published without build/typecheck/test having passed → a separate CI job and `needs:` on publish.
- [x] **linux/amd64 only.** _(QEMU + `linux/amd64,linux/arm64`; index annotations for GHCR.)_ Runs under emulation on Apple Silicon / ARM servers → `setup-qemu-action` + `platforms: linux/amd64,linux/arm64`.
- [x] **An unversioned build becomes `latest`.** _(The raw line was removed; a `{{major}}.{{minor}}` tag was added.)_ `type=raw,value=latest,enable={{is_default_branch}}` makes main `latest` on a manual trigger; since `latest` is already produced for semver tags by `flavor: latest=auto`, this line should be removed.
- [x] **Docker Hub (optional).** _(Decision, 2 October 2026: GHCR only; Docker Hub will not be added.)_
- [x] **GHCR package visibility.** _(A package published with `GITHUB_TOKEN` inherits the public repo's visibility; the publish job verifies this with an anonymous `imagetools inspect` and warns if the image cannot be pulled.)_
- [x] **Automatic versioning and release.** _(No manual tags; see the flow above and `scripts/next-version.sh`.)_
- [x] **Pull-based installation.** _(3 October 2026: one-command installer `install.sh` (`curl … | bash`): checks Docker and the port before writing anything, creates `.env` with random secrets, starts the stack, creates the first admin on a fresh database and prints its password; re-running upgrades without touching `.env` or data; options `TESTOPS_DIR/PORT/VERSION/ADMIN_EMAIL`; ShellCheck in CI. 2 October 2026: `docker-compose.yml` now uses only `image:` (default `ghcr.io/caslanqa/testops:latest`); the build and Postgres's host port are in `docker-compose.override.yml`, which is loaded automatically inside the repo. `README.md`: quick start, first sign-in, day-to-day commands, configuration table, reverse proxy, installation with `docker run`, troubleshooting. If `DATABASE_URL` is missing, the image exits with an explanatory message; it retries migrations until the DB is ready, and Node runs as PID 1. GHCR 0.2.0 and a candidate image were installed in a clean folder by following the README steps, and the smoke tests passed.)_ The current `docker-compose.yml` contains `build:`; a release compose file that uses only `image:` + an install/upgrade/backup README (together with the backup item in section 0).
- [ ] **Image hardening.** Non-root user (with a migration step for existing root-owned volumes), SBOM/provenance (`sbom: true`), optional cosign signing.

## Recommended next step

Recommended order, by highest value/effort ratio:
1. Cross-project/cross-workspace ID validation + mandatory JWT secret (0.1 — active security vulnerabilities, small effort).
2. Attachment security + Postgres port + audit log + rate limiting.
3. Bulk submit atomicity, idempotency race, coverage bug, FR-072 pagination.
4. Lint/CI gate + smoke e2e tests + registry publish improvements (section 4; the same workflow work as the CI gate).
5. Attachment upload UI + milestone/API token/share/member management UIs (the backend is already ready, frontend work only).
6. JUnit XML import + first reporter (demonstrates the value of automation).
7. Dashboard/history/filtering (more valuable as usage grows).
8. Jira/GitHub + webhook integrations (highest effort, most external dependencies).

Confirm which item to continue with, and work will start from that item.
