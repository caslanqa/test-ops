# Role hierarchy: who can give which role, and who sees what

Date: 2026-10-26.

## Goal

One ladder of user types, and access that follows from the type:

1. **Workspace admin**
2. **Project admin**
3. **Tester**
4. **Automation**
5. **Viewer**

Today the invitation form offers only the two workspace roles (Admin, Member), a project admin can make
another project admin, and the Permissions page is a second place to manage roles. After this change:

- the invitation form offers all five types;
- nobody can give a role at or above their own, except that a workspace admin can give every role;
- only workspace admins and project admins change roles, and they do it on the Members pages;
- the Permissions page goes away;
- Integrations is visible to workspace admins, project admins and Automation users;
- the rule for who may define an AI provider URL is written down for the AI assistant work.

## Decisions

1. **Assignment rule.** The limit is enforced on the server, and the web app lists only the roles the
   user may give.

   | Who | May give | May change or remove members who hold |
   |---|---|---|
   | Workspace admin | every role, workspace admin included | any role |
   | Project admin | Tester, Automation, Viewer | Tester, Automation, Viewer |
   | Tester, Automation, Viewer | nothing | nothing |

   A workspace admin is the top of the ladder and nobody is above to appoint another one, so the rule is
   "strictly below" for everyone except the top. A project admin cannot touch a peer or a higher role, which
   includes their own: they cannot demote or remove themselves.
2. **One list, two roles underneath.** "Workspace admin" is the workspace role `ADMIN`. The other four types
   are the project roles `ADMIN`, `TESTER`, `AUTOMATION`, `VIEWER`, held together with the workspace role
   `MEMBER`. A workspace admin is a project admin in every project (unchanged), so a workspace admin is
   never given a project role.
3. **Invitations carry a project.** Choosing a project role needs a project, so the invitation form shows a
   required project picker for every type except Workspace admin. The invitation stores the project and the
   role; accepting it makes the person a workspace member and gives them that role in that project.
4. **Who invites does not change.** Only workspace admins create invitations. A project admin adds people who
   are already workspace members, on the project's Members page, within the limit above.
5. **No Permissions page.** The page, its route and its tab are removed. Workspace roles (Admin/Member) are
   changed on the workspace Members page, project roles on the project Members page. The API of the page
   (`GET /workspaces/:id/permissions`, `PUT …/permissions/projects/:projectId/users/:userId`) stays for API
   clients and gets the same limit; workspace admins remain the only ones allowed to use it.
6. **Integrations visibility.** The menu entry and the address are for workspace admins, project admins and
   Automation users. Automation sees the **Playwright reporter** and **GitHub Actions** tabs; the **CI
   webhook** tab holds credentials and stays with the admins, and the webhook API stays admin-only.
7. **Members visibility** is unchanged: workspace admins and project admins.
8. **AI provider URL (future).** Only workspace admins and project admins may define an AI provider URL
   (and its model and credential). Tester, Automation and Viewer never can. Nothing is built for it now; the
   rule is recorded in the AI assistant spec.

## Server

- `AccessControlService` gets one place for the rule:
  `assignableProjectRoles(userId, projectId)` and `manageableProjectRoles(userId, projectId)` (both from the
  actor's workspace role and project role). `ProjectsService.addMember`, `updateMemberRole` and
  `removeMember` use them: the new role must be assignable, and the member's current role (when they have
  one) must be manageable. A breach is `403` with a message naming the roles the caller may give.
- `WorkspacesService.setProjectRole` keeps its workspace-admin check; the limit holds trivially there.
- Invitations: `workspace_invitations` gets `projectId` (nullable, foreign key to `projects`, cascade) and
  `projectRole` (nullable `ProjectRole`) in a migration. `CreateInvitationDto` gains optional `projectId` and
  `projectRole`; both or neither, neither when `role` is `ADMIN`, and the project must belong to the workspace
  and not be archived. Listing and the public preview return the project (`id`, `key`, `name`) and
  `projectRole`.
- Accepting an invitation, inside the transaction that claims it: create the workspace membership as before,
  then, when the invitation has a project, create the project membership with the stored role unless the
  person already has one (an invitation never changes an existing role). An invitation is deleted with its
  project (the foreign key cascades), so a pending invitation for a deleted project no longer opens. Sign-up with an
  invitation link does the same through `claim`.
- Existing invitations have no project and behave as before.

## Web

- Shared helper in `lib/permissions.ts`: `assignableProjectRoles({ workspaceAdmin, projectRole })` and
  `manageableProjectRoles(...)`, and `canSeeIntegrations(role)`. The workspace role comes from the
  project's workspace (`useProjectInfo`), because a workspace admin appears as `ADMIN` in `currentUserRole`.
- Workspace **Members**: the invitation form has one **Type** list (the five types, each with its
  description) and a **Project** picker (active projects of the workspace) for the four project types. The
  pending-invitation table shows the type and project. The member rows keep their workspace role control
  (Admin/Member) for workspace admins.
- Project **Members**: the role list shows only assignable roles; a member row whose role is not manageable
  shows the role as text, without a role control or a remove button.
- **Invite page**: says what the person will get ("Tester in project X").
- **Permissions**: route, page and tab removed; the role descriptions move to the pickers.
- **Integrations**: `sections.ts` marks the entry as visible to `ADMIN` and `AUTOMATION`; the
  `ProjectAdminOnly` route guard takes the allowed roles; the page hides the webhook tab and its request for
  Automation.

## Documentation

- `design-doc.md` (written with this spec): section 3 gets the ladder, the assignment rule and the
  visibility of Members and Integrations; FR-096 records who may define the AI provider URL and marks FR-087,
  FR-090, FR-091 and FR-093 as reopened by it.
- AI assistant spec (written with this spec): a section stating decision 8 and what it reopens (see below),
  including that a project admin choosing the endpoint makes the private-address exception unsafe.
- README (with the implementation): the roles and the ladder, the assignment rule, who sees Members and
  Integrations, where roles are changed (replacing the Permissions-tab sentences), and the invitation form.
- Smoke test header comments name the rule they check.

## AI assistant spec

`docs/superpowers/specs/2026-10-23-ai-assistant-foundation-design.md` makes the Installation Admin (an
environment variable) the only one who sets the provider. This change replaces that: workspace admins and
project admins define the provider URL, so the settings move from one installation-wide row to settings
owned by a workspace or a project. The spec gets a marked section with that rule and the points it
reopens (where the settings live, which one wins, the credential's scope); it is reworked before its plan is
written. Nothing is implemented now.

## Tests

- `tests/smoke/users.mjs`, new cases against the running stack: a project admin gets `403` giving `ADMIN`,
  changing or removing another project admin, and demoting or removing themselves; the same admin manages a
  Tester, an Automation user and a Viewer; a workspace admin gives every role; a workspace admin cannot be
  given a project role through the invitation; an invitation with a project and a role creates the
  membership when accepted (existing account and new sign-up), keeps an existing role, and one without a
  project behaves as before; both-or-neither and project-of-another-workspace answer `400` and `404`;
  Tester, Automation and Viewer get `403` on member changes.
- The existing permissions-matrix cases in that file stay: the API is unchanged for workspace admins.
- A browser check against the local stack (kept outside the repository, as the web app has no unit test
  framework): admin sees Members and Integrations; Tester and Viewer see neither and are sent to Test
  cases; Automation sees Integrations with two tabs and no webhook tab, and not Members; the invitation form
  lists five types and asks for a project; a project admin's role list lacks Project admin.

## Risks and limits

- Workspace admins lose the cross-project matrix view. Project roles are read and changed per project.
- A project admin cannot leave a project or demote themselves; a workspace admin does it.
- A person can have only one project role per project, as now.
- The invitation form needs at least one active project to invite a non-admin type; with none, only
  Workspace admin is offered and the form says why.
