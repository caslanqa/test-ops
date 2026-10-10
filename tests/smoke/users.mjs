// User management smoke test: registration, passwords, roles, membership scope.
// Runs against a running stack and creates its own data:
//   docker compose up -d --wait && docker compose exec -T app node prisma/seed.js
//   node tests/smoke/users.mjs
// Requires SELF_REGISTRATION=true (the default). The target can be changed with BASE, ADMIN_EMAIL and ADMIN_PASSWORD.
const BASE = process.env.BASE ?? 'http://localhost:8080/api/v1';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@testops.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
const sfx = Date.now().toString(36);
let failures = 0;

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
check('a new user has no workspace access', fresh.length === 0, JSON.stringify(fresh));

console.log('--- Profile and password ---');
// The non-ASCII (Turkish) display name is deliberate: it checks that UTF-8 round-trips unchanged.
const prof = await ok(user, 'PATCH', '/auth/me', { displayName: 'Ayşe Yılmaz' });
check('display name updated', prof.displayName === 'Ayşe Yılmaz', JSON.stringify(prof));
await expectStatus('wrong current password', 401, user, 'PATCH', '/auth/me/password', { currentPassword: 'wrong', newPassword: 'NewPass4567' });
await expectStatus('change password', 204, user, 'PATCH', '/auth/me/password', { currentPassword: 'FirstPass123', newPassword: 'NewPass4567' });
await expectStatus('login with the old password is rejected', 401, null, 'POST', '/auth/login', { email, password: 'FirstPass123' });
user = (await ok(null, 'POST', '/auth/login', { email, password: 'NewPass4567' })).accessToken;
check('login with the new password', !!user);
const tok = await ok(user, 'POST', '/api-tokens', { name: 'smoke' });
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

console.log('--- Workspace membership and roles ---');
const wsAsUser = await ok(user, 'GET', `/workspaces/${ws.id}`);
check('workspace response role: MEMBER', wsAsUser.currentUserRole === 'MEMBER', JSON.stringify(wsAsUser));
check('role for admin: ADMIN', (await ok(admin, 'GET', `/workspaces/${ws.id}`)).currentUserRole === 'ADMIN');
await expectStatus('add a member to a project', 201, admin, 'POST', `/projects/${pA.id}/members`, { email, role: 'VIEWER' });
const visible = await ok(user, 'GET', `/workspaces/${ws.id}/projects`);
check('a member only sees their own project', visible.length === 1 && visible[0].id === pA.id, JSON.stringify(visible.map((p) => p.key)));
check('admin sees all projects', (await ok(admin, 'GET', `/workspaces/${ws.id}/projects`)).length === 2);
check('project response role: VIEWER', (await ok(user, 'GET', `/projects/${pA.id}`)).currentUserRole === 'VIEWER');
check('workspace admin appears as ADMIN in the project', (await ok(admin, 'GET', `/projects/${pB.id}`)).currentUserRole === 'ADMIN');
await expectStatus('VIEWER cannot create a case', 403, user, 'POST', `/projects/${pA.id}/cases`, { title: 'x' });
const pm = (await ok(admin, 'GET', `/projects/${pA.id}/members`)).find((m) => m.user.email === email.toLowerCase());
await ok(admin, 'PATCH', `/projects/${pA.id}/members/${pm.id}`, { role: 'TESTER' });
await expectStatus('TESTER creates a case', 201, user, 'POST', `/projects/${pA.id}/cases`, { title: 'Tester case' });
await expectStatus('cannot access a project they are not a member of', 403, user, 'GET', `/projects/${pB.id}`);

console.log('--- Last admin protection ---');
const wsMembers = await ok(admin, 'GET', `/workspaces/${ws.id}/members`);
const adminMember = wsMembers.find((m) => m.user.email === ADMIN_EMAIL);
const userMember = wsMembers.find((m) => m.user.email === email.toLowerCase());
await expectStatus('last admin cannot be demoted to member', 400, admin, 'PATCH', `/workspaces/${ws.id}/members/${adminMember.id}`, { role: 'MEMBER' });
await expectStatus('last admin cannot be removed', 400, admin, 'DELETE', `/workspaces/${ws.id}/members/${adminMember.id}`);
await ok(admin, 'PATCH', `/workspaces/${ws.id}/members/${userMember.id}`, { role: 'ADMIN' });
await expectStatus('an admin can be demoted while there is a second admin', 200, admin, 'PATCH', `/workspaces/${ws.id}/members/${userMember.id}`, { role: 'MEMBER' });

console.log('--- Removal from the workspace also removes project access ---');
await expectStatus('remove the member from the workspace', 200, admin, 'DELETE', `/workspaces/${ws.id}/members/${userMember.id}`);
await expectStatus('a removed member cannot access the project', 403, user, 'GET', `/projects/${pA.id}`);
const left = await ok(admin, 'GET', `/projects/${pA.id}/members`);
check('project membership was deleted too', !left.some((m) => m.user.email === email.toLowerCase()), JSON.stringify(left.map((m) => m.user.email)));

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} CHECKS FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
