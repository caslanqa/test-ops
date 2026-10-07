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
- [ ] **Per-case execution history and failure summary (FR-018, FR-019).** Add a paginated, newest-first endpoint and a Run history section in the case detail view. Group results by run while preserving each retry; show run link, timestamp, status, source, duration, environment/build, comments, failed steps, evidence and linked defects. Summarize the latest result and consecutive failures across distinct completed runs (retries do not count as separate runs). Keep this separate from case-definition change history. Existing `RunCase`, `Result`, `StepResult`, `caseSnapshot` and attachment/defect relations should supply the initial data; assess whether a schema change is needed only if a required field is missing.
- [ ] **Advanced filtering/search.** FR-061: filtering by case/requirement/run/date/status/user/tag/milestone — currently missing.
- [ ] **API rate limit + idempotency improvements.** (Can be handled together with item 0.) _(The rate limit part was done on 2 October 2026; the idempotency race is still open in section 0.)_
- [x] **API reference (FR-070, part of FR-077).** _(4 October 2026: the `@nestjs/swagger` CLI plugin documents every DTO field from its type and class-validator rules (34 schemas, none empty); Prisma enums are declared explicitly. Security mirrors AuthGuard — every operation requires the bearer token unless its handler is `@Public()`, so "Try it out" works after **Authorize**. The description covers authentication, the error format and rate limits with `Retry-After`. `GET /api/v1/system/info` returns the running version (`APP_VERSION` build arg). `tests/smoke/openapi.mjs` in CI guards all of this.)_ Remaining: response schemas (services return Prisma types, which need response DTOs), per-endpoint error responses, the `RateLimit-Policy` header.

## 2. Phase 3 — Integration and team scale

- [ ] **Jira/GitHub issue links (a real adapter).** Currently `Defect.externalProvider/externalIssueId/externalUrl` are just free-text fields; the adapter architecture from FR-053 (automatic issue creation, status sync) is missing. _(4 October 2026: GitHub first, moved forward into the API parity plan below; Jira stays here.)_
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
- [ ] Case-definition change history (FR-015) — API exists, no UI; keep it distinct from execution history (FR-018/FR-019).
- [x] The UI language is English. _(2 October 2026: all UI text, API error messages, and seed and startup script output are in English. 3 October 2026: the rest of the repository (code comments, docs, smoke tests, scripts, CI) was translated to English as well. Dates use `en-US`; search ignores the i/ı/İ distinction. There is no multi-language (i18n) infrastructure — if a second language is needed, the strings should be moved into a dictionary.)_
- [x] Light/dark theme. _(System / Light / Dark choice in the top bar and on the sign-in screen; the preference is stored in the browser and synced across tabs; `public/theme-init.js` applies it before the first paint (a separate file because the CSP does not allow inline scripts). Axe scans of 11 pages are clean in both themes.)_
- [x] **Help & support page.** _(4 October 2026: sidebar link on every page; API reference and OpenAPI spec links, copyable API base URL, a CI example for sending results, troubleshooting / bug report / release notes links and the running version. axe: no violations in light and dark; no horizontal scrolling from 320 px.)_
- [ ] **Installation branding Settings page (FR-088, FR-089, FR-094, FR-095).** Add Settings → Branding for Installation Admins; let them edit the display name, upload/replace a brand icon, or restore the `TestOps` defaults after installation. Keep the icon independent from the name, support light/dark themes, validate/sanitize assets, store them persistently and serve only approved public assets through the branding endpoint. Preserve settings/assets across upgrades; do not add branding prompts to the installer.

## 4. Release — container registry publish

**Reproducible build:** `package.json` `packageManager: pnpm@12.8.1` — Docker (corepack), CI (`pnpm/action-setup`) and local pnpm all use the same version; the version is recorded in the lockfile with its integrity hash.

**Current state (2 October 2026):** No manual steps. On every push/merge to master that changes the image's inputs (`apps/**`, `Dockerfile`, `package.json`, `pnpm-*`; since 3 October 2026), `release.yml` runs CI, computes the version with `scripts/next-version.sh` (the first version comes from `package.json`; after that `feat:` → minor, `type!:` / `BREAKING CHANGE:` → major, everything else → patch), publishes the image to `ghcr.io/caslanqa/testops`, verifies that it can be pulled anonymously, and then creates the `vX.Y.Z` tag + a GitHub Release (automatic notes). Because the tag is created with `GITHUB_TOKEN`, it does not trigger other workflows; the release happens within the same run.

- [x] **The repo is not on git/GitHub yet** — the workflow can never run. _(2 October 2026: `github.com/caslanqa/test-ops`; the first `v0.1.0` is released automatically on the first merge to master.)_
- [x] **No quality gate before publish.** _(`ci.yml` is called as a reusable workflow.)_ The image is published without build/typecheck/test having passed → a separate CI job and `needs:` on publish.
- [x] **linux/amd64 only.** _(QEMU + `linux/amd64,linux/arm64`; index annotations for GHCR.)_ Runs under emulation on Apple Silicon / ARM servers → `setup-qemu-action` + `platforms: linux/amd64,linux/arm64`.
- [x] **An unversioned build becomes `latest`.** _(The raw line was removed; a `{{major}}.{{minor}}` tag was added.)_ `type=raw,value=latest,enable={{is_default_branch}}` makes main `latest` on a manual trigger; since `latest` is already produced for semver tags by `flavor: latest=auto`, this line should be removed.
- [x] **Docker Hub (optional).** _(Decision, 2 October 2026: GHCR only; Docker Hub will not be added.)_
- [x] **GHCR package visibility.** _(A package published with `GITHUB_TOKEN` inherits the public repo's visibility; the publish job verifies this with an anonymous `imagetools inspect` and warns if the image cannot be pulled.)_
- [x] **Automatic versioning and release.** _(No manual tags; see the flow above and `scripts/next-version.sh`.)_
- [x] **Pull-based installation.** _(3 October 2026: one-command installer `install.sh` (`curl … | bash`): checks Docker and the port before writing anything, creates `.env` with random secrets, starts the stack, creates the first admin on a fresh database and prints its password; re-running upgrades without touching `.env` or data; options `TESTOPS_DIR/PORT/VERSION/ADMIN_EMAIL`; ShellCheck in CI. 2 October 2026: `docker-compose.yml` now uses only `image:` (default `ghcr.io/caslanqa/testops:latest`); the build and Postgres's host port are in `docker-compose.override.yml`, which is loaded automatically inside the repo. `README.md`: quick start, first sign-in, day-to-day commands, configuration table, reverse proxy, installation with `docker run`, troubleshooting. If `DATABASE_URL` is missing, the image exits with an explanatory message; it retries migrations until the DB is ready, and Node runs as PID 1. GHCR 0.2.0 and a candidate image were installed in a clean folder by following the README steps, and the smoke tests passed.)_ The current `docker-compose.yml` contains `build:`; a release compose file that uses only `image:` + an install/upgrade/backup README (together with the backup item in section 0).
- [ ] **Image hardening.** Non-root user (with a migration step for existing root-owned volumes), SBOM/provenance (`sbom: true`), optional cosign signing.

## 5. API parity with Qase (planned 4 October 2026)

Goal from the owner: the public API must cover everything, not only CI result upload. Reference: Qase TestOps API v1 has 89 endpoints (spec: github.com/qase-tms/specs, `testops-api/v1`); v2 adds only result upload and custom field reads. Qase's API has no requirement or workspace endpoints; TestOps keeps and extends its own.

**Step 1 — complete CRUD (one PR, no schema change):**
- [ ] Pagination (`limit`/`offset`, total in `X-Total-Count`, responses stay arrays so the UI and CI clients don't break) and filters on every list endpoint (FR-072, FR-061).
- [ ] Requirements: keep CRUD + case linking + coverage; add pagination/filters and list the linked cases of a requirement.
- [ ] Suites: get one. Milestones: get, update, delete. Runs: delete. Defects: delete. Workspaces: delete.
- [ ] Results: update, delete, and a project-wide list with filters (status, run, case, date).
- [ ] Attachments: list and delete.
- [ ] Test cases: bulk create.
- [ ] Projects: one list of all projects the user can access.
- [ ] System fields: the fixed values (priorities, severities, types, statuses, roles) from one endpoint.
- [ ] A smoke test for every new endpoint; OpenAPI guard (`tests/smoke/openapi.mjs`) stays green.

**Step 2 — defects ↔ GitHub issues (owner request):**
- [ ] Link an existing GitHub issue to a defect (URL or `owner/repo#number`), validated against the GitHub API; unlink.
- [ ] Create a GitHub issue from a defect (title, description, linked failed results).
- [ ] Status sync: closing the issue resolves the defect (webhook, with polling as fallback).
- [ ] Design first: where the GitHub credentials live (per project/workspace, token vs GitHub App), how they are stored (encrypted, never returned by the API), and permissions (who may link/create). Replaces today's free-text `Defect.externalProvider/externalIssueId/externalUrl`.

**Step 3 — Qase features TestOps doesn't have yet (one PR each: model + API + UI):**
- [ ] Environments (today free-text `environment` on plans/runs)
- [ ] Custom field definitions (today untyped `TestCase.customFields` JSON)
- [ ] Shared steps
- [ ] Configurations (today free-text `configuration`)
- [ ] Shared parameters / parameterized tests
- [ ] Test case reviews
- [ ] Search across entities (Qase has QQL; start from the step 1 filters)

## 6. Phase 4 — AI-assisted QA workflows (proposed)

Goal: provide a traceable, optional QA workflow from requirement review through test-run analysis, using the existing Requirement → TestCase → TestPlan/TestRun → Result → Defect domain. This is a staged assistant with explicit human approval, not an unconstrained autonomous agent. The core product must continue to work with AI unconfigured.

**Step 1 — provider and workflow foundation:**
- [ ] Implement the currently missing audit-log writes before enabling AI workflows; record the initiating user, approval decisions and domain mutations without storing provider secrets.
- [ ] Add an Installation Admin role, separate from workspace roles; grant it to the first seeded administrator and restrict further grants/revocations to Installation Admins.
- [ ] Add the authenticated system Settings → AI page for Installation Admins. Configure provider, model, optional endpoint and credential after installation; include enable/disable, configured status and a connection test that sends no project content. Do not put provider/model/API-key prompts in the installer.
- [ ] Add a provider adapter boundary for hosted providers and, where supported, an operator-managed local endpoint. Keep provider requests and credentials on the server; no configured provider means AI is disabled and the rest of the app keeps working.
- [ ] Store credentials encrypted at rest with a stable installation-level encryption key generated and preserved by the installer. Mask saved values, never return/log them, and allow replacement. Keep the encryption key distinct from the provider API key.
- [ ] Use one configured default model across specialist workflow roles for the first release; roles differ by versioned skill, scoped context and output schema. Defer per-role model routing until quality/cost measurements justify the extra configuration.
- [ ] Disclose the selected provider and what project content is sent before enabling AI. Record the provider/model used by each workflow run; initially apply one installation-level configuration to all workspaces.
- [ ] Add persisted workflow definitions/versions, workflow runs, step runs, artifacts and approval state. Record status, timestamps, initiator, provider/model and skill version, validated inputs/outputs, errors and bounded retry/cancel state.
- [ ] Run long AI steps in a background worker rather than inside a request. Start with PostgreSQL-backed jobs/state so Redis is not a required deployment dependency; define safe claiming/retry behavior for multiple app processes.
- [ ] Define agents as focused roles with versioned skills/instructions, allowlisted project-scoped tools and strict output schemas. The orchestrator, rather than a free-form coordinator agent, determines step order and approval gates.
- [ ] Add configurable timeouts, per-user/project rate and usage limits, secret-safe logging, provider data disclosure, and audit records for workflow actions and approved mutations.

**Step 2 — requirement to reviewed test cases:**
- [ ] Requirement Reviewer: check clarity, testability, risks and acceptance criteria; return structured findings and questions.
- [ ] Test Designer: draft positive, negative and boundary cases in the existing TestCase/steps shape.
- [ ] Coverage Auditor: map drafts to criteria, identify uncovered areas and likely duplicates, and allow at most a bounded revision.
- [ ] Add a UI/API to review, edit, accept or reject the generated artifact. Persist accepted cases and requirement links through existing permission-checked services only after explicit confirmation.

**Step 3 — run planning and analysis:**
- [ ] Test Planner: propose a plan/run scope from approved coverage and risk; require user confirmation to create the plan/run. Initial implementation uses existing manual and CI execution paths and does not run arbitrary test code.
- [ ] Trigger Run Analyzer after a run is completed. Analyze run cases, result attempts, step results and comments; return a report with failure clusters and possible causes clearly marked as hypotheses.
- [ ] Defect Writer: produce defect drafts linked to failed results; require authorized user approval before creating a defect or sending anything to an external tracker.
- [ ] Add workflow history, step detail, generated-artifact review, resume, retry and cancellation views/API. Evaluate attachment/log extraction separately; the first analyzer should use structured results and comments.

**Acceptance criteria:**
- [ ] A user can start a requirement review and receive schema-validated findings and editable case drafts scoped to a project.
- [ ] Draft artifacts may be stored with the workflow, but no case/plan/run/defect domain record is created until approval; normal RBAC and project-scope checks apply at approval time.
- [ ] Completing a run can start an asynchronous analysis whose report and defect drafts are persisted, attributable to the initiating user and reviewable later.
- [ ] Provider outage, invalid output or disabled AI does not prevent manual case management, run completion or CI result ingestion.
- [ ] Workflow steps cannot issue arbitrary SQL/shell/network calls; provider secrets do not appear in the browser or application logs.
- [ ] Only Installation Admins can edit/test AI provider settings; encrypted credentials are never returned to the UI, and a saved key can be replaced without displaying its old value.

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
