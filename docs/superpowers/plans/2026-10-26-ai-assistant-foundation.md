# AI assistant foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the AI assistant foundation (settings owned by a workspace or a project, provider adapters, workflow engine and worker, audit) and the requirement-to-cases workflow end to end, with its web pages.

**Architecture:** One Nest `AiModule`. A settings service resolves the effective setting of a project (project override, else workspace default). Provider adapters call models through a hardened outbound helper derived from the CI webhook's `safePost`. A worker loop in the API process runs persisted runs and steps. Approving a run writes cases through the existing `TestCasesService`. The web app gets settings pages for workspace and project admins and a run page reached from Requirements.

**Tech Stack:** NestJS + Prisma (Postgres), Node 22 `http`/`https` (no SDK, no new dependency), React/Vite web, smoke scripts against the Docker stack.

**Spec:** `docs/superpowers/specs/2026-10-23-ai-assistant-foundation-design.md` (approved 2026-10-26). The role rules it relies on are in `docs/superpowers/specs/2026-10-26-role-hierarchy-design.md`.

**Branch:** `feat/ai-assistant-foundation`, created from `master` after PR #36 (the role ladder) has merged. The old local branch of that name has no commits: remove it with `git branch -d feat/ai-assistant-foundation` and create it again.

## Global Constraints

- Who may define, read, test and remove settings: a workspace admin (the workspace default, and any project's setting) and a project admin (their project's setting). Tester, Automation, Viewer: `403`. API tokens: `403` through `@WebSessionOnly()`. Every project member can read only `GET /projects/:projectId/ai/status`.
- Effective setting: the project's own row, else the workspace's, else none. A project row replaces the workspace one whole. A project row with `enabled=false` turns AI off for that project.
- Credential: AES-256-GCM, key `AI_ENCRYPTION_KEY` (32 bytes, hex), never returned (only `hasCredential`), never logged, never in audit metadata, snapshots or step rows. Changing the endpoint clears the saved credential unless a new one comes in the same request. With no key set, saving a credential fails with a clear error and AI stays disabled.
- Addresses: private addresses are allowed; link-local (`169.254.0.0/16`, `fe80::/10`), "this network" (`0.0.0.0/8`), multicast and reserved ranges are always refused; checked at connect time; redirects not followed; for a private-address endpoint only the HTTP status and a fixed message are shown or stored; for a public one the error text is cut to 500 characters with the credential removed.
- Limits and caps: response cap 2 MiB; `maxOutputTokens` 8192, `requestTimeoutMs` 120000, `maxRunsPerUserPerDay` 20 (defaults); worker poll 2 s, run lock 5 minutes, shutdown grace 10 s; at most 5 model calls per run; `extraContext` at most 8000 characters; at most 200 other cases sent for duplicate detection; review: 20 criteria, 30 findings; drafts: 25 cases.
- `enabled` can only be turned on while `testedAt` is set; any change to provider, model, endpoint or credential clears `testedAt`.
- All repository text (code, comments, docs, tests, commits) is English; UI text is English and follows the accessibility rules in the repository instructions (labels, error association, live regions, keyboard operation). The reference tool is never named in repository files, commits or PRs. Commit messages end with the attribution trailer the session gives.

## Choices the plan makes where the spec leaves one open

1. `SecretBox` (`apps/api/src/common/secret-box.ts`) already is AES-256-GCM with a `v1:` format; it learns to take a raw 32-byte key instead of a second class. Stored format stays `v1:` + base64(iv | tag | ciphertext).
2. Approve passes `requirementIds: [run.input.requirementId]` in every draft to `TestCasesService.createMany`, which links them in the same transaction. `RequirementsService.linkCases` is not used.
3. The 5-call cap counts every attempt, retries included; the run that reaches it fails with "Model call limit reached".
4. A change that clears `testedAt` also sets `enabled=false`.
5. OpenAI-compatible `endpoint` is the base URL including `/v1`; the adapter appends `/chat/completions`. Anthropic `endpoint` is the base URL (default `https://api.anthropic.com`); the adapter appends `/v1/messages`.
6. Ranges: `maxOutputTokens` 256 to 32000, `requestTimeoutMs` 5000 to 600000, `maxRunsPerUserPerDay` 1 to 1000. Starting a run over the daily limit answers `429`.
7. Approve claims the run with a compare-and-set (`AWAITING_APPROVAL` to `COMPLETED`), then creates the cases; if creation fails it sets the run back to `AWAITING_APPROVAL` and rethrows.

## Review Focus

1. Approve called twice at once, or after the requirement was archived or removed: one set of cases, `409`/`404`, run stays approvable. (Task 5)
2. The approver was demoted or removed, or the project was archived, after the run started: `403`/`409`, nothing written. (Task 5)
3. A provider that answers with invalid JSON, a schema-invalid object, an oversized body, a redirect or a 500 with a body: bounded retry, run `FAILED`, no partial cases, no body shown for a private address. (Tasks 3 and 4)
4. The app dies mid-run: an expired lock is claimed again and resumes at the first step without output; finished steps are not repeated. (Task 4)
5. The setting is turned off, deleted or re-pointed while a run waits or after it starts: the run fails cleanly, the credential never follows a changed endpoint. (Tasks 2 and 4)

## How tests run (every task)

- API tasks: rebuild and run against the Docker stack: `docker compose up -d --build --wait app`, then `node tests/smoke/ai.mjs`. With no stack, `bash scripts/start.sh` first. Login `admin@testops.local` / `ChangeMe123!`. A task's test command is the `node tests/smoke/ai.mjs` run that covers its checks; the whole suite runs in Task 8.
- `tests/smoke/ai.mjs` follows `tests/smoke/roles.mjs`: its own `call`/`ok`/`check`/`expectStatus` helpers (wait out `429` for 61 s), its own users made by invitation, its own workspace.
- The fake provider is a small HTTP server started inside the app container, like the receiver in `tests/smoke/webhooks.mjs --deliver` (`docker compose exec -T app node -e <code>`), listening on `127.0.0.1:8098`. It answers by the request's `model`: `ok`, `bad-json`, `invalid`, `fail500` (body contains `INTERNAL-SECRET-BODY`), `huge` (over 2 MiB), `redirect`, `slow` (waits 20 s), `flaky` (first call malformed), `revise` (the first AUDIT asks for a revision). `GET /__last` returns the last request's path, headers and body. It speaks both the chat completions and the Messages formats.
- Pure helpers are checked inside the container: `docker compose exec -T app node -e "const m=require('./dist/...'); ..."`.
- Database facts (audit rows, cascades, expiring a lock) use `docker compose exec -T postgres psql -U testops -d testops -At -c "..."`.
- Web tasks: `pnpm --filter @testops/web run lint` and `pnpm --filter @testops/web exec tsc -b`, plus a Playwright browser check kept in the session scratchpad, never in the repository (the web app has no unit test framework).

---

### Task 1: Encryption key and environment plumbing

**Files:**
- Modify: `apps/api/src/common/secret-box.ts`, `apps/api/src/config/configuration.ts`, `scripts/ensure-env.sh`, `install.sh`, `.env.example`, `docker-compose.yml`, `deploy/coolify/docker-compose.yml`, `README.md` (configuration table), `.github/workflows/ci.yml`
- Create: `tests/smoke/ensure-env.sh`

**Interfaces:**
- Produces: `new SecretBox(secret: string | Buffer)` (a `Buffer` is used as the 32-byte key as it is; a string is derived with HKDF as before); `ConfigService.get<Buffer | null>("ai.encryptionKey")`: `null` when `AI_ENCRYPTION_KEY` is empty, a 32-byte `Buffer` for 64 hex characters, startup error "AI_ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes); generate one with: openssl rand -hex 32" otherwise.

- [ ] **Step 1: Write the failing test** `tests/smoke/ensure-env.sh` (bash, `set -euo pipefail`): copy `scripts/ensure-env.sh` and `.env.example` into a temp tree (`<tmp>/scripts/`, `<tmp>/.env.example`; the script runs from its parent directory) and assert:
  - fresh run: `.env` has `JWT_SECRET=` and `AI_ENCRYPTION_KEY=` each followed by 64 hex characters, and the two differ;
  - a second run leaves `.env` byte-identical (`cmp`);
  - a `.env` with a valid `JWT_SECRET` and no `AI_ENCRYPTION_KEY` gains one and keeps its `JWT_SECRET`;
  - a `.env` that already has an `AI_ENCRYPTION_KEY` keeps it.
- [ ] **Step 2: Run it to see it fail.** Run: `bash tests/smoke/ensure-env.sh`. Expected: FAIL on the first assertion (no `AI_ENCRYPTION_KEY` line).
- [ ] **Step 3: Implement.** `ensure-env.sh`: one function that fills a named variable with `openssl rand -hex 32` (fallback `od`) when it is empty (and, for `JWT_SECRET`, also when it is the placeholder `change-me-in-production`), writing through `mktemp` like today; keep the JWT message, add ".env: generated a random AI_ENCRYPTION_KEY (saved AI provider keys need it; keep a copy of .env)". Never regenerate a key that is set. `install.sh`: fresh `.env` gets `AI_ENCRYPTION_KEY=$(random_hex 32)`; an existing `.env` without a value gets one through `env_set`. `.env.example`: `AI_ENCRYPTION_KEY=` with a comment (what it encrypts; losing it means saved provider keys must be entered again). `docker-compose.yml`: `AI_ENCRYPTION_KEY: ${AI_ENCRYPTION_KEY:-}`. Coolify compose: `AI_ENCRYPTION_KEY=${SERVICE_HEX_64_AIENCRYPTIONKEY}`. `SecretBox` and `configuration.ts` per Interfaces. README configuration table: one row for `AI_ENCRYPTION_KEY`. `ci.yml` verify job: add `tests/smoke/ensure-env.sh` to the shellcheck line and a step `bash tests/smoke/ensure-env.sh` after it.
- [ ] **Step 4: Run to verify.** Run: `bash tests/smoke/ensure-env.sh && shellcheck install.sh scripts/*.sh tests/smoke/ensure-env.sh apps/api/docker-entrypoint.sh && pnpm --filter @testops/api exec tsc --noEmit`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: generate and pass an encryption key for AI credentials`.

### Task 2: Settings storage and API

**Files:**
- Modify: `apps/api/prisma/schema.prisma`, `apps/api/src/app.module.ts`
- Create: migration `apps/api/prisma/migrations/20261026130000_ai_settings/migration.sql`, `apps/api/src/audit/audit.module.ts`, `apps/api/src/audit/audit.service.ts`, `apps/api/src/ai/ai.module.ts`, `apps/api/src/ai/ai-settings.service.ts`, `apps/api/src/ai/ai-settings.controller.ts`, `apps/api/src/ai/dto/save-ai-settings.dto.ts`, `tests/smoke/ai.mjs`

**Interfaces:**
- Consumes: `AccessControlService.requireWorkspaceRole(userId, workspaceId, [WorkspaceRole.ADMIN])`, `requireProjectRoleOrWorkspaceAdmin(userId, projectId, [ProjectRole.ADMIN], { allowArchived })`, `requireProjectAccessOrWorkspaceAdmin(userId, projectId)`; `SecretBox`; `ConfigService "ai.encryptionKey"`.
- Produces:
  - Prisma `model AiSettings` (`@@map("ai_settings")`): `id`, `workspaceId String? @unique`, `projectId String? @unique`, `enabled Boolean @default(false)`, `provider AiProviderKind` (enum `ANTHROPIC | OPENAI_COMPATIBLE`), `model`, `endpoint String?`, `credentialCipher String?`, `maxOutputTokens Int @default(8192)`, `requestTimeoutMs Int @default(120000)`, `maxRunsPerUserPerDay Int @default(20)`, `testedAt DateTime?`, `createdAt`, `updatedAt`, `updatedById String?`; both owners cascade on delete. The migration adds `CHECK (("workspaceId" IS NULL) <> ("projectId" IS NULL))` in raw SQL.
  - `AuditService.record(entry: { userId: string; workspaceId?: string; projectId?: string; action: string; entityType: string; entityId?: string; metadata?: Prisma.InputJsonValue }): Promise<void>` (global module).
  - `type AiSource = "PROJECT" | "WORKSPACE" | "NONE"`; `AiSettingsService.resolve(projectId: string): Promise<{ source: AiSource; settings: AiSettings | null }>` (the row, `credentialCipher` included; server side only); `AiSettingsService.openCredential(settings: AiSettings): string | null`.
  - Public view `AiSettingsView`: `{ id, scope: "WORKSPACE" | "PROJECT", enabled, provider, model, endpoint, hasCredential, maxOutputTokens, requestTimeoutMs, maxRunsPerUserPerDay, testedAt, updatedAt }`.
  - Routes (all `@WebSessionOnly()` except status): `GET /projects/:projectId/ai/status` returns `{ enabled, source }`; `GET|PUT|DELETE /workspaces/:workspaceId/ai`; `GET|PUT|DELETE /projects/:projectId/ai/settings`. `GET` workspace returns `AiSettingsView | null`; `GET` project returns `{ own: AiSettingsView | null, inherited: Pick<AiSettingsView, "provider" | "model" | "endpoint" | "enabled" | "hasCredential"> | null, source }`. `PUT` body `SaveAiSettingsDto`: `provider`, `model`, `endpoint?`, `credential?`, `clearCredential?`, `enabled?`, `maxOutputTokens?`, `maxRunsPerUserPerDay?`, `requestTimeoutMs?`, ranges as in the choices above; `DELETE` answers `204`.
  - Audit actions `ai.settings.updated` (metadata: changed field names, and `endpointHost` when the endpoint changed; never the credential) and `ai.settings.removed`, `entityType` `ai_settings`, `entityId` the row id, `workspaceId` or `projectId` set.

- [ ] **Step 1: Write the failing checks** in `tests/smoke/ai.mjs` (setup: workspace `W`, project `P` with key `AI`, users made by invitation as in `roles.mjs`: a project admin, a tester, an automation user, a viewer; the workspace admin is the seed admin):
  - Tester, Automation, Viewer: `GET`, `PUT`, `DELETE /projects/P/ai/settings` `403`; `GET /projects/P/ai/status` `200`.
  - Project admin: `GET` and `PUT /workspaces/W/ai` `403`. An API token of the workspace admin (created the way the existing smoke tests do): both route families `403`.
  - Workspace admin `PUT /workspaces/W/ai` with `OPENAI_COMPATIBLE`, model `m1`, endpoint `http://127.0.0.1:8098/v1`, credential `sk-secret-1`: `200`, `hasCredential` true, the response text contains neither the credential nor `credentialCipher`; status `{ enabled: false, source: "WORKSPACE" }`.
  - `PUT … enabled: true` before any test: `409`.
  - Project admin `PUT /projects/P/ai/settings`: `200`, status source `PROJECT`; `GET` shows `own` and `inherited` (inherited has `hasCredential` true and no `credential*` field). Same endpoint without credential keeps `hasCredential`; another endpoint without credential makes it false.
  - A workspace admin who is not a project member can `GET` and `PUT` the project setting.
  - `DELETE` the project setting: `204`, source back to `WORKSPACE`.
  - Validation `400`: `ftp://x`, `http://user:pw@host/v1`, `OPENAI_COMPATIBLE` without an endpoint, `maxOutputTokens: 100`.
  - psql: `ai_settings` rows carry no plaintext credential; audit rows `ai.settings.updated` exist and their metadata lacks `sk-secret-1`; deleting the project removes its row; inserting a row with both owners set (or neither) fails.
  - `--no-key` mode (run with `AI_ENCRYPTION_KEY=` empty): `PUT` with a credential answers `409` naming `AI_ENCRYPTION_KEY`; `PUT` without a credential answers `200`.
- [ ] **Step 2: Run to see it fail.** Run: `node tests/smoke/ai.mjs`. Expected: FAIL with `404` on the AI routes.
- [ ] **Step 3: Implement** the model and migration (`npx prisma migrate dev` is not available in Docker builds: write the SQL by hand from `prisma migrate diff`, then append the CHECK), `AuditModule`/`AuditService`, `AiModule` (imports `AuditModule`; registered in `app.module.ts`), the service and controller. `PUT` is an upsert: clear `credentialCipher` when the normalised endpoint (trimmed, no trailing slash) differs from the saved one and no `credential` came; clear `testedAt` (and set `enabled=false`) when provider, model, endpoint or credential changed; refuse `enabled: true` with `409` "Run the connection test first" unless `testedAt` remains set, and `409` when provider needs a credential (`ANTHROPIC`) and none is saved. Endpoint validation here: `http`/`https` only, no credentials in the URL. Saving a credential with no `AI_ENCRYPTION_KEY` answers `409` "AI_ENCRYPTION_KEY isn't set on this server, so a credential can't be saved".
- [ ] **Step 4: Run to verify.** Run: `docker compose up -d --build --wait app && node tests/smoke/ai.mjs`, then `AI_ENCRYPTION_KEY= docker compose up -d --wait app && node tests/smoke/ai.mjs --no-key`, then restore with `docker compose up -d --wait app`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(api): let workspace and project admins define AI settings`.

### Task 3: Outbound helper, provider adapters and connection test

**Files:**
- Modify: `apps/api/src/webhooks/safe-post.ts`, `apps/api/src/ai/ai-settings.service.ts`, `apps/api/src/ai/ai-settings.controller.ts`, `tests/smoke/ai.mjs`
- Create: `apps/api/src/ai/providers/provider.ts`, `apps/api/src/ai/providers/anthropic.ts`, `apps/api/src/ai/providers/openai-compatible.ts`, `apps/api/src/ai/provider-error.ts`

**Interfaces:**
- Consumes: Task 2's `resolve`, `openCredential`, `AiSettings`.
- Produces:
  - `safePost` options gain `refuseReserved?: boolean` and `maxChars?: number` (default 1000, the webhook behavior); `export function isReservedAddress(address: string): boolean` (link-local, "this network", multicast, reserved; IPv6 forms that carry an IPv4 address refused whole; IPv6 loopback `::1` is not reserved); `export function assertAiEndpoint(raw: string): URL` (http/https, no credentials, refuses a reserved IP literal; `localhost` and private literals allowed) throwing `AiEndpointError`.
  - `interface AiProvider { generate(request: { system: string; user: string; schemaName: string; schema: object }): Promise<{ output: unknown; usage: { inputTokens: number; outputTokens: number } }> }`; `class AiProviderError extends Error { retryable: boolean }`; `createAiProvider(input: { provider: "ANTHROPIC" | "OPENAI_COMPATIBLE"; model: string; endpoint: string | null; credential: string | null; maxOutputTokens: number; requestTimeoutMs: number }): AiProvider`.
  - `scrubProviderError(text: string, credential: string | null): string` (cuts to 500 characters, removes every occurrence of the credential); `providerFailureMessage(status: number, endpointIsPrivate: boolean, text: string, credential: string | null): string` (private endpoint: `Provider answered HTTP <status>` only).
  - `AiSettingsService.test(userId: string, scope: { workspaceId: string } | { projectId: string }): Promise<{ ok: boolean; latencyMs: number; error?: string }>`; routes `POST /workspaces/:workspaceId/ai/test` and `POST /projects/:projectId/ai/settings/test` (`@WebSessionOnly()`), same authorization as the matching `PUT`. A pass sets `testedAt`; a failure clears it and sets `enabled=false`. The request is a fixed connection-test prompt and the schema `{ ok: boolean }`, no project content.

- [ ] **Step 1: Write the failing checks** (extend `ai.mjs`; start the fake provider in the container; before this step read current Anthropic Messages and chat-completions structured-output documentation through Context7 and make the fake speak exactly those shapes):
  - Model `ok`: test answers `{ ok: true, latencyMs }`, `testedAt` is set, then `PUT enabled: true` is `200` and status is `{ enabled: true, source: "WORKSPACE" }`. `/__last` shows `authorization: Bearer sk-secret-1`, path `/v1/chat/completions`, a `response_format` of type `json_schema`, and a body without the project's name or key.
  - A `PUT` that changes only the model clears `testedAt` and sets `enabled` false.
  - Models `fail500`, `bad-json`, `invalid`, `huge`, `redirect`: test answers `ok: false`; `fail500`'s `error` contains `500` and not `INTERNAL-SECRET-BODY`; `huge` and `redirect` are failures too; `testedAt` null afterwards.
  - Provider `ANTHROPIC` with endpoint `http://127.0.0.1:8098`: test `ok: true`; `/__last` shows path `/v1/messages`, `x-api-key`, an `anthropic-version` header and a forced `tool_choice`.
  - `PUT` with endpoint `http://169.254.169.254/v1` and with `http://[::ffff:a9fe:a9fe]/v1`: `400`; `http://localhost:8098/v1`: `200`.
  - Roles: Tester, Viewer, Automation `403` on both test routes; project admin `403` on the workspace one.
  - Container helpers: `isReservedAddress` is true for `169.254.169.254`, `fe80::1`, `0.0.0.0`, `224.0.0.1`, `::ffff:169.254.169.254` and false for `127.0.0.1`, `10.1.2.3`, `192.168.1.5`, `172.16.0.1`, `::1`, `8.8.8.8`; `scrubProviderError("bad key sk-1 here", "sk-1")` has no `sk-1`, and a 2000-character input comes back at most 500 long; a public-endpoint `providerFailureMessage` keeps the cut text and a private one does not.
- [ ] **Step 2: Run to see it fail.** Run: `node tests/smoke/ai.mjs`. Expected: FAIL (`404` on the test routes, helpers missing).
- [ ] **Step 3: Implement** the helper changes (webhook behavior unchanged: `refuseReserved` and `maxChars` are optional), the two adapters (Anthropic: Messages API, one tool with `input_schema`, forced `tool_choice`, output from the tool input, header `x-api-key`; OpenAI-compatible: `response_format: { type: "json_schema", json_schema: { name: schemaName, schema, strict: true } }`, `Authorization: Bearer` only when a credential exists, a server that rejects `json_schema` produces a connection-test message saying so), both through `safePost` with `allowPrivate: true, refuseReserved: true, maxChars: 2 * 1024 * 1024` and `timeoutMs` from settings, `max_tokens` from settings, no streaming, errors carrying `retryable` (network, 429, 5xx), the response parsed once and checked for the usage fields; an answer that reaches the 2 MiB cap is a failure ("answer larger than 2 MiB"), never a truncated parse; any non-2xx status (a redirect included) is a failure. Wire `assertAiEndpoint` into the `PUT` validation of Task 2. Implement `test` and the two routes.
- [ ] **Step 4: Run to verify.** Run: `docker compose up -d --build --wait app && node tests/smoke/ai.mjs && node tests/smoke/webhooks.mjs` (the webhook suite proves `safePost` still behaves). Expected: all PASS.
- [ ] **Step 5: Commit** `feat(api): call AI providers through a hardened outbound helper`.

### Task 4: Runs, worker and the requirement-to-cases workflow

**Files:**
- Modify: `apps/api/prisma/schema.prisma`, `apps/api/src/ai/ai.module.ts` (imports `TestCasesModule`; export `TestCasesService` from it if it does not already), `tests/smoke/ai.mjs`
- Create: migration `apps/api/prisma/migrations/20261026140000_ai_workflow_runs/migration.sql`, `apps/api/src/ai/ai-runs.service.ts`, `apps/api/src/ai/ai-runs.controller.ts`, `apps/api/src/ai/ai-worker.service.ts`, `apps/api/src/ai/dto/start-run.dto.ts`, `apps/api/src/ai/validate-output.ts`, `apps/api/src/ai/skills/{requirement-reviewer,test-designer,coverage-auditor}.ts`

**Interfaces:**
- Consumes: Task 2 `resolve`/`openCredential`, Task 3 `createAiProvider`/`AiProviderError`, `AuditService.record`, `AccessControlService.requireProjectRoleOrWorkspaceAdmin(userId, projectId, [ProjectRole.ADMIN, ProjectRole.TESTER])`.
- Produces:
  - Prisma `AiWorkflowRun` (`ai_workflow_runs`: `id`, `type` enum `REQUIREMENT_TO_CASES`, `projectId` (cascade), `createdById`, `status` enum `QUEUED|RUNNING|AWAITING_APPROVAL|COMPLETED|FAILED|CANCELLED`, `input Json`, `providerSnapshot Json`, `result Json?`, `error String?`, `availableAt`, `lockedUntil DateTime?`, `createdAt`, `startedAt?`, `finishedAt?`; index on `(status, availableAt)`, on `(projectId, createdAt)`) and `AiWorkflowStep` (`ai_workflow_steps`: `id`, `runId` (cascade), `name`, `skillVersion`, `status`, `attempt`, `input Json`, `output Json?`, `usage Json?`, `error String?`, `startedAt`, `endedAt?`; unique `(runId, name, attempt)`).
  - `interface AiSkill<I, O> { name: "REVIEW" | "DESIGN" | "AUDIT" | "REVISE"; version: number; schemaName: string; schema: object; system: string; user(input: I): string; validate(output: unknown): O }` and `validateAgainst(schema: object, value: unknown): string | null` (error text or null; supports `type`, `properties`, `required`, `items`, `enum`, `maxItems`, `maxLength`, `minimum`, `maximum`, `additionalProperties: false`).
  - Output shapes exactly as in the spec: review (`summary`, `acceptanceCriteria` at most 20, `findings` at most 30 with `kind`/`severity`/`text`), design (`cases` at most 25 with `title`, `preconditions?`, `steps[{action, expectedResult?}]`, `priority`, `type`, `kind`), audit (`coverage`, `uncovered`, `duplicates`, `revisionNeeded`, `notes`).
  - Routes under `projects/:projectId/ai/runs`: `POST` `{ type: "REQUIREMENT_TO_CASES", requirementId, extraContext? }` answers `202 { runId }`; `GET /:runId`; `GET ?requirementId=` (paged like the other list endpoints, newest first); `POST /:runId/cancel`. Run view: `{ id, type, projectId, status, input, providerSnapshot: { provider, model, endpointHost, source, settingsId }, result, error, createdAt, startedAt, finishedAt, steps: [{ name, skillVersion, status, attempt, usage, error, startedAt, endedAt }] }` (no prompts, no step input or output). Start: write role needed; `409 AI is not enabled` when the effective setting is missing or disabled; `404` for a requirement of another project or an archived one; `400` for `extraContext` over 8000; `429` over the daily limit (the caller's runs of the last 24 hours across projects, against the effective setting). Any project member can read runs; cancel needs the write role and answers `409` outside `QUEUED|RUNNING|AWAITING_APPROVAL`.
  - Audit actions `ai.run.started`, `ai.run.cancelled`, `ai.run.failed` (later `ai.run.approved`).
  - `AiWorkerService` (`OnModuleInit`/`OnModuleDestroy`): a 2 s loop claiming one run with `UPDATE … WHERE id = (SELECT id … WHERE status='QUEUED' AND "availableAt" <= now() ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, plus runs `RUNNING` whose `lockedUntil` has passed; lock 5 minutes, extended after every step; resume at the first step with no completed output; re-read the run between steps and stop when cancelled; resolve the effective setting once per claim and fail with "AI is not enabled for this project" when missing or disabled; one retry for a retryable provider error or invalid output; the 5-call cap counts every attempt; `REVISE` then a second `AUDIT` at most once; on success store `result = { review, drafts, audit }` and `AWAITING_APPROVAL`; on shutdown stop claiming and wait up to 10 s for the in-flight call.
  - Data sent: requirement title and description, `extraContext`, the cases already linked to it (title and steps), and the id and title of up to 200 other non-archived cases of the project, newest-updated first.

- [ ] **Step 1: Write the failing checks** (extend `ai.mjs`; settings from Task 3 enabled, model `ok`):
  - Start: Viewer and Automation `403`; Tester `202`; `extraContext` of 8001 characters `400`; another project's requirement `404`; an archived requirement `404`; setting switched off `409`; non-member `403`.
  - A run reaches `AWAITING_APPROVAL` within 30 s: steps `REVIEW`, `DESIGN`, `AUDIT` in order, each with `skillVersion` and `usage`; `result.review/drafts/audit` present, every draft has a `kind`; the view has no `credential`, no prompt, and `providerSnapshot.endpointHost` is `127.0.0.1` with `source` `WORKSPACE`. No case was created. The fake's `/__last` user text contains the requirement title and none of another project's data.
  - Model `revise`: steps include `REVISE` then a second `AUDIT`, five model calls in all. Model `flaky`: completes, the retried step has `attempt` 2. Model `invalid`: run `FAILED` with an `error`, no cases created, two calls for the failing step only. Provider `fail500`: `FAILED`, run `error` lacks `INTERNAL-SECRET-BODY`.
  - Cancel: from `AWAITING_APPROVAL` `200`; a `slow` run cancelled while `RUNNING` stays `CANCELLED` after the step returns; cancelling a finished run `409`.
  - Limit: `maxRunsPerUserPerDay: 2` makes the third start by one user `429`.
  - List by `requirementId` is newest first; a Viewer can read a run; a non-member gets `403`.
  - Settings off while a run waits: insert a `QUEUED` run through psql with `availableAt` one hour ahead (copy a finished run row with `INSERT … SELECT`), switch the project setting off, set `availableAt = now()`: the run ends `FAILED` with "AI is not enabled for this project".
  - Crash recovery: start a `slow` run, wait for `RUNNING`, `docker compose kill app`, `docker compose up -d --wait app`, expire the lock with psql (`"lockedUntil" = now() - interval '1 minute'`): the run reaches `AWAITING_APPROVAL` and a step that finished before the crash was not run again (one row for it).
  - psql: audit rows `ai.run.started`, `ai.run.cancelled`, `ai.run.failed` exist.
- [ ] **Step 2: Run to see it fail.** Run: `node tests/smoke/ai.mjs`. Expected: FAIL with `404` on the run routes.
- [ ] **Step 3: Implement** models, migration (hand-written SQL as in Task 2), validators, the three skills (system prompts kept in code, `version: 1`), the service, controller and worker, and register them in `AiModule`.
- [ ] **Step 4: Run to verify.** Run: `docker compose up -d --build --wait app && node tests/smoke/ai.mjs`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(api): run requirement-to-cases workflows in a background worker`.

### Task 5: Approve

**Files:**
- Modify: `apps/api/src/ai/ai-runs.service.ts`, `apps/api/src/ai/ai-runs.controller.ts`, `tests/smoke/ai.mjs`
- Create: `apps/api/src/ai/dto/approve-run.dto.ts`

**Interfaces:**
- Consumes: Task 4 run model, `TestCasesService.createMany(userId, projectId, dto: BulkCreateTestCasesDto)`.
- Produces: `POST /projects/:projectId/ai/runs/:runId/approve` with `{ suiteId?: string; cases: CaseDraft[] }` where `CaseDraft = { title: string; preconditions?: string; steps?: { action: string; expectedResult?: string }[]; priority?: CasePriority; type?: CaseType; kind: "positive" | "negative" | "boundary" | "error" }` (`ApproveRunDto`: 1 to 25 drafts, same rules as `CreateTestCaseDto`); answer `200 { runId, createdCaseIds: string[] }`; audit `ai.run.approved` with the created ids.

- [ ] **Step 1: Write the failing checks:**
  - Approve with an edited title: `200`; the cases exist with tags `ai-generated` and the draft `kind`, are linked to the requirement, and sit in `suiteId` when given; the run is `COMPLETED` with `result.createdCaseIds`; audit `ai.run.approved` row.
  - Second approve `409`; two approves at once: exactly one `200` and one `409`, and the case count equals the draft count once.
  - `400` and nothing created: 26 drafts, no drafts, a draft without `title`, an invalid `priority`; the run stays `AWAITING_APPROVAL`.
  - A `suiteId` of another project: `404`, no cases, run still approvable (then a correct approve works).
  - The requirement archived after the run: `409`; the requirement removed (as the existing API allows): `404`; run stays approvable in both cases.
  - The starter demoted to Viewer: `403`; the project archived: `409`; a Viewer: `403`; the run of another project addressed through this project's URL: `404`.
- [ ] **Step 2: Run to see it fail.** Run: `node tests/smoke/ai.mjs`. Expected: FAIL with `404` on `approve`.
- [ ] **Step 3: Implement** per choices 2 and 7: check role, run state and project, re-check the requirement (`404` missing, `409` archived), compare-and-set the run to `COMPLETED`, call `createMany` with `requirementIds` and tags in each case, record `createdCaseIds` and the audit row; on any failure set the run back to `AWAITING_APPROVAL` and rethrow.
- [ ] **Step 4: Run to verify.** Run: `docker compose up -d --build --wait app && node tests/smoke/ai.mjs`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(api): approve AI drafts into test cases`.

### Task 6: Web: settings pages

**Files:**
- Modify: `apps/web/src/lib/sections.ts` (add `AI_ROLES = ['ADMIN'] as const` and the `ai` section, label "AI", `Sparkles` icon), `apps/web/src/App.tsx` (project route under `ProjectRoleRoute roles={AI_ROLES}`, workspace route `/workspaces/:workspaceId/ai`), `apps/web/src/pages/WorkspaceMembersPage.tsx` (`WorkspaceTabs`: an admin-only "AI" tab)
- Create: `apps/web/src/lib/ai.ts` (types and API calls for the routes of Tasks 2 and 3), `apps/web/src/components/AiSettingsForm.tsx`, `apps/web/src/pages/WorkspaceAiPage.tsx`, `apps/web/src/pages/project/AiSettingsPage.tsx`

**Interfaces:**
- Consumes: the Task 2 and 3 routes and `AiSettingsView`; `useProjectInfo`, `ProjectRoleRoute`, `WorkspaceTabs`, `useResource`, `Page` components.
- Produces: `AiSettingsForm({ view: AiSettingsView | null; onSave(body): Promise<void>; onTest(): Promise<{ ok; latencyMs; error? }>; onChanged(): void; extra?: ReactNode })`: provider, model, endpoint, write-only key field (never prefilled, shows "A key is saved" and a "Remove key" option), enable switch (disabled until a passing test; says why), limits, "Test connection" with the result in a `role="status"` region, errors tied to fields with `aria-describedby`, and the disclosure text of the spec (what is sent, which setting applies, endpoint host).

- [ ] **Step 1: Write the failing browser check** in the session scratchpad (Playwright, as the existing scratch checks): the workspace admin sees the AI tab, a member does not; a project admin sees the AI section and a Tester, Automation user and Viewer do not and are sent to Test cases; the key input is `type="password"`, empty after saving, and the saved state is announced; Test connection result is read from the status region; the enable switch is disabled before a passing test; on the project page the inherited default is shown without a key, and "Use the workspace default" removes the override; no console errors.
- [ ] **Step 2: Run to see it fail.** Expected: FAIL (no AI tab).
- [ ] **Step 3: Implement** the files above. The project page shows which setting applies now (project or workspace), the inherited default and "Use the workspace default".
- [ ] **Step 4: Run to verify.** Run: `pnpm --filter @testops/web run lint && pnpm --filter @testops/web exec tsc -b`, rebuild the stack (`docker compose up -d --build --wait app`) and run the browser check. Expected: clean lint and typecheck, all checks pass.
- [ ] **Step 5: Commit** `feat(web): add AI settings for workspaces and projects`.

### Task 7: Web: draft test cases from a requirement

**Files:**
- Modify: `apps/web/src/pages/project/RequirementsPage.tsx` (a "Draft test cases" action on a row, next to Edit; shown when `GET /projects/:projectId/ai/status` says `enabled` and `editRepository` is true), `apps/web/src/App.tsx` (route `/projects/:projectId/ai/runs/:runId`), `apps/web/src/lib/ai.ts`
- Create: `apps/web/src/pages/project/AiRunPage.tsx`, `apps/web/src/components/AiDraftCard.tsx`

**Interfaces:**
- Consumes: Task 4 and 5 routes and run view.
- Produces: the run page: polls every 2 s while `QUEUED|RUNNING`, announces status changes in a live region, shows review findings, editable draft cards (title, preconditions, steps, priority, type, delete), audit notes (uncovered criteria, possible duplicates), a suite picker, **Approve** (sends the edited drafts), **Cancel**, **Draft again with notes** (starts a new run with the notes as `extraContext`), the disclosure of what was sent, a failure view with the run's `error` and a way to start again; leaving and returning shows the latest run through `GET ?requirementId=`.

- [ ] **Step 1: Write the failing browser check** (scratchpad): with the fake provider enabled for a project, a Tester sees "Draft test cases" and a Viewer does not; with AI off nobody does; clicking it opens the run page, which reaches the drafts; editing a title and approving creates the cases (they show under the requirement and in Test cases with the `ai-generated` tag) and the page says so; Cancel on a waiting run; a failed run (fake model `invalid`) shows the error and "Start again"; keyboard-only approve works and status changes are in a live region.
- [ ] **Step 2: Run to see it fail.** Expected: FAIL (no action on the row).
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Run to verify.** Run: lint, `tsc -b`, rebuild, browser check, as in Task 6. Expected: all pass.
- [ ] **Step 5: Commit** `feat(web): draft test cases from a requirement with AI`.

### Task 8: Documentation, CI and release wiring

**Files:**
- Modify: `README.md` (an "AI assistant" section: who defines it, workspace default and project override, the key, private addresses and what stays refused, what data is sent, the `AI_ENCRYPTION_KEY` backup warning), `design-doc.md` (FR-087, FR-090, FR-091, FR-093, FR-096 rewritten to the decided rule, "Open change" notes removed, private-address sentence replaced), `package.json` (`test:smoke` gains `node tests/smoke/ai.mjs`), `.github/workflows/ci.yml`, `docs/superpowers/specs/2026-10-23-ai-assistant-foundation-design.md` (status line: implemented)
- Test: the whole suite

- [ ] **Step 1: Write the failing check.** Run: `grep -n "ai.mjs" package.json .github/workflows/ci.yml`. Expected: no match.
- [ ] **Step 2: Implement.** `ci.yml`: a step "AI smoke test" after the role ladder step (`docker compose up -d --force-recreate --wait --wait-timeout 120 app` then `node tests/smoke/ai.mjs`) and a step "AI without an encryption key" (`AI_ENCRYPTION_KEY= docker compose up -d --wait --wait-timeout 120 app` then `node tests/smoke/ai.mjs --no-key`, then bring the app back up before the steps that follow). Docs as listed.
- [ ] **Step 3: Run the whole suite.** Run: `pnpm --filter @testops/api exec tsc --noEmit && pnpm --filter @testops/web run lint && pnpm --filter @testops/web exec tsc -b && docker compose up -d --build --wait app && npm run test:smoke`. Expected: all pass (the 429 waits make it slow). Also `bash tests/smoke/ensure-env.sh` and `shellcheck install.sh scripts/*.sh tests/smoke/ensure-env.sh apps/api/docker-entrypoint.sh`.
- [ ] **Step 4: Commit** `docs: document the AI assistant and run its smoke test in CI`.
- [ ] **Step 5: Whole-branch review** with the final reviewer of the executing skill, using this plan's Review Focus; then open the PR (never merge it).
