# Embedded AI assistant: foundation and requirement-to-cases workflow

Status: implemented on branch `feat/ai-assistant-foundation` (plan: `docs/superpowers/plans/2026-10-26-ai-assistant-foundation.md`). Reworked on 2026-10-26 for the role ladder: the provider is defined by workspace admins and project admins, not by an Installation Admin.

## Goal

TestOps gets an embedded AI assistant that runs bounded, reviewable workflows on project data. The first
slice delivers the shared foundation (provider settings, provider adapter, workflow engine, background
worker, audit) and one workflow end to end: turning a requirement into reviewed test cases.

The product already specifies the AI direction in `design-doc.md` (section 5.4, FR-080 to FR-093, FR-096,
section 7). This spec implements the first part of it and records where it deliberately differs.

## Decisions

| Topic | Decision |
|-------|----------|
| First slice | Foundation plus requirement to cases. Other roles (Run Analyzer, Defect Writer, Test Planner) follow later. |
| Providers | Two adapters: Anthropic Messages API and any OpenAI-compatible chat completions endpoint (covers local servers such as Ollama and vLLM). No SDK; requests go through one shared outbound helper (section 3). |
| Who defines the provider | Workspace admins and project admins only (FR-096). Tester, Automation, Viewer and API tokens cannot define, read or test it. There is no Installation Admin in this slice. |
| Where settings live | A workspace default (workspace admin) and an optional override per project (project admin). A project setting replaces the workspace one whole; nothing is merged. |
| Private addresses | Allowed: the app is designed to run locally too. Link-local, "this network", multicast and reserved addresses are always refused (see the decided change below). |
| Requirement review | Informs, does not gate: the workflow runs review, design and audit in one go, and the findings are shown next to the drafts. |
| Script generation in a framework | Not in this slice. Decided direction: an MCP server and CLI so the user's own coding agent writes the code in the repo, using the reporter's `testops()` link and `testops-sync --link`. TestOps never gets repo credentials in v1. |
| Persisted drafts | Drafts live in the workflow step output. There is no separate artifact table because nothing edits a draft on the server; edits travel with the approve call. |

## Decided change (2026-10-26): who defines the provider, and where

The owner decided that the AI provider URL (with the model and the credential) may be defined **only by
workspace admins and project admins**, never by Tester, Automation or Viewer users or by API tokens
(`design-doc.md`, FR-096). The earlier draft let an Installation Admin (set by `INSTALLATION_ADMIN_EMAIL`)
configure one installation-wide row; that is dropped. The questions this left open are settled as follows.

- **Scope.** A workspace admin defines a workspace default. A project admin defines an override for their
  project. A project's own setting replaces the workspace default entirely: its own provider, model, endpoint,
  credential and limits. A project without a setting uses the workspace default. A project setting that is switched
  off turns AI off for that project even when the workspace default is on.
- **Credential.** It belongs to the setting it was entered in and is sent only to that setting's endpoint. A
  project that wants another URL or model therefore enters its own credential; the workspace credential can never be
  aimed at an endpoint a project admin chose. Changing the endpoint of a setting clears its saved credential unless a
  new one comes in the same request. Nobody can read a credential back. A project admin sees the workspace default's
  provider, model and endpoint and whether it has a credential, never the credential.
- **Private addresses.** The endpoint may be a private address (loopback, `10.0.0.0/8`, `172.16.0.0/12`,
  `192.168.0.0/16`, internal host names), because the app is designed to run on a local machine with a local model.
  This lets a project admin aim the server at internal services, so these limits stay:
  - Link-local (`169.254.0.0/16`, `fe80::/10`, which includes cloud metadata), "this network" (`0.0.0.0/8`),
    multicast and reserved ranges are refused even though private ones are allowed. None of them is a model server.
  - The address is checked when the connection is made (so a name that later resolves elsewhere is still caught) and
    redirects are not followed, as for CI webhooks.
  - For an endpoint on a private address the response body is never shown or stored, only the HTTP status and a
    fixed message. Otherwise error text would let a project admin read internal services.
  - Only a connection test and the workflow runs make the request. Its body is the fixed provider shape and the
    endpoint is never taken from project data.
  - Residual risk, accepted by the owner's decision: an admin can make the server send a fixed JSON `POST` to any
    internal host and port outside the refused ranges and learn the HTTP status and the connection error it answers
    with. Every account is an admin of its own DEMO workspace, and registration is open by default, so on a default
    installation this reaches everyone who can sign in; closing it takes `SELF_REGISTRATION=false` and
    `DEMO_WORKSPACE=false`. The README and FR-096 say so.
- **Unchanged.** The credential is never returned or logged, and the workflows need write access to the project
  as before. `INSTALLATION_ADMIN_EMAIL` and an `isInstallationAdmin` flag are not built.
- The role ladder this depends on is in `2026-10-26-role-hierarchy-design.md`.

## Relation to `design-doc.md`

Implements: FR-080, FR-081, FR-082 (review, drafts, coverage), FR-083, FR-084, FR-086, FR-087, FR-091,
FR-092, FR-093, FR-096 and the AI items of sections 7 and 8.

Deviations, to be recorded in `design-doc.md` when implemented (its "Open change" notes are removed then):

- FR-087, FR-090, FR-091, FR-093, FR-096: the provider is defined by workspace admins (workspace default) and
  project admins (project override), on pages of the workspace and of the project, not by an Installation Admin in
  system Settings; the configuration is per workspace and per project, not installation-wide. The Installation Admin
  role itself is neither used nor built here. FR-096's sentence on private addresses ("refused unless the
  installation allows it") becomes the rule above.
- FR-082: Requirement Reviewer findings are advisory; design-doc step 2 reads as "after the user resolves or
  accepts the review". The owner chose not to gate.
- FR-087: limits are request-based (runs per user per day, output tokens, timeout), not cost-based.

## Design

### 1. Who may define the provider, and which setting applies

- Define, read, test and remove settings: a workspace admin (the workspace default, and any project's setting,
  because a workspace admin is admin in every project) and a project admin (their project's setting). Tester,
  Automation and Viewer get `403`. These routes are refused for API tokens with the web-session-only guard the
  invitation and webhook controllers already use.
- The effective setting of a project is its own setting if it has one, else its workspace's, else none.
  `AiSettingsService.resolve(projectId)` returns it with `source: 'PROJECT' | 'WORKSPACE' | 'NONE'`. The start
  endpoint, the worker and the status endpoint all go through it, so there is one place for the rule.
- Every member of the project can read `GET /projects/:projectId/ai/status` and nothing else about the settings.

### 2. AI settings and credential

- Table `ai_settings`, at most one row per workspace and one per project: `id`, `workspaceId`, `projectId` (exactly
  one of the two is set, enforced by a check in the migration; each unique where set; both cascade on delete),
  `enabled`, `provider` (`ANTHROPIC` or `OPENAI_COMPATIBLE`), `model`, `endpoint` (required for OpenAI-compatible,
  optional for Anthropic), `credentialCipher`, `maxOutputTokens` (default 8192), `requestTimeoutMs` (default 120000),
  `maxRunsPerUserPerDay` (default 20), `testedAt`, `updatedAt`, `updatedById`.
- `testedAt` is set by a passing connection test and cleared by any change to provider, model, endpoint or
  credential. `enabled` can only be turned on while `testedAt` is set.
- Credential encryption: AES-256-GCM with a random 12-byte IV per write, stored as `iv:tag:ciphertext`
  (base64). The key is `AI_ENCRYPTION_KEY` (32 bytes, hex), a deployment secret that is not the provider key and
  not `JWT_SECRET`. `install.sh` and `scripts/ensure-env.sh` generate it when missing, like `JWT_SECRET`;
  `.env.example`, `docker-compose.yml` and `deploy/coolify` pass it through. With no key set, saving a credential
  fails with a clear error and AI stays disabled.
- The API never returns the credential (only `hasCredential: boolean`) and never logs it. Provider error text is
  shown only for an endpoint on a public address: it is cut to 500 characters and any occurrence of the credential is
  removed before it is stored or shown. For an endpoint on a private address only the HTTP status and a fixed message
  are stored and shown.
- Endpoint validation: an `http`/`https` URL without credentials in it, never taken from project data. The address
  rules of the decided change apply when saving (IP literals) and on every request (at connect time).

### 3. Provider adapter

```
interface AiProvider {
  generate(request: {
    system: string;
    user: string;
    schemaName: string;
    schema: JsonSchema; // draft-07 object schema
  }): Promise<{ output: unknown; usage: { inputTokens: number; outputTokens: number } }>;
}
```

- Anthropic: Messages API with a single tool whose `input_schema` is the schema and a forced `tool_choice`; the
  tool input is the output.
- OpenAI-compatible: chat completions with `response_format: { type: 'json_schema', ... }`. A server without
  `json_schema` support fails the connection test with a message that says so.
- Both: timeout from settings, `max_tokens` from settings, no streaming, retries are the workflow's job. Errors
  carry `retryable` (network, 429, 5xx) so the engine can decide.
- Requests go through one outbound helper derived from the CI webhook's `safePost`
  (`apps/api/src/webhooks/safe-post.ts`): address check at connect time, no redirects, one deadline for the whole
  call. It gains a response cap of 2 MiB (the webhook helper keeps only the first 1000 characters, too little for a
  model answer) and a third address mode: private allowed, link-local, "this network", multicast and reserved
  refused. The webhook behavior does not change.
- The exact request shapes are checked against current provider documentation (Context7) when implementing.

### 4. Workflow engine and worker

Tables:

- `ai_workflow_runs`: `id`, `type` (`REQUIREMENT_TO_CASES`), `projectId`, `createdById`, `status`, `input`
  (json), `providerSnapshot` (json: provider, model, endpoint host, `source` and the settings id), `result` (json,
  set when drafts are ready), `error`, `availableAt`, `lockedUntil`, `createdAt`, `startedAt`, `finishedAt`.
- `ai_workflow_steps`: `id`, `runId`, `name`, `skillVersion`, `status`, `attempt`, `input`, `output`, `usage`,
  `error`, `startedAt`, `endedAt`. Unique on `(runId, name, attempt)`.

Run states: `QUEUED`, `RUNNING`, `AWAITING_APPROVAL`, `COMPLETED`, `FAILED`, `CANCELLED`.

Worker (`AiWorkerService`, started on module init, stopped on module destroy):

- One loop in the API process polls every 2 seconds and claims one run at a time with
  `UPDATE ... WHERE id = (SELECT id ... WHERE status = 'QUEUED' AND availableAt <= now() ORDER BY createdAt FOR UPDATE SKIP LOCKED LIMIT 1)`.
  Several replicas can run it safely. No Redis and no new dependency.
- A claim sets `lockedUntil = now() + 5 minutes`, extended after every step. A `RUNNING` run whose lock expired is
  claimed again and resumes at its first step that has no completed output. This covers crashes and restarts.
- A claimed run resolves its project's effective setting once per claim. When there is none, or it is disabled,
  the run fails with "AI is not enabled for this project". Starting a run refuses earlier (section 5), so this
  covers only a setting that was switched off while the run waited.
- Between steps the worker re-reads the run and stops when it was cancelled.
- A step that fails with a retryable provider error or an output that does not validate is retried once, then the
  run fails with the last error. Bounded: at most 5 model calls per run.
- On shutdown the loop stops claiming and lets an in-flight provider call finish for up to 10 seconds; any
  remainder is recovered by the lock expiry.

### 5. Requirement-to-cases workflow

Start (`POST /projects/:projectId/ai/runs`, `{ type: 'REQUIREMENT_TO_CASES', requirementId, extraContext? }`):

- The caller needs the project role that may create cases (the `WRITE_ROLES` of the case service) on the project.
- The project's effective setting must exist and be enabled, the requirement must belong to the project and not be
  archived, `extraContext` is at most 8000 characters, and the caller is under `maxRunsPerUserPerDay` of the
  effective setting, counted over all the caller's runs started in the last 24 hours.
- The run is stored as `QUEUED` with the provider snapshot and `202 { runId }` is returned.

Steps, each with a versioned skill (system prompt kept in code with a `skillVersion`) and a validated output:

1. `REVIEW` (Requirement Reviewer). Output: `summary`, `acceptanceCriteria: string[]` (at most 20) and
   `findings: Array<{ kind: 'clarity' | 'testability' | 'acceptance-criteria' | 'risk' | 'question'; severity: 'low' | 'medium' | 'high'; text: string }>` (at most 30).
2. `DESIGN` (Test Designer). Output: `cases` (at most 25), each with the fields of `CreateTestCaseDto`
   (`title`, `preconditions?`, `steps: Array<{ action, expectedResult? }>`, `priority`, `type`) plus
   `kind: 'positive' | 'negative' | 'boundary' | 'error'`.
3. `AUDIT` (Coverage Auditor). Output: `coverage: Array<{ criterion: number; caseIndexes: number[] }>`,
   `uncovered: number[]`, `duplicates: Array<{ caseIndex: number; existingCaseId: string; reason: string }>`,
   `revisionNeeded: boolean`, `notes: string`.
4. If `revisionNeeded` and no revision happened yet: `REVISE` (the Test Designer again, given the audit notes;
   its output replaces the drafts) and `AUDIT` once more. No further revision.

When the last step succeeds the run stores `result = { review, drafts, audit }` and becomes `AWAITING_APPROVAL`.
Nothing is written to cases yet.

Data sent to the provider, and disclosed in the UI: the requirement title and description, `extraContext`, the
cases already linked to the requirement (title and steps), and for duplicate detection the id and title of up to
200 other non-archived cases of the project (most recently updated first). Nothing else, and no data from other
projects. The disclosure also names which setting applies (workspace default or project setting) and its endpoint
host.

Approve (`POST /projects/:projectId/ai/runs/:runId/approve`, `{ suiteId?, cases: CaseDraft[] }`):

- The run must be `AWAITING_APPROVAL` and belong to the project; the caller must still hold the write role.
- The client sends the (possibly edited) drafts. Every draft is validated with the `CreateTestCaseDto` rules and
  the list is capped at 25.
- Cases are created through `TestCasesService.createMany` (permission-checked, one transaction) with tags
  `ai-generated` and the draft `kind`, then linked to the requirement through `RequirementsService.linkCases`.
  The run becomes `COMPLETED` with `result.createdCaseIds`. A second approve answers `409`.
- Drafts that are not approved are never written. A run stays `AWAITING_APPROVAL` until approved or cancelled.

Other endpoints: `GET /projects/:projectId/ai/runs/:runId` (run, steps without prompts, `result`),
`GET /projects/:projectId/ai/runs?requirementId=` (paged, newest first, for resuming after leaving the page) and
`POST /projects/:projectId/ai/runs/:runId/cancel` (allowed in `QUEUED`, `RUNNING` and `AWAITING_APPROVAL`).
Runs are visible to members of the project.

### 6. Settings endpoints

- `GET /projects/:projectId/ai/status`: `{ enabled: boolean, source }` for any member of the project (decides
  whether the UI shows the AI button).
- Workspace default (workspace admin): `GET`, `PUT` and `DELETE /workspaces/:workspaceId/ai`, and
  `POST /workspaces/:workspaceId/ai/test`.
- Project setting (project admin; a workspace admin counts as one): `GET`, `PUT` and `DELETE
  /projects/:projectId/ai/settings`, and `POST /projects/:projectId/ai/settings/test`. `GET` returns the project's
  own setting (or `null`) and the inherited workspace default (provider, model, endpoint, `enabled`,
  `hasCredential`), so the page shows what applies. `DELETE` makes the project use the workspace default again.
- All of them return settings without the credential and are web-session-only. `PUT` accepts an optional
  `credential` (omitted keeps the saved one, unless the endpoint changed, see the decided change) and
  `clearCredential`.
- `POST …/test`: one minimal request with no project content; returns `{ ok, latencyMs, error? }` and sets or
  clears `testedAt`.
- `enabled` can only be turned on when provider, model and credential (or a keyless local endpoint) are set and the
  last connection test passed with the current settings (`testedAt`).

### 7. Web

- Workspace "AI" settings page (workspace admins), linked from the workspace navigation, and a project "AI" section
  (project admins and workspace admins) in the project menu, registered in `lib/sections.ts` for the role `ADMIN`
  and guarded by `ProjectRoleRoute` like Members. Both pages: provider, model, endpoint, write-only API key field,
  enable switch, limits, "Test connection" and the disclosure text of section 5. The project page also shows which
  setting applies now, the inherited workspace default (without its credential) and "Use the workspace default"
  (the `DELETE`).
- Requirements page: a "Draft test cases" action on a requirement row, shown only when `enabled` is true and the
  user can write. It opens the run page `/projects/:projectId/ai/runs/:runId`, which polls every 2 seconds while the
  run is `QUEUED` or `RUNNING`, announces status changes in a live region, shows review findings, editable draft
  cards (title, preconditions, steps, priority, type, delete), audit notes (uncovered criteria, possible
  duplicates), a suite picker, **Approve** and **Cancel**, and **Draft again with notes** (starts a new run with
  the added context).
- All UI text is English and follows the accessibility rules in the repository instructions (labels, error
  association, live regions, keyboard operation).

### 8. Audit

A small `AuditService.record({ userId, workspaceId?, projectId?, action, entityType, entityId?, metadata? })`
writes `AuditLog` rows. It is used for `ai.settings.updated` and `ai.settings.removed` (fields changed and, when it
changed, the endpoint host; never the credential; `entityType` `ai_settings`, `entityId` the settings row, with the
workspace or project set), `ai.run.started`, `ai.run.approved` (created case ids), `ai.run.cancelled` and
`ai.run.failed`. The wider audit gap in `PLAN.md` stays open; this only introduces the first writer.

### 9. Failure behavior

- AI disabled or unconfigured for the project: status is disabled, run endpoints answer `409 AI is not enabled`,
  no core flow is affected.
- Provider failure: the run is `FAILED` with a short message; nothing partial is written to cases.
- A cancelled or failed run can be started again; it is a new run.
- Workflow errors never reach request threads: the API only enqueues.

## Testing

The API has no unit test framework; tests are smoke scripts against the Docker stack (`tests/smoke`). This slice
follows that, with no new framework:

- A fake OpenAI-compatible server returns canned JSON per `schemaName`. It runs inside the app container, as in the
  webhook delivery smoke test, so the endpoint is a loopback address. It also serves a malformed response once to
  exercise the retry, and a failing mode.
- `tests/smoke/ai.mjs` covers:
  - settings: Tester, Automation and Viewer refused (`403`), an API token refused, a project admin setting only
    their own project, a workspace admin setting the default, the credential never returned, test connection;
  - scope: a project without a setting uses the workspace default, a project setting wins, a switched-off project
    setting turns AI off, `DELETE` goes back to the default, and changing the endpoint clears the saved credential;
  - addresses: a link-local endpoint refused although loopback works, and the response body of a private endpoint
    not shown;
  - runs: a full run to `AWAITING_APPROVAL`, approve creating cases with the requirement link and the
    `ai-generated` tag, a second approve (`409`), cancel, run limit, a role without write access (`403`), a provider
    failure ending in `FAILED`, and AI disabled (`409`).
- The smoke test is added to `package.json` `test:smoke` and to the CI smoke job.
- The Anthropic adapter is exercised through the same fake server speaking the Messages format.

## Non-goals

- Run Analyzer, Defect Writer, Test Planner and any other role; script generation; an MCP server and CLI.
- File attachments as input; syncing requirements from external trackers.
- Merging a workspace default with a project setting field by field (a project setting replaces it whole), a project
  using the workspace credential with its own endpoint, model routing, cost-based limits, key rotation.
- Installation Admin, `INSTALLATION_ADMIN_EMAIL` and granting or revoking roles for AI; draft expiry.
- Executing generated tests; autonomous agents; tools that mutate data without approval.

## To verify during implementation

- That `TestCasesService.createMany` accepts `tags` and returns the created ids, and the transaction behavior when
  one draft is invalid.
- That the check "exactly one of `workspaceId` and `projectId`" can be written in the Prisma migration (raw SQL),
  and that each column's uniqueness holds where the other is null.
- That generalizing `safePost` (response cap, third address mode) leaves the CI webhook behavior unchanged; the
  existing webhook and webhook-delivery smoke tests cover it.
- How the web-session-only guard attaches to workspace and project routes, and where in the workspace navigation the
  AI page is linked.
- How `ensure-env.sh`, `install.sh` and `deploy/coolify` write a new variable on an existing installation without
  touching other values.
- Current Anthropic and OpenAI-compatible request shapes for structured output.
