// User management smoke test: registration, passwords and sessions, API tokens, roles, membership scope.
// Runs against a running stack and creates its own data:
//   docker compose up -d --wait && docker compose exec -T app node prisma/seed.js
//   node tests/smoke/users.mjs
// Requires SELF_REGISTRATION=true (the default). The target can be changed with BASE, ADMIN_EMAIL and ADMIN_PASSWORD.
import { execFileSync } from 'node:child_process';
const BASE = process.env.BASE ?? 'http://localhost:8080/api/v1';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@testops.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
const sfx = Date.now().toString(36);
let failures = 0;

// The API refuses lifetimes below one day, so an expired token has to be made through the database.
// Runs from the repo root against the compose stack (set POSTGRES_USER / POSTGRES_DB if changed).
function sql(statement) {
  return execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql', '-U', process.env.POSTGRES_USER ?? 'testops', '-d', process.env.POSTGRES_DB ?? 'testops', '-v', 'ON_ERROR_STOP=1', '-c', statement],
    { cwd: new URL('../..', import.meta.url), encoding: 'utf8' },
  );
}

async function call(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { status: res.status, json };
}
async function ok(token, method, path, body) {
  const r = await call(token, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}
function check(label, pass, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${pass ? '' : ` ${detail}`}`);
}
async function expectStatus(label, expected, token, method, path, body) {
  const r = await call(token, method, path, body);
  check(`[${r.status}] ${label}`, r.status === expected, `(expected ${expected}) ${JSON.stringify(r.json)}`);
  return r;
}

const admin = (await ok(null, 'POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).accessToken;

console.log('--- Registration and session ---');
const config = await ok(null, 'GET', '/auth/config');
check('registration config is enabled', config.selfRegistration === true, JSON.stringify(config));
const email = `New.User-${sfx}@Test.Local`;
const reg = await expectStatus('register', 201, null, 'POST', '/auth/register', { email, displayName: 'New User', password: 'FirstPass123' });
let user = reg.json.accessToken;
check('email lowercased on registration', reg.json.user.email === email.toLowerCase(), reg.json.user.email);
await expectStatus('re-registering with the same email (different case) is rejected', 409, null, 'POST', '/auth/register', { email: email.toUpperCase(), displayName: 'X Y', password: 'OtherPass123' });
await expectStatus('short password is rejected', 400, null, 'POST', '/auth/register', { email: `short-${sfx}@test.local`, displayName: 'Short', password: '123' });
await expectStatus('login with an uppercase email', 200, null, 'POST', '/auth/login', { email: email.toUpperCase(), password: 'FirstPass123' });
const fresh = await ok(user, 'GET', '/workspaces');
// Only the built-in DEMO workspace, which everyone can look at, is listed.
check('a new user is a member of no workspace', fresh.every((w) => w.isDemo), JSON.stringify(fresh));

console.log('--- Profile and password ---');
// The non-ASCII (Turkish) display name is deliberate: it checks that UTF-8 round-trips unchanged.
const prof = await ok(user, 'PATCH', '/auth/me', { displayName: 'Ayşe Yılmaz' });
check('display name updated', prof.displayName === 'Ayşe Yılmaz', JSON.stringify(prof));
const early = await ok(user, 'POST', '/api-tokens', { name: 'created before the password change' });
await expectStatus('wrong current password', 401, user, 'PATCH', '/auth/me/password', { currentPassword: 'wrong', newPassword: 'NewPass4567' });
const changed = await expectStatus('change password', 200, user, 'PATCH', '/auth/me/password', { currentPassword: 'FirstPass123', newPassword: 'NewPass4567' });
await expectStatus('a password change ends the sessions signed in before it', 401, user, 'GET', '/auth/me');
await expectStatus('...and gives the browser that made it a new session', 200, changed.json?.accessToken, 'GET', '/auth/me');
// A stolen session may have minted tokens, so the password change must end them too.
await expectStatus('a password change revokes API tokens created before it', 401, early.token, 'GET', '/auth/me');
await expectStatus('a stale session cannot change the password a second time', 401, user, 'PATCH', '/auth/me/password', { currentPassword: 'NewPass4567', newPassword: 'Another7890' });
await expectStatus('login with the old password is rejected', 401, null, 'POST', '/auth/login', { email, password: 'FirstPass123' });
user = (await ok(null, 'POST', '/auth/login', { email, password: 'NewPass4567' })).accessToken;
check('login with the new password', !!user);

console.log('--- API tokens ---');
const tok = await ok(user, 'POST', '/api-tokens', { name: 'smoke' });
const lifetimeOf = (t) => (Date.parse(t.expiresAt) - Date.now()) / 86_400_000;
check('a token without expiresInDays gets the 90-day default', tok.expiresAt && lifetimeOf(tok) > 89.9 && lifetimeOf(tok) <= 90, JSON.stringify(tok));
const forever = await call(user, 'POST', '/api-tokens', { name: 'forever', expiresInDays: null });
check(`[${forever.status}] an explicit null means no expiration`, forever.status === 201 && forever.json?.expiresAt === null, JSON.stringify(forever.json));
await expectStatus('a lifetime of zero days is rejected', 400, user, 'POST', '/api-tokens', { name: 'zero', expiresInDays: 0 });
const expiring = await call(user, 'POST', '/api-tokens', { name: 'expiring', expiresInDays: 30 });
const lifetimeDays = (Date.parse(expiring.json?.expiresAt) - Date.now()) / 86_400_000;
check(`[${expiring.status}] a token can expire after a number of days`, expiring.status === 201 && lifetimeDays > 29.9 && lifetimeDays <= 30, JSON.stringify(expiring.json));
const short = await ok(user, 'POST', '/api-tokens', { name: 'about to expire', expiresInDays: 1 });
sql(`UPDATE api_tokens SET "expiresAt" = now() - interval '1 minute' WHERE id = '${short.id}'`);
await expectStatus('an expired token is rejected', 401, short.token, 'GET', '/auth/me');
await expectStatus('a lifetime longer than a year is rejected', 400, user, 'POST', '/api-tokens', { name: 'too long', expiresInDays: 366 });
// A leaked token must not be able to keep access by creating more tokens.
await expectStatus('an API token cannot create tokens', 403, tok.token, 'POST', '/api-tokens', { name: 'minted' });
await expectStatus('...list them', 403, tok.token, 'GET', '/api-tokens');
await expectStatus('...or revoke them', 403, tok.token, 'DELETE', `/api-tokens/${early.id}`);
await expectStatus('a token without an expiry still works while valid', 200, forever.json.token, 'GET', '/auth/me');
await expectStatus('password cannot be changed with an API token', 403, tok.token, 'PATCH', '/auth/me/password', { currentPassword: 'NewPass4567', newPassword: 'Other789012' });
const revoked = await ok(user, 'DELETE', `/api-tokens/${tok.id}`);
check('token revoke response has no tokenHash', revoked && !('tokenHash' in revoked), JSON.stringify(revoked));
await expectStatus('revoked token is rejected', 401, tok.token, 'GET', '/auth/me');

console.log('--- Workspace setup ---');
const ws = await ok(admin, 'POST', '/workspaces', { name: 'Membership test', slug: `membership-${sfx}` });
const pA = await ok(admin, 'POST', `/workspaces/${ws.id}/projects`, { key: 'UA', name: 'Project A' });
const pB = await ok(admin, 'POST', `/workspaces/${ws.id}/projects`, { key: 'UB', name: 'Project B' });
await expectStatus('adding a non-workspace-member to a project is rejected', 400, admin, 'POST', `/projects/${pA.id}/members`, { email, role: 'TESTER' });

console.log('--- Invitations ---');
// Inviting must not reveal whether an address has an account, and nobody joins without accepting.
const known = await call(admin, 'POST', `/workspaces/${ws.id}/invitations`, { email: email.toUpperCase(), role: 'MEMBER' });
const unknownEmail = `nobody-${sfx}@test.local`;
const unknown = await call(admin, 'POST', `/workspaces/${ws.id}/invitations`, { email: unknownEmail, role: 'MEMBER' });
const shape = (r) => `${r.status}:${Object.keys(r.json ?? {}).sort().join(',')}`;
check('an existing account and an unknown address get the same answer', known.status === 201 && shape(known) === shape(unknown), `${shape(known)} vs ${shape(unknown)}`);
check('the answer carries no account details', !('displayName' in (known.json ?? {})) && !('user' in (known.json ?? {})), JSON.stringify(known.json));
await expectStatus('inviting creates no account', 401, null, 'POST', '/auth/login', { email: unknownEmail, password: 'Whatever123' });
check('an invited user is not a member before accepting', !(await ok(user, 'GET', '/workspaces')).some((w) => w.id === ws.id));
await expectStatus('the old direct-add endpoint is gone', 404, admin, 'POST', `/workspaces/${ws.id}/members`, { email, role: 'MEMBER' });
const preview = await call(null, 'GET', `/invitations/${known.json?.token}`);
check(`[${preview.status}] the link shows the workspace and invited address without signing in`,
  preview.status === 200 && preview.json?.workspace?.id === ws.id && preview.json?.email === email.toLowerCase(), JSON.stringify(preview.json));
const pendingList = await ok(admin, 'GET', `/workspaces/${ws.id}/invitations`);
check('admins see pending invitations without their links',
  pendingList.length === 2 && pendingList.every((i) => !('token' in i) && !('tokenHash' in i)), JSON.stringify(pendingList));
await expectStatus('another account cannot use the link', 403, user, 'POST', `/invitations/${unknown.json?.token}/accept`);
await expectStatus('the invited account accepts', 201, user, 'POST', `/invitations/${known.json?.token}/accept`);
await expectStatus('a link works only once', 404, user, 'POST', `/invitations/${known.json?.token}/accept`);
await expectStatus('a used link no longer opens', 404, null, 'GET', `/invitations/${known.json?.token}`);
await expectStatus('members cannot see pending invitations', 403, user, 'GET', `/workspaces/${ws.id}/invitations`);
await expectStatus('inviting a member again is rejected', 409, admin, 'POST', `/workspaces/${ws.id}/invitations`, { email, role: 'ADMIN' });
// The failed attempt by another account left this link unused, so it can still be revoked.
await expectStatus('admins revoke an invitation', 204, admin, 'DELETE', `/workspaces/${ws.id}/invitations/${unknown.json?.id}`);
await expectStatus('a revoked link no longer opens', 404, null, 'GET', `/invitations/${unknown.json?.token}`);
// The link's holder can create the invited account, which joins the workspace at once. The link
// is checked first: another address gets 403 even if it has an account, so 409 can't reveal one.
const second = await ok(admin, 'POST', `/workspaces/${ws.id}/invitations`, { email: unknownEmail, role: 'MEMBER' });
await expectStatus('the link creates no other address and reveals none', 403, null, 'POST', '/auth/register', { email, displayName: 'Someone', password: 'SomeonePass123', inviteToken: second.token });
const invited = await expectStatus('the link creates the invited account', 201, null, 'POST', '/auth/register', { email: unknownEmail, displayName: 'Invited', password: 'InvitedPass123', inviteToken: second.token });
check('...which joins the workspace', (await ok(invited.json?.accessToken, 'GET', '/workspaces')).some((w) => w.id === ws.id));

// An API token must not create access that outlives it, even for a workspace admin.
const adminToken = (await ok(admin, 'POST', '/api-tokens', { name: 'smoke-admin' })).token;
const viaToken = await expectStatus('an API token cannot create an invitation', 403, adminToken, 'POST', `/workspaces/${ws.id}/invitations`, { email: `token-${sfx}@test.local`, role: 'MEMBER' });
check('...and says to use a web session', /web session/i.test(String(viaToken.json?.message)), JSON.stringify(viaToken.json));
const pendingInvite = await ok(admin, 'POST', `/workspaces/${ws.id}/invitations`, { email: `token2-${sfx}@test.local`, role: 'MEMBER' });
await expectStatus('an API token cannot revoke an invitation', 403, adminToken, 'DELETE', `/workspaces/${ws.id}/invitations/${pendingInvite.id}`);
await expectStatus('...while a signed-in admin can', 204, admin, 'DELETE', `/workspaces/${ws.id}/invitations/${pendingInvite.id}`);

console.log('--- Workspace membership and roles ---');
const wsAsUser = await ok(user, 'GET', `/workspaces/${ws.id}`);
check('workspace response role: MEMBER', wsAsUser.currentUserRole === 'MEMBER', JSON.stringify(wsAsUser));
check('role for admin: ADMIN', (await ok(admin, 'GET', `/workspaces/${ws.id}`)).currentUserRole === 'ADMIN');
await expectStatus('an API token cannot add a project member', 403, adminToken, 'POST', `/projects/${pA.id}/members`, { email, role: 'ADMIN' });
await expectStatus('add a member to a project', 201, admin, 'POST', `/projects/${pA.id}/members`, { email, role: 'VIEWER' });
const visible = await ok(user, 'GET', `/workspaces/${ws.id}/projects`);
check('a member only sees their own project', visible.length === 1 && visible[0].id === pA.id, JSON.stringify(visible.map((p) => p.key)));
check('admin sees all projects', (await ok(admin, 'GET', `/workspaces/${ws.id}/projects`)).length === 2);
check('project response role: VIEWER', (await ok(user, 'GET', `/projects/${pA.id}`)).currentUserRole === 'VIEWER');
check('workspace admin appears as ADMIN in the project', (await ok(admin, 'GET', `/projects/${pB.id}`)).currentUserRole === 'ADMIN');
await expectStatus('VIEWER cannot create a case', 403, user, 'POST', `/projects/${pA.id}/cases`, { title: 'x' });
const pm = (await ok(admin, 'GET', `/projects/${pA.id}/members`)).find((m) => m.user.email === email.toLowerCase());
await expectStatus('an API token cannot change a project role', 403, adminToken, 'PATCH', `/projects/${pA.id}/members/${pm.id}`, { role: 'ADMIN' });
await ok(admin, 'PATCH', `/projects/${pA.id}/members/${pm.id}`, { role: 'TESTER' });
await expectStatus('TESTER creates a case', 201, user, 'POST', `/projects/${pA.id}/cases`, { title: 'Tester case' });
await expectStatus('cannot access a project they are not a member of', 403, user, 'GET', `/projects/${pB.id}`);

console.log('--- Last admin protection ---');
const wsMembers = await ok(admin, 'GET', `/workspaces/${ws.id}/members`);
const adminMember = wsMembers.find((m) => m.user.email === ADMIN_EMAIL);
const userMember = wsMembers.find((m) => m.user.email === email.toLowerCase());
await expectStatus('last admin cannot be demoted to member', 400, admin, 'PATCH', `/workspaces/${ws.id}/members/${adminMember.id}`, { role: 'MEMBER' });
await expectStatus('last admin cannot be removed', 400, admin, 'DELETE', `/workspaces/${ws.id}/members/${adminMember.id}`);
await expectStatus('an API token cannot change a member role', 403, adminToken, 'PATCH', `/workspaces/${ws.id}/members/${userMember.id}`, { role: 'ADMIN' });
await ok(admin, 'PATCH', `/workspaces/${ws.id}/members/${userMember.id}`, { role: 'ADMIN' });
await expectStatus('an admin can be demoted while there is a second admin', 200, admin, 'PATCH', `/workspaces/${ws.id}/members/${userMember.id}`, { role: 'MEMBER' });

console.log('--- Permissions matrix ---');
const matrix = await expectStatus('admins read the permissions matrix', 200, admin, 'GET', `/workspaces/${ws.id}/permissions`);
check('the matrix lists the members, the projects and the project roles',
  matrix.json?.members?.some((m) => m.user.email === email.toLowerCase())
    && matrix.json?.projects?.some((p) => p.id === pB.id)
    && matrix.json?.projectMembers?.some((m) => m.projectId === pA.id && m.userId === userMember.user.id && m.role === 'TESTER'),
  JSON.stringify(matrix.json));
await expectStatus('members cannot read the matrix', 403, user, 'GET', `/workspaces/${ws.id}/permissions`);
const cell = `/workspaces/${ws.id}/permissions/projects/${pB.id}/users/${userMember.user.id}`;
await expectStatus('an API token cannot set a project role', 403, adminToken, 'PUT', cell, { role: 'VIEWER' });
await expectStatus('members cannot set project roles', 403, user, 'PUT', cell, { role: 'ADMIN' });
await expectStatus('an unknown role is rejected', 400, admin, 'PUT', cell, { role: 'OWNER' });
await expectStatus('a missing role is rejected', 400, admin, 'PUT', cell, {});
const granted = await expectStatus('an admin gives a member a role in another project', 200, admin, 'PUT', cell, { role: 'VIEWER' });
check('...answering with the saved role', granted.json?.role === 'VIEWER', JSON.stringify(granted.json));
check('...and the member can open that project now', (await call(user, 'GET', `/projects/${pB.id}`)).status === 200);
await ok(admin, 'PUT', cell, { role: 'ADMIN' });
check("the workspace's project list carries the caller's role in each project",
  (await ok(user, 'GET', `/workspaces/${ws.id}/projects`)).find((p) => p.id === pB.id)?.currentUserRole === 'ADMIN');
const taken = await expectStatus('role null takes the member out of the project', 200, admin, 'PUT', cell, { role: null });
check('...answering role null', taken.json?.role === null, JSON.stringify(taken.json));
await expectStatus('...and the project is closed to them again', 403, user, 'GET', `/projects/${pB.id}`);
const otherWs = await ok(admin, 'POST', '/workspaces', { name: 'Other permissions', slug: `other-perms-${sfx}` });
const otherProject = await ok(admin, 'POST', `/workspaces/${otherWs.id}/projects`, { key: 'OTH', name: 'Other' });
await expectStatus("another workspace's project is not found", 404, admin, 'PUT', `/workspaces/${ws.id}/permissions/projects/${otherProject.id}/users/${userMember.user.id}`, { role: 'VIEWER' });
await expectStatus('someone outside the workspace is not found', 404, admin, 'PUT', `/workspaces/${otherWs.id}/permissions/projects/${otherProject.id}/users/${userMember.user.id}`, { role: 'VIEWER' });

console.log('--- Deleting a project for good ---');
const doomed = await ok(admin, 'POST', `/workspaces/${ws.id}/projects`, { key: 'DOOM', name: 'Doomed' });
const doomedCase = await ok(admin, 'POST', `/projects/${doomed.id}/cases`, { title: 'Goes with the project' });
await ok(admin, 'POST', `/projects/${doomed.id}/runs`, { title: 'Run in a doomed project', testCaseIds: [doomedCase.id] });
await expectStatus('a project must be archived before it is deleted for good', 409, admin, 'DELETE', `/projects/${doomed.id}/permanently`, { confirmKey: 'DOOM' });
await ok(admin, 'DELETE', `/projects/${doomed.id}`);
await expectStatus('the key must be repeated exactly', 400, admin, 'DELETE', `/projects/${doomed.id}/permanently`, { confirmKey: 'doom' });
await ok(admin, 'PUT', `/workspaces/${ws.id}/permissions/projects/${doomed.id}/users/${userMember.user.id}`, { role: 'ADMIN' });
await expectStatus('a project admin cannot delete it for good', 403, user, 'DELETE', `/projects/${doomed.id}/permanently`, { confirmKey: 'DOOM' });
await expectStatus('a workspace admin deletes an archived project for good', 204, admin, 'DELETE', `/projects/${doomed.id}/permanently`, { confirmKey: 'DOOM' });
await expectStatus('...and it is gone', 403, admin, 'GET', `/projects/${doomed.id}`);
await expectStatus('an unknown project gets the same answer', 403, admin, 'DELETE', `/projects/${doomed.id}/permanently`, { confirmKey: 'DOOM' });

console.log('--- Removal from the workspace also removes project access ---');
await expectStatus('remove the member from the workspace', 200, admin, 'DELETE', `/workspaces/${ws.id}/members/${userMember.id}`);
await expectStatus('a removed member cannot access the project', 403, user, 'GET', `/projects/${pA.id}`);
const left = await ok(admin, 'GET', `/projects/${pA.id}/members`);
check('project membership was deleted too', !left.some((m) => m.user.email === email.toLowerCase()), JSON.stringify(left.map((m) => m.user.email)));

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} CHECKS FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
