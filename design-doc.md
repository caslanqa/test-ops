# TestOps - Product Design and Requirements Document

**Version:** 0.2 (draft)  
**Date:** 1 October 2026  
**Product approach:** Qase-like workflows; independent product, self-hosted deployment  
**Deployment:** Docker image + Docker Compose  
**Database:** PostgreSQL

## 1. Purpose and vision

TestOps is a test management platform in which test cases are managed and linked to requirements, manual and automated tests are executed through a shared plan/run model, and results are exposed to external systems.

The product is not just a test case repository. The web interface, the public REST API, CI/test framework reporters and issue tracker integrations all use the same test data. The test plan bridges manual QA and automation; every result becomes traceable to its related case, requirement, run and evidence files.

Qase's product scope and public documentation are used as a functional reference; its brand, visual design and proprietary code are not copied.

## 2. Scope and key decisions

- The application supports self-hosted Docker deployment.
- PostgreSQL is the only supported database.
- The contents of ZIP, JPEG and similar attachment files are not written to PostgreSQL; PostgreSQL holds the attachment metadata, and the files are stored in a persistent Docker volume.
- The application, API and background jobs start out as a modular monolith; microservices are not a goal in the first phase.
- AI-assisted QA workflows are an optional, later-phase capability. They run through a provider adapter and a persisted workflow engine in the modular monolith; no AI provider is required to install or use the core product.
- Each installation may customize its user-facing name and brand icon after setup; the defaults are `TestOps` and the built-in TestOps mark. This does not change API paths or internal product identifiers.
- Each installation can host one or more workspaces, with multiple projects within each workspace.
- The issue area focuses on test-driven defect tracking; a Jira-like general-purpose issue tracker will not be built.
- The public API and ingestion of automated test results are among the core capabilities of the first release.

## 3. Users and permissions

| Role | Core permissions |
| --- | --- |
| Installation Admin | Manages installation-wide settings, including AI provider configuration, and grants/revokes Installation Admin access. This role is separate from workspace/project membership. |
| Workspace Admin | Manages members, workspace settings and projects. |
| Project Admin / QA Lead | Manages the repository, requirements, plans, runs, fields and project settings. |
| Tester | Executes the runs assigned to them; adds results, comments and evidence. |
| Developer / Automation | Submits test results with an API token and reads permitted data. |
| Viewer | Views project data and reports in read-only mode. |

Permissions are enforced at workspace and project boundaries. API operations are also subject to the user's role and the token's permissions. Sensitive API tokens should be kept only on the server/CI side.

## 4. Domain model and concepts

- **Workspace:** The top-level area in which users and projects are managed.
- **Project:** The boundary for the test repository, requirements, plans, runs and reports.
- **Suite:** A folder/category that organizes test cases hierarchically.
- **Test case:** A test definition with a persistent, unique identifier that can be referenced externally. It can include a title, preconditions, steps, expected result, priority, severity, test type, automation status, tags and custom fields.
- **Requirement:** A business/product requirement whose test coverage is tracked. It is linked to test cases in a many-to-many relationship.
- **Test plan:** A curated list of test cases selected for a goal, release or milestone, with optional assignments.
- **Test run:** An execution instance of a plan or an ad hoc selection in a specific environment/configuration. A single run can carry both manual and automated results.
- **Result:** The execution result of a test case within a run; it holds the status, tester/automation source, time, duration, comment, step results and attachments.
- **Defect:** A record of a bug found during testing. It can be linked to one or more failed results and can carry a link to an external issue.
- **Milestone, environment, configuration:** Classify the release/delivery target and the execution conditions.
- **Attachment:** Evidence such as a screenshot, log, video or report linked to a result or step. The file itself is kept in the persistent file store; its name, MIME type, size, checksum and storage key are kept in PostgreSQL.

The distinction between plan and run is preserved: a plan is reusable test scope; a run is an actual execution at a specific point in time. When a run is started, the case ID and the corresponding case version/snapshot are recorded, so the context of historical results is preserved even if the repository changes later.

## 5. Main user flows

### 5.1 From requirement to coverage

1. The user creates or imports a requirement within a project.
2. The requirement is linked to one or more test cases.
3. The coverage view shows which requirements are untested, linked, or failed in the latest execution.

### 5.2 Manual and automated execution through a plan

1. The QA Lead creates a plan and selects the cases, milestone, environment/configuration and optional tester assignments.
2. A run is started from the plan; the run is created with a snapshot of the selected cases.
3. Testers enter results through the web interface. CI reporters send results to the same run ID via the API.
4. The run shows remaining, passed, failed and blocked tests, recent activity and the completion rate.
5. Once all results are in, an authorized user or CI completes the run.

### 5.3 From failed result to defect

A tester or an integration creates a defect from a failed result; the steps, expected/actual result, evidence and the related case/run are linked automatically. The defect can be tracked in the internal system and later linked by reference to systems such as Jira/GitHub.

### 5.4 AI-assisted QA workflow

AI assistance is organized as a versioned workflow, not as an unconstrained autonomous agent. A deterministic workflow orchestrator owns ordering, retries, approvals and persistence. Agent roles are focused steps with versioned skills/instructions, a bounded tool set and a validated output schema. Commands or UI actions start a workflow or an individual step. Initially, all roles use one operator-selected default provider/model; each role gets a different skill, context and output schema. Model-per-role routing can be considered later if usage shows a clear quality or cost benefit.

1. A user starts a requirement review. The Requirement Reviewer checks clarity, testability, acceptance criteria and risk, and returns findings and questions scoped to that project.
2. After the user resolves or accepts the review, the Test Designer proposes positive, negative and boundary test cases using the existing case fields (preconditions, steps and expected results).
3. The Coverage Auditor maps proposed cases to acceptance criteria, flags gaps and likely duplicates, and may request one bounded revision of the draft.
4. The user reviews and edits the cases. Only after confirmation are cases saved through the normal permission-checked API; approved cases can then be linked to the requirement.
5. The Test Planner may propose a plan/run scope using requirement risk and existing coverage. A user or existing CI integration creates and executes the run; AI does not execute arbitrary test code.
6. When a run is completed, the Run Analyzer reviews run cases, result attempts, step results and comments. It returns a summary, failure clusters and possible causes, each marked as a hypothesis rather than a confirmed diagnosis.
7. The Defect Writer can prepare defect drafts linked to failed results. A user reviews and confirms each defect before it is persisted or sent to an external issue tracker.

Workflow runs are asynchronous and resumable. Each run and step records its status, timestamps, versioned skill/agent definition, validated input/output artifacts, provider/model metadata, and errors. Approval, rejection, retry and cancellation are explicit transitions. If a provider is unavailable or unconfigured, the existing manual and CI flows continue to work.

### 5.5 Test case execution history

When a user opens a case from the repository, its detail view provides a **Run history** section alongside (and clearly separate from) the case-definition change history. It shows the case's executions across runs, newest run first, grouped by run with each retry/attempt preserved. A row shows the run name/link, date, result status, attempt, source, duration and available environment/build context. Expanding a failed result shows its recorded comment, failed step results, evidence attachments and linked defects.

The case view also summarizes the latest result and a consecutive failed-run count. Consecutive failures are calculated across distinct completed runs; retries within one run remain attempts of that run and do not inflate the streak. A failure summary must distinguish stored evidence (for example, a tester comment or failed step) from an optional AI-generated explanation. AI explanations are hypotheses linked to the relevant run/result and never replace or rewrite the underlying result.

## 6. Functional requirements

### 6.1 Workspace and project

- **FR-001:** Users must be able to create workspaces and projects; projects must be identified by a unique code.
- **FR-002:** Workspace/project members and roles must be manageable.
- **FR-003:** Every data query must be restricted to the workspaces/projects the user is authorized to access.

### 6.2 Test repository

- **FR-010:** Users must be able to create and reorganize a suite hierarchy.
- **FR-011:** Creating, viewing, editing, archiving and deleting test cases must be supported.
- **FR-012:** Case steps must be stored as action/expected result pairs; preconditions and a description must be supported.
- **FR-013:** Priority, severity, type, automation status, tags and custom fields must be definable.
- **FR-014:** The case ID must remain unchanged; the link to automation results must be preserved even if the case's name or suite changes.
- **FR-015:** Case-definition change history and a basic audit log must be viewable; definition changes must remain distinguishable from execution results across runs.
- **FR-016:** Shared steps and parameterized test data must remain extensible in the data model for a later phase.
- **FR-017:** Automation results must be matched to cases first by case ID and, if no match is found, by name/suite path. If neither matches, the system must automatically create a new case and mark it as automation-sourced; which result statuses (e.g. only passed, or all statuses) trigger automatic case creation must be configurable in the project settings.
- **FR-018:** A case detail view and API must expose paginated execution history across runs, newest first, preserving every result attempt and linking each entry to its run. Entries must include status, timestamp, source, duration and available run environment/build metadata; failed entries must expose their comments, step results, evidence and linked defects.
- **FR-019:** Case history must summarize the latest result and consecutive failures across distinct completed runs. Retries within one run count as attempts, not separate runs. Any AI-generated failure explanation must be optional, identify its supporting run/result evidence and be presented as a hypothesis separate from stored facts.

### 6.3 Requirements traceability

- **FR-020:** Creating, editing and archiving requirements and storing external references must be supported.
- **FR-021:** The requirement–case relationship must be many-to-many.
- **FR-022:** The coverage report must show untested requirements and the latest test statuses.
- **FR-023:** The change and execution history of the cases linked to a requirement must be traceable.

### 6.4 Plans and runs

- **FR-030:** Plans must be able to contain a collection of cases, a description, a milestone, an environment/configuration and assignments.
- **FR-031:** The same plan must be reusable to produce multiple runs.
- **FR-032:** It must be possible to start a run from a plan or from an ad hoc selection of cases.
- **FR-033:** A run must hold its title, description, tags, environment, build/version information, milestone, source (manual/CI) and external links.
- **FR-034:** A run must be able to accept both manual and automated results; multiple CI jobs must be able to add results to the same run.
- **FR-035:** Runs must support open/completed states. Whether new results can be added to a completed run must be controlled by permissions and settings.
- **FR-036:** The API must provide an endpoint that returns the list of case IDs linked to a plan; automation clients must be able to use this list to run only the tests in the plan (selective execution).

### 6.5 Execution and results

- **FR-040:** Test results must support at least the Passed, Failed, Blocked, Skipped and Untested statuses.
- **FR-041:** In manual execution, a result, comment and evidence must be recordable for each case and step.
- **FR-042:** A result must be associated with the run, case, user/automation source, start/end time and duration.
- **FR-043:** Retries must be viewable without losing history; the current status must be distinguishable from previous attempts.
- **FR-044:** It must be possible to open a defect from a failed result.
- **FR-045:** File size/type limits and authorized access must be enforced for attachments (initial reference: ~32 MB per file, ~128 MB total per request, at most ~20 files per request; the exact values must be configurable).
- **FR-046:** Attachment file contents must be written to the persistent file store; the metadata and the link to the test result must be stored in PostgreSQL.

### 6.6 Defect and issue links

- **FR-050:** An internal defect record must hold a title, description, severity, status, assignee, tags and linked results.
- **FR-051:** The same defect must be linkable to multiple test results.
- **FR-052:** For links to external systems, the provider, external issue ID and URL must be stored. The provider field must be an extensible list (e.g. Jira, GitHub, GitLab, Azure DevOps, Linear, Trello, YouTrack, custom).
- **FR-053:** Once integrations are added, external issue creation and status synchronization must go through an adapter; the core domain must not depend on any provider.

### 6.7 Dashboard, reports and search

- **FR-060:** The project dashboard must show run progress, result distribution, recent failed tests and requirement coverage.
- **FR-061:** Test history must be filterable by case, requirement, run, date, status, user, tag and milestone.
- **FR-062:** CSV import/export and run report sharing must be extensible in a later phase.
- **FR-063:** The public run sharing link is an auth-exempt exception; it must be revocable and must use an unguessable token.

### 6.8 Public API and automation

- **FR-070:** A documented REST API must be provided under `/api/v1`; an OpenAPI schema must be generated.
- **FR-071:** The API must support at least the project, suites, cases, requirements, plans, runs, results, defects and attachments resources.
- **FR-072:** List endpoints must provide pagination, filtering and sorting.
- **FR-073:** API tokens must be revocable; token creation/last use must be audited.
- **FR-074:** Results must be submittable individually and in bulk; the size of bulk requests must be limited.
- **FR-075:** Result submission must be idempotent or able to detect duplicate records via the external test ID/run ID.
- **FR-076:** Automation must be able to submit results to an existing run; a flow for creating a run from a plan ID must be supported.
- **FR-077:** Error bodies, HTTP codes, rate limit and `Retry-After` behavior must be documented; the rate limit status must be communicated to the client through `RateLimit-Policy`/`RateLimit` (or the equivalent `X-RateLimit-*`) headers, and HTTP 429 with `Retry-After` must be returned when the limit is exceeded.
- **FR-078:** The initial automation inputs are the generic REST API and JUnit XML import. Framework-specific reporter packages will be added in later phases.
- **FR-079:** Webhook infrastructure for events such as run completion, result creation and defect changes may be added in a later phase; retries and visibility into failed deliveries are required.

### 6.9 AI-assisted QA workflows (later phase)

- **FR-080:** AI assistance must be optional and provider-independent. If no provider is configured, AI features are disabled while core product flows remain available. Provider credentials are server-side configuration/secrets and must never be returned to or stored by the browser.
- **FR-081:** Every AI workflow operation must enforce the same workspace/project access checks as the underlying resource APIs; the model receives only the minimum project-scoped data required for that step.
- **FR-082:** A requirement review must return structured findings, questions, risks and acceptance-criteria observations. Test-case generation must return drafts using the existing test-case shape, and coverage review must identify which criteria each draft covers and which remain uncovered.
- **FR-083:** AI-generated cases, plans/runs and defects may be persisted as workflow draft artifacts, but must not be written to domain records until a suitably authorized user explicitly approves them. Approval saves through the normal domain service and permission checks.
- **FR-084:** A workflow must support asynchronous execution, persisted run/step states, bounded retries, cancellation, resumable human-approval gates and versioned skills/agent definitions. Generated artifacts and step outcomes must be reviewable.
- **FR-085:** On a completed run, the Run Analyzer may summarize results, group related failures and suggest possible causes from available result comments, step results and history. These are recommendations, not authoritative pass/fail changes.
- **FR-086:** Agent tools must be explicitly allowlisted and project-scoped. AI workflows must not have arbitrary SQL, shell, unrestricted network or unreviewed mutation tools. Structured model output must be schema-validated before use.
- **FR-087:** An Installation Admin must configure the AI provider, default model, and (where needed) endpoint and credential in the authenticated system Settings page after installation. The page must support enable/disable and a connection test. One installation-level provider/model applies to all workspaces initially. AI usage must have configurable request/token or cost limits, timeouts and rate limits. The UI must disclose what project data is sent to the selected provider.

### 6.10 Installation branding

- **FR-088:** After installation, an Installation Admin must be able to set the user-facing application name in system Settings → Branding. If unset or blank, it defaults to `TestOps`. The value is stored as installation-level configuration and is preserved across upgrades; it is not an installer prompt or environment setting.
- **FR-089:** The configured display name must appear consistently in user-facing branding, including sign-in/registration, the application shell, browser page titles and help/support. The web client obtains the name from a safe public branding/configuration response that contains no release version or secret. API paths, database identifiers, installer internals and image/package names remain stable.
- **FR-094:** Installation Admins must be able to upload, replace and reset the built-in brand icon from system Settings → Branding. The icon is independent of the display-name text so changing the name does not require editing the artwork. Branding must work in light and dark themes; optional theme-specific assets may be provided.
- **FR-095:** Branding assets must be validated by file type, size and dimensions, stored in persistent storage and served only through the public branding asset route. If SVG is accepted, it must be sanitized; otherwise only safe raster formats are allowed. Public branding responses contain only the display name and approved public asset references.

### 6.11 Installation-level settings and AI credentials

- **FR-090:** Installation Admin is a separate authorization role from Workspace Admin. On a fresh install, the first seeded administrator receives Installation Admin access; only an Installation Admin can grant or revoke this role.
- **FR-091:** AI provider settings are configured after installation in system Settings, not in the installer. The page must identify configured provider/model and connection status, accept provider/model/optional endpoint/credential, allow connection testing without sending project content, and enable/disable AI without revealing a saved credential. If no provider is configured, AI features remain unavailable and core workflows continue.
- **FR-092:** Provider credentials saved through Settings must be encrypted at rest with a stable installation-level encryption key, never returned by APIs or logged, and replaceable without exposing the old value. The encryption key is created and preserved as a deployment secret; it is not the provider/API key.
- **FR-093:** Provider/model configuration is installation-wide initially, so every workspace uses the same selected provider/model and its usage limits. A workflow run records the provider/model configuration used for reproducibility. Per-workspace credentials and model routing are deferred.

## 7. Architecture and deployment requirements

- The application is published as a single-versioned OCI/Docker image; the container runs stateless.
- The initial Docker Compose deployment includes the application, PostgreSQL and persistent volumes. If needed, a worker runs as a separate process/service from the same image.
- PostgreSQL data is kept in a named volume; it is not deleted during restarts/upgrades.
- In the first release, attachment files must be written not to the application container's file system but to a persistent Docker volume mounted into the application (e.g. `/data/attachments`). PostgreSQL must hold only the file metadata and the storage key; attachments must not be written to the database as BLOBs.
- A separate object storage service is not required for the first release. In the future, it must be possible to point the same storage interface at S3-compatible storage.
- Configuration is supplied via environment variables/secrets; DB passwords and API tokens are not baked into the image.
- Branding is managed after installation in the authenticated system Settings → Branding page by Installation Admins. The default display name and mark are `TestOps` and the built-in icon. Persist branding settings and uploaded assets across upgrades. Expose only the configured name and approved asset references through a public branding endpoint for pre-authentication pages; keep release/version details on the existing authenticated system-info endpoint. Branding assets must be included in backups.
- AI is not bundled into the image, and no model/provider choice is required during installation. The first configuration path is the authenticated system Settings page, restricted to Installation Admins; it configures provider, model, optional endpoint and credential, provides connection testing and allows AI to be disabled. A local inference server may be configured by endpoint. The backend calls the provider through adapters; credentials never pass through the browser. Provider credentials are encrypted at rest using a stable deployment encryption key generated/preserved by the installer, never returned or logged. No configuration means AI is unavailable while core product features continue to work.
- The application waits in a controlled manner until the DB is ready; schema migrations are versioned and published together with backup/upgrade guidelines.
- Health/readiness endpoints and a configurable log level are provided.
- The first release does not require horizontal scaling; the API and the worker must be able to use the same PostgreSQL data safely.
- AI workflows use a provider adapter and a background worker; provider calls do not hold an API request open. The first implementation may use PostgreSQL-backed jobs and workflow state, avoiding a mandatory Redis/service dependency. Workflow definitions and artifacts are versioned and persisted for review and resume.

## 8. Security, reliability and quality

- Authentication and RBAC must use the same domain permissions in both the web UI and the API.
- Every query must check workspace/project access; guessing object IDs must not lead to data leakage.
- Passwords must be stored using secure password hashing; tokens must not be shown again after they are created, or must be stored hashed.
- File uploads must pass size, extension/MIME and access checks.
- Critical user actions must be written to the audit log.
- The backup and restore procedure for PostgreSQL and the attachment volume must be documented; it must be possible to back up both before an upgrade.
- API responses, migration errors and integration errors must be observable; silently lost test results are not acceptable.
- AI workflow steps, approvals, cancellations and resulting domain mutations must be attributable to the initiating user and auditable. Provider failures must not block normal product workflows.
- AI inputs must be minimized and project-scoped; provider secrets must be protected, output must be validated, and generated changes must pass through explicit human approval.
- Provider choice is an installation-level Installation Admin decision initially. The installation must disclose which provider receives project content; per-workspace provider credentials and model routing are deferred until tenant-level isolation and credential encryption are designed.

## 9. MVP acceptance criteria

1. An admin can create a workspace/project and assign roles to users.
2. A QA Lead can create suites, test cases and requirements and link a requirement to a case.
3. A user can create a plan, select cases and start a run from the plan.
4. A tester can complete a case within a run as Passed/Failed/Blocked/Skipped and add a comment/attachment.
5. An internal defect can be created from a failed result; the defect is linked back to the test result and the case.
6. Cases/plans/runs can be read and managed through the REST API, and automation results can be submitted to a run.
7. The Docker Compose installation preserves the PostgreSQL data and the files in the attachment volume across restarts; the backup guidelines cover both.
8. The run view shows manual results and results submitted via the API within the same progress view/report.

## 10. Proposed delivery phases

**Phase 1 - Working core:** Workspace/project and roles, test repository, requirements traceability, plans, manual runs, results, internal defects, PostgreSQL/Docker, API tokens and the basic REST API.

**Phase 2 - Automation and evidence:** Bulk result ingestion, JUnit XML, attachment storage, a first reporter for Playwright or pytest, run history/dashboard, API rate limit and idempotency improvements.

**Phase 3 - Integrations and team scale:** Jira/GitHub issue links, webhooks (e.g. run completion and defect notifications to channels such as Slack/Microsoft Teams/Discord/Mattermost), advanced filtering/search, custom fields, case review, report sharing and additional reporters.

**Outside the MVP:** A general-purpose issue tracker, hosting test frameworks/runners, numerous bidirectional integrations, AI-assisted QA workflows and advanced enterprise analytics. AI-assisted requirement review, case drafting and run analysis are candidates for a later phase after the core flows have been validated. Autonomous test execution and unreviewed AI mutations remain out of scope.

## 11. Assumptions and open decisions

- The initial deployment runs on an organization's own server; the workspace/project separation is preserved.
- Authentication with local username/password is assumed for the MVP; OIDC/LDAP is deferred to the enterprise phase.
- Internal defect tracking is part of the MVP; either Jira or GitHub will be chosen later for the first external tracker integration.
- The first framework reporter should be chosen based on users' automation stacks; this document takes JUnit XML as the general starting point.
- Initial performance targets will be determined through real-world usage and load testing.
- Automatic synchronization of requirement content from external systems such as Jira/GitHub is outside the MVP; in the MVP only the external reference (ID/URL) is stored, and the content is entered manually or via import.

## 12. References

- [Qase product page](https://www.qase.io/product/)
- [Qase integrations](https://www.qase.io/integrations/)
- [Qase API introduction and authentication](https://developers.qase.io/reference/introduction-to-the-qase-api)
- [Test plans and combining manual/automated results](https://developers.qase.io/docs/test-plans)
- [How reporters work](https://developers.qase.io/docs/start-here)
- [Matching automation to tests by test case ID](https://developers.qase.io/docs/linking-tests)
- [Run configuration and submitting results to an existing run](https://developers.qase.io/docs/test-runs)
- [Adding attachments to test results](https://developers.qase.io/docs/attachments)
