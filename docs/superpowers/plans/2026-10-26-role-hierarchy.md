# Role Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One ladder of user types (Workspace admin > Project admin > Tester > Automation > Viewer) with the assignment limit enforced on the server, a five-type invitation form that carries a project and role, no Permissions page, and Integrations visible to workspace admins, project admins and Automation users.

**Architecture:** A pure limit helper in `access-control.service.ts` is used by the project-member endpoints. Invitations get two nullable columns (project, project role) that accepting or signing up turns into a project membership. The web app mirrors the limit with helpers in `lib/permissions.ts` and shows only what the user may give. Docs follow.

**Tech Stack:** NestJS 10, Prisma (PostgreSQL), React + react-router, oxlint, Docker compose stack, smoke tests in `tests/smoke/*.mjs` (plain `node`, no framework).

**Spec:** `docs/superpowers/specs/2026-10-26-role-hierarchy-design.md`

## Global Constraints

- Repo content (code, comments, docs, commits) is English. The reference tool is never named.
- The ladder, top first: Workspace admin, Project admin (`ProjectRole.ADMIN`), Tester, Automation, Viewer. Workspace admins give every role; project admins give and manage only `TESTER`, `AUTOMATION`, `VIEWER`. A project admin cannot change or remove a member whose role is `ADMIN`, including themselves.
- The server enforces every limit; the web app only hides what the server refuses. Existing endpoints keep their paths and bodies; only refusals (`403`) are new.
- Invitations: `projectId` and `projectRole` together or neither; neither when `role` is `ADMIN`; the project belongs to the workspace and is not archived. Only workspace admins invite (unchanged). An invitation never changes an existing project role.
- Integrations: menu entry and address for workspace admins, project admins (`currentUserRole === 'ADMIN'`) and `AUTOMATION`; Automation sees the Playwright reporter and GitHub Actions tabs only. Members stays workspace admin and project admin.
- The Permissions page, its route and its tab are removed; `GET /workspaces/:id/permissions` and `PUT …/permissions/projects/:projectId/users/:userId` stay.
- The web app has no unit test framework: web behaviour is checked by a Playwright script kept in the session scratchpad, never in the repo, written and run red before the code it checks.
- API changes are checked by `tests/smoke/roles.mjs` against the Docker stack. After a server change: `docker compose up -d --build app`, then wait for `http://localhost:8080/api/v1/health` to answer 200.
- Commit only the paths a task names, one commit per task, with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never `git add -A`; leave `.vscode/` and `docs/superpowers/specs/2026-10-23-*` alone (that file is edited only by the doc task that names it).
- Parallel Bash calls share one shell: use absolute paths and no `cd` in parallel calls. In zsh, quote globs given to `grep --include`.

## Review Focus

- A project admin must get `403` giving `ADMIN`, changing or removing another project admin, and demoting or removing themselves, also with an API token of that admin. Pinned in Task 1.
- A workspace admin must still manage every role, and the permissions matrix API must keep working for them. Pinned in Tasks 1 and 6.
- An invitation with a project must validate both-or-neither, the `ADMIN` combination, a project of another workspace and an archived project. Pinned in Task 2.
- Accepting an invitation and signing up with one must both create the project membership; an old invitation without a project must behave as before. Pinned in Task 2.
- A project admin's role list must lack Project admin, and a workspace admin's must have it, though both appear as `ADMIN` in `currentUserRole`. Pinned in Task 3.
- `?tab=webhook` opened by an Automation user must fall back to the reporter tab and must not request `/webhook` (the server answers 403). Pinned in Task 5.

---

### Task 1: Server limits on project members

**Files:**
- Create: `tests/smoke/roles.mjs`
- Modify: `apps/api/src/common/access-control.service.ts`, `apps/api/src/projects/projects.service.ts`
- Modify: `package.json` (`test:smoke`), `.github/workflows/ci.yml` (smoke step)

**Interfaces:**
- Produces, exported from `access-control.service.ts`: `interface ProjectRoleLimits { assignable: ProjectRole[]; manageable: ProjectRole[] }`; `projectRoleLimits(viaWorkspaceAdmin: boolean): ProjectRoleLimits` (true: all four roles for both lists; false: `TESTER`, `AUTOMATION`, `VIEWER`); `assertMayGive(limits: ProjectRoleLimits, role: ProjectRole): void` (throws `ForbiddenException("You can only give these roles: <names, comma separated>.")`); `assertMayManage(limits: ProjectRoleLimits, currentRole: ProjectRole): void` (throws `ForbiddenException("You can't change or remove a member with the role <name>.")`).
- Consumes: `requireProjectRoleOrWorkspaceAdmin` already returns `{ viaWorkspaceAdmin }`.
- Produces for later tasks: `tests/smoke/roles.mjs` with helpers `call`, `ok`, `check`, `expectStatus` (same shape as `tests/smoke/users.mjs`) and a `makeUser(label, projectRole)` helper that creates an account by workspace invitation plus sign-up and gives it `projectRole` in the test project through `PUT /workspaces/:id/permissions/projects/:projectId/users/:userId` (web session). Later tasks append sections to this file.

- [ ] **Step 1: Write the failing smoke test** `tests/smoke/roles.mjs`, with the header comment style of `users.mjs` (what it checks, how to run). It signs in the seed admin, creates a workspace and a project, and makes four accounts with `makeUser`: `pa` and `pa2` (`ADMIN`), `tester` (`TESTER`), `viewer` (`VIEWER`), each with a web session and an API token (`POST /api-tokens`). Section "Project admin limits", all against `/projects/:id/members`: `pa` adding a workspace member as `ADMIN` is `403`; as `TESTER` is `201`/`200`; `pa` changing that member to `ADMIN` is `403`, to `VIEWER` is `200`; `pa` changing `pa2` to `TESTER` is `403`; removing `pa2` is `403`; `pa` changing own role to `VIEWER` is `403`; removing own record is `403`; removing the Tester is `204`; the same `403`s with `pa`'s API token for giving `ADMIN`. Section "Workspace admin": the seed admin gives `ADMIN`, changes and removes `pa2`; `tester` and `viewer` get `403` on add, change and remove. The `403` message for giving `ADMIN` contains `TESTER, AUTOMATION, VIEWER`.
- [ ] **Step 2: Run it to verify it fails.** `cd /Users/cihanaslan/Development_Projects/test-ops && node tests/smoke/roles.mjs`. Expected: `FAIL` lines for `pa` giving `ADMIN`, changing or removing `pa2`, and self changes (status `200`/`201`/`204` instead of `403`); the workspace-admin and Tester/Viewer checks pass.
- [ ] **Step 3: Implement** the three helpers in `access-control.service.ts` and use them in `ProjectsService`: `addMember` calls `projectRoleLimits(access.viaWorkspaceAdmin)` from the value `requireProjectRoleOrWorkspaceAdmin` returns, `assertMayGive(limits, dto.role)`, and, when the target already has a project role, `assertMayManage(limits, thatRole)`; `updateMemberRole` and `removeMember` read the member's current role and call `assertMayManage`, and `updateMemberRole` also `assertMayGive` for the new role. `WorkspacesService.setProjectRole` is untouched (workspace admins only).
- [ ] **Step 4: Rebuild and run.** `docker compose up -d --build app`, wait for health, then `node tests/smoke/roles.mjs && node tests/smoke/users.mjs`. Expected: all `PASS`, exit 0 for both (the permissions-matrix cases of `users.mjs` still pass).
- [ ] **Step 5: Register the test** in `package.json` `test:smoke` and the smoke step of `.github/workflows/ci.yml` (after `users.mjs`).
- [ ] **Step 6: Commit.** `git add tests/smoke/roles.mjs apps/api/src/common/access-control.service.ts apps/api/src/projects/projects.service.ts package.json .github/workflows/ci.yml && git commit -m "feat(api): limit the roles a project admin can give, change or remove"`.

### Task 2: Invitations carry a project and a role

**Files:**
- Create: `apps/api/prisma/migrations/20261026120000_invitation_project_role/migration.sql`
- Modify: `apps/api/prisma/schema.prisma`, `apps/api/src/invitations/dto/create-invitation.dto.ts`, `apps/api/src/invitations/invitations.service.ts`, `apps/api/src/auth/auth.service.ts`
- Test: `tests/smoke/roles.mjs`

**Interfaces:**
- Consumes: `makeUser`-style invitation and sign-up flow from Task 1.
- Produces: `workspace_invitations.projectId` (nullable text, foreign key to `projects(id)` on delete cascade) and `projectRole` (nullable `ProjectRole`); `CreateInvitationDto { email; role: WorkspaceRole; projectId?: string (UUID); projectRole?: ProjectRole }`; invitation list, create and preview responses add `projectRole: ProjectRole | null` and `project: { id; key; name } | null`; accept's response adds `projectId`, `projectRole` (null when none); `InvitationsService.joinProject(tx: Prisma.TransactionClient, invitation: { projectId: string | null; projectRole: ProjectRole | null }, userId: string): Promise<void>` (creates the project membership, never changes an existing one).

- [ ] **Step 1: Write the failing tests.** Append section "Invitations with a project" to `roles.mjs`: creating with `{ role: 'MEMBER', projectId, projectRole: 'TESTER' }` is `201` and the response, the list and the public preview show `projectRole: 'TESTER'` and the project's `key` and `name`; the invited existing account accepts (`201`) and then appears in `GET /projects/:id/members` as `TESTER`; a new account created with the link (`inviteToken` at `/auth/register`) appears there as `VIEWER` for a `VIEWER` invitation; `role: 'ADMIN'` with a project is `400`; `projectId` without `projectRole` and the reverse are `400`; a project of another workspace is `404`; an archived project is `400` (archive with `POST /projects/:id/archive`; check the route in `projects.controller.ts`); an invitation without a project accepts as before and leaves no project membership.
- [ ] **Step 2: Run to verify it fails.** `node tests/smoke/roles.mjs`. Expected: `FAIL` on the new section (the fields are ignored: no project in the preview, no membership after accepting).
- [ ] **Step 3: Migration and schema.** Add the two columns and the foreign key in the migration SQL (`ALTER TABLE "workspace_invitations" ADD COLUMN "projectId" TEXT, ADD COLUMN "projectRole" "ProjectRole"` and the `ADD CONSTRAINT … FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE`); mirror them in `schema.prisma` with the relation and the back-relation on `Project`. Run `cd apps/api && npx prisma validate && npx prisma generate`. Expected: valid.
- [ ] **Step 4: Implement** the DTO fields (`@IsOptional() @IsUUID()` and `@IsOptional() @IsEnum(ProjectRole)` with `@ApiProperty` like `role`), the checks in `InvitationsService.create` (both or neither, not with `ADMIN`, project in this workspace else `NotFoundException("Project not found")`, archived else `BadRequestException`), the new response fields in `create`, `list` and `preview` (select the project's `id`, `key`, `name`), `joinProject`, its call in `accept` (inside the existing transaction, after the workspace membership; the response gains `projectId` and `projectRole`) and in `AuthService.register` (inside its transaction, after the workspace membership).
- [ ] **Step 5: Rebuild and run.** `docker compose up -d --build app`, wait for health, `node tests/smoke/roles.mjs && node tests/smoke/users.mjs && node tests/smoke/scope.mjs`. Expected: all `PASS`.
- [ ] **Step 6: Commit.** `git add apps/api/prisma tests/smoke/roles.mjs apps/api/src/invitations apps/api/src/auth/auth.service.ts && git commit -m "feat(api): let an invitation carry a project and a role"`.

### Task 3: Role limits on the project Members page

**Files:**
- Modify: `apps/web/src/lib/permissions.ts`, `apps/web/src/components/Members.tsx`, `apps/web/src/pages/project/ProjectMembersPage.tsx`

**Interfaces:**
- Produces in `lib/permissions.ts`: `assignableProjectRoles(who: { workspaceAdmin: boolean }): ProjectRole[]` (workspace admin: `ADMIN, TESTER, AUTOMATION, VIEWER`; otherwise `TESTER, AUTOMATION, VIEWER`) and `manageableProjectRoles(who): ProjectRole[]` (same lists).
- Produces in `Members.tsx`: `MemberTable` gets optional props `assignableRoles?: string[]` (role values offered in a member's select; default: all of `roleOptions`) and `canManageMember?: (member: MemberRow) => boolean` (default: `canManage`); a row that is not manageable shows its role as text and has no remove button; `roleOptions` still names every role, for labels.

- [ ] **Step 1: Write the failing browser check** in the scratchpad (`/private/tmp/claude-501/-Users-cihanaslan-Development-Projects-test-ops/2c642db3-4671-4261-8cbe-21a8f1eb6424/scratchpad/ui-check/roles-ui.mjs`, based on `role-check.mjs` there: same Playwright import, login, check helper and user setup through the API). Cases for this task, on the Demo Project's Members page: a project admin who is not a workspace admin sees a role select per Tester/Automation/Viewer member whose options are `Tester, Automation, Viewer` and sees the project admins' roles as text with no Remove button, including their own row; the "Add member" form's role list has no Project admin option; the seed admin (workspace admin) sees `Project admin` among the options of a Tester's select.
- [ ] **Step 2: Run it against the current stack.** `node roles-ui.mjs red`. Expected: FAIL on every case above (all four roles offered, every row editable).
- [ ] **Step 3: Implement** the helpers, the two `MemberTable` props, and in `ProjectMembersPage` pass `assignableRoles` and `canManageMember` from `manageableProjectRoles({ workspaceAdmin: info?.workspace.currentUserRole === 'ADMIN' })` and give `AddProjectMemberForm` only the assignable roles (default `TESTER`).
- [ ] **Step 4: Verify.** `cd /Users/cihanaslan/Development_Projects/test-ops/apps/web && npx oxlint src && npx tsc -b`, rebuild `docker compose up -d --build app`, then `node roles-ui.mjs green`. Expected: no lint or type errors; this task's cases PASS.
- [ ] **Step 5: Commit.** `git add apps/web/src/lib/permissions.ts apps/web/src/components/Members.tsx apps/web/src/pages/project/ProjectMembersPage.tsx && git commit -m "feat(web): offer a project admin only the roles they may give"`.

### Task 4: One invitation list of five types

**Files:**
- Modify: `apps/web/src/lib/labels.ts`, `apps/web/src/pages/WorkspaceMembersPage.tsx`, `apps/web/src/pages/InvitePage.tsx`

**Interfaces:**
- Produces in `labels.ts`: `USER_TYPES` (`WORKSPACE_ADMIN`, `PROJECT_ADMIN`, `TESTER`, `AUTOMATION`, `VIEWER`), `type UserType`, `USER_TYPE_LABEL` (`Workspace admin`, `Project admin`, `Tester`, `Automation`, `Viewer`), `USER_TYPE_DESCRIPTION` (reuse `WORKSPACE_ROLE_DESCRIPTION.ADMIN` and `PROJECT_ROLE_DESCRIPTION`), and `invitationRoles(type: UserType, projectId: string): { role: 'ADMIN' | 'MEMBER'; projectId?: string; projectRole?: ProjectRole }`.
- Consumes: the invitation API of Task 2 (`projectId`, `projectRole`; responses with `project`, `projectRole`).

- [ ] **Step 1: Extend the browser check** (`roles-ui.mjs`): as the seed admin, open the workspace Members page and the invite dialog: the type list has the five types; choosing Tester shows a required Project picker listing the workspace's active projects; choosing Workspace admin hides it; creating a Tester invitation for a new email shows it in the Pending invitations table as "Tester in <project name>" and a Workspace admin invitation as "Workspace admin"; opening the invitation link signed out shows the sentence "Tester in <project name>" before sign-up (read the preview text on `/invite/<token>`).
- [ ] **Step 2: Run to verify it fails.** `node roles-ui.mjs red`. Expected: FAIL (two workspace roles, no project picker, no type in the table).
- [ ] **Step 3: Implement.** Replace the invitation form's `RoleRadioGroup` over `ROLE_OPTIONS` with one over the five user types plus a `Select` labelled "Project" (required, shown for the four project types, lists active projects from `GET /workspaces/:id/projects` and says why when there are none and only Workspace admin remains); post `{ email, ...invitationRoles(type, projectId) }`. The pending table's Role column becomes "Type": the type label, and " in <project name>" when the invitation has a project. `InvitePage` shows the same text from the preview. Keep the member rows' Admin/Member select for workspace admins.
- [ ] **Step 4: Verify.** oxlint, `tsc -b`, rebuild, `node roles-ui.mjs green`. Expected: this task's cases PASS and Task 3's still pass.
- [ ] **Step 5: Commit.** `git add apps/web/src/lib/labels.ts apps/web/src/pages/WorkspaceMembersPage.tsx apps/web/src/pages/InvitePage.tsx && git commit -m "feat(web): invite people as one of five user types"`.

### Task 5: Integrations for Automation, and the Permissions page removed

**Files:**
- Modify: `apps/web/src/lib/sections.ts`, `apps/web/src/components/Sidebar.tsx`, `apps/web/src/App.tsx`, `apps/web/src/pages/project/IntegrationsPage.tsx`, `apps/web/src/pages/project/integrations/PlaywrightGuide.tsx`, `apps/web/src/pages/project/integrations/GithubActionsGuide.tsx`, `apps/web/src/pages/WorkspaceMembersPage.tsx`
- Rename: `apps/web/src/components/ProjectAdminOnly.tsx` to `ProjectRoleRoute.tsx`
- Delete: `apps/web/src/pages/WorkspacePermissionsPage.tsx`

**Interfaces:**
- Produces: `ProjectRoleRoute({ roles }: { roles: ProjectRole[] })` (layout route: loading, error, redirect to Test cases when the project role is not in `roles`, else `<Outlet />`); `PROJECT_SECTIONS` entries use `roles?: readonly ProjectRole[]` instead of `adminOnly` (`members`: `['ADMIN']`, `integrations`: `['ADMIN', 'AUTOMATION']`), and `Sidebar` filters by it; the guides take `webhookTab: boolean` and omit the link to `?tab=webhook` when false.
- Consumes: nothing from Task 3; the webhook tab is shown when `currentUserRole === 'ADMIN'` (a workspace admin appears as `ADMIN`).

- [ ] **Step 1: Extend the browser check** (`roles-ui.mjs`): an Automation user (made with `makeUser`-style API calls) sees Integrations but not Members in the menu; the Integrations page has the tabs "Playwright reporter" and "GitHub Actions" and no "CI webhook" tab; opening `…/integrations?tab=webhook` selects the reporter tab; the page makes no request to `/webhook` (collect `page.on('request')`); Members redirects to Test cases. Tester and Viewer still see neither section. The workspace Members page has no "Permissions" tab, and `/workspaces/<id>/permissions` is not a route (ends at `/workspaces`). The seed admin still sees all three Integrations tabs.
- [ ] **Step 2: Run to verify it fails.** `node roles-ui.mjs red`. Expected: FAIL for Automation (no Integrations entry, redirected away) and for the Permissions tab.
- [ ] **Step 3: Implement.** Rename and generalise the guard and update `App.tsx` (two layout routes: `members` with `['ADMIN']`, `integrations` with `['ADMIN','AUTOMATION']`; remove the Permissions route and import); switch `sections.ts` and `Sidebar` to `roles`; in `IntegrationsPage` read the role from `useProjectInfo`, request `/webhook` and show the webhook tab only for `ADMIN`, let an unknown or unavailable `?tab=` fall back to the first tab, and pass `webhookTab` to the guides; remove the Permissions `NavLink` from `WorkspaceTabs`; delete `WorkspacePermissionsPage.tsx`.
- [ ] **Step 4: Verify.** oxlint, `tsc -b` (no references left to the deleted page or the old guard name: `grep -rn 'ProjectAdminOnly\|WorkspacePermissionsPage' apps/web/src` prints nothing), rebuild, `node roles-ui.mjs green`, and the earlier checks `node check.mjs after` and `node role-check.mjs green` in the same folder. Expected: all PASS.
- [ ] **Step 5: Commit.** `git rm apps/web/src/pages/WorkspacePermissionsPage.tsx && git add apps/web/src/components/ProjectRoleRoute.tsx apps/web/src/components/ProjectAdminOnly.tsx apps/web/src/lib/sections.ts apps/web/src/components/Sidebar.tsx apps/web/src/App.tsx apps/web/src/pages/project/IntegrationsPage.tsx apps/web/src/pages/project/integrations apps/web/src/pages/WorkspaceMembersPage.tsx && git status --short` (it must list only the files above, the rename as a rename) `&& git commit -m "feat(web): show Integrations to Automation users and remove the Permissions page"`.

### Task 6: README and smoke test comments

**Files:**
- Modify: `README.md`, `tests/smoke/users.mjs` (comment only)

- [ ] **Step 1: Update the README.** Replace the sentences about the Permissions tab (around line 96 and wherever `grep -n 'Permissions' README.md` finds them) with: the ladder; the assignment rule (workspace admins give every role, project admins the roles below theirs, nobody changes a member at or above their own level); that only workspace admins invite, with a type and, for the four project types, a project; that roles are changed on the Members pages; that Members is for workspace admins and project admins and Integrations also for Automation users (without the webhook settings); and that API tokens still cannot change roles. Keep the existing line about Integrations consistent (it already says the other roles do not see it; it now says Automation does).
- [ ] **Step 2: Check the docs against the spec.** `grep -n 'Permissions' README.md` shows no tab instruction; `git diff design-doc.md` is empty for this task (it was written with the spec); no mention of the reference tool: `! grep -rqi 'q[a]se' README.md design-doc.md docs/superpowers/specs/2026-10-26-role-hierarchy-design.md`.
- [ ] **Step 3: Comment in `users.mjs`.** Add one comment above its "Permissions matrix" section: the matrix API stays workspace-admin only, the project-admin limits are in `roles.mjs`.
- [ ] **Step 4: Full verification.** `docker compose up -d --build`, wait for health, then `node tests/smoke/openapi.mjs && node tests/smoke/scope.mjs && node tests/smoke/api-crud.mjs && node tests/smoke/users.mjs && node tests/smoke/roles.mjs && node tests/smoke/results.mjs && node tests/smoke/webhooks.mjs`; `cd apps/web && npx oxlint src && npx tsc -b`; the browser checks `roles-ui.mjs`, `role-check.mjs`, `check.mjs`. Expected: all pass. Clean up the accounts the checks created only if they hold the test password and the user agrees; otherwise leave them and say so.
- [ ] **Step 5: Commit.** `git add README.md tests/smoke/users.mjs && git commit -m "docs: document the role ladder and who can see what"`. The spec, the plan, `design-doc.md` and the AI spec stay uncommitted unless the user asks.
