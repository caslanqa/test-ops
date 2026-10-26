// Role ladder smoke test: who can give, change and remove which project role, and what an invitation carries.
// Runs against a running stack and creates its own data:
//   docker compose up -d --wait && docker compose exec -T app node prisma/seed.js
//   node tests/smoke/roles.mjs
// Requires SELF_REGISTRATION=true (the default). The target can be changed with BASE, ADMIN_EMAIL and ADMIN_PASSWORD.
//
// The rule (design-doc.md, section 3): a workspace admin gives every project role; a project admin gives and
// manages only Tester, Automation and Viewer, so cannot raise anyone to their own level, touch a peer, or
// demote or remove themselves. API tokens cannot manage members at all, whoever owns them.
const BASE = process.env.BASE ?? 'http://localhost:8080/api/v1';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@testops.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
const PASSWORD = 'RolesPass123';
const sfx = Date.now().toString(36);
let failures = 0;

async function call(token, method, path, body) {
  // Sign-up and sign-in allow only a few attempts a minute, so a run that follows another suite waits out a
  // 429 instead of failing.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 61_000));
      continue;
    }
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
    return { status: res.status, json };
  }
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

console.log('--- Setup ---');
const ws = await ok(admin, 'POST', '/workspaces', { name: 'Roles test', slug: `roles-${sfx}` });
const project = await ok(admin, 'POST', `/workspaces/${ws.id}/projects`, { key: 'RL', name: 'Roles project' });
const members = `/projects/${project.id}/members`;

const register = (body) => ok(null, 'POST', '/auth/register', body);

/**
 * An account that joined the workspace by invitation, with `projectRole` in the project (none when null).
 * The role is given through the workspace permissions API, which only a web session may call.
 */
async function makeUser(label, projectRole) {
  const email = `${label}-${sfx}@roles.test`;
  const invitation = await ok(admin, 'POST', `/workspaces/${ws.id}/invitations`, { email, role: 'MEMBER' });
  const session = await register({ email, displayName: label, password: PASSWORD, inviteToken: invitation.token });
  const user = { label, email, id: session.user.id, token: session.accessToken };
  user.apiToken = (await ok(user.token, 'POST', '/api-tokens', { name: label })).token;
  if (projectRole) await setRole(user, projectRole);
  return user;
}
/** Sets (or, with null, clears) a user's project role as the workspace admin, whatever it was. */
const setRole = (user, role) => ok(admin, 'PUT', `/workspaces/${ws.id}/permissions/projects/${project.id}/users/${user.id}`, { role });
/** The id of the user's project member record, or undefined. */
const memberIdOf = async (user) => (await ok(admin, 'GET', members)).find((m) => m.user.id === user.id)?.id;

const pa = await makeUser('pa', 'ADMIN');
const pa2 = await makeUser('pa2', 'ADMIN');
const tester = await makeUser('tester', 'TESTER');
const viewer = await makeUser('viewer', 'VIEWER');
const candidate = await makeUser('candidate', null);

console.log('--- Project admin limits ---');
const giveAdmin = await call(pa.token, 'POST', members, { email: candidate.email, role: 'ADMIN' });
check(`[${giveAdmin.status}] a project admin cannot give the Project admin role`, giveAdmin.status === 403, JSON.stringify(giveAdmin.json));
check('...and the refusal names the roles they can give', String(giveAdmin.json?.message).includes('TESTER, AUTOMATION, VIEWER'), JSON.stringify(giveAdmin.json));
await setRole(candidate, null);
check('...nothing was added', (await memberIdOf(candidate)) === undefined);
for (const role of ['TESTER', 'AUTOMATION', 'VIEWER']) {
  await setRole(candidate, null);
  await expectStatus(`a project admin gives the ${role} role`, 201, pa.token, 'POST', members, { email: candidate.email, role });
}
await setRole(candidate, 'TESTER');
const candidateRecord = await memberIdOf(candidate);
await expectStatus('a project admin cannot raise a member to Project admin', 403, pa.token, 'PATCH', `${members}/${candidateRecord}`, { role: 'ADMIN' });
await setRole(candidate, 'TESTER');
await expectStatus('a project admin changes a Tester to Viewer', 200, pa.token, 'PATCH', `${members}/${await memberIdOf(candidate)}`, { role: 'VIEWER' });

await setRole(pa2, 'ADMIN');
const pa2Record = await memberIdOf(pa2);
await expectStatus('a project admin cannot demote another project admin', 403, pa.token, 'PATCH', `${members}/${pa2Record}`, { role: 'TESTER' });
await setRole(pa2, 'ADMIN');
await expectStatus('a project admin cannot remove another project admin', 403, pa.token, 'DELETE', `${members}/${await memberIdOf(pa2)}`);
await setRole(pa2, 'ADMIN');
await expectStatus('a project admin cannot give a peer the role they already have', 403, pa.token, 'POST', members, { email: pa2.email, role: 'ADMIN' });
check('...the other project admin is still one', (await memberIdOf(pa2)) !== undefined);

await setRole(pa, 'ADMIN');
await expectStatus('a project admin cannot demote themselves', 403, pa.token, 'PATCH', `${members}/${await memberIdOf(pa)}`, { role: 'VIEWER' });
await setRole(pa, 'ADMIN');
await expectStatus('a project admin cannot remove themselves', 403, pa.token, 'DELETE', `${members}/${await memberIdOf(pa)}`);

await setRole(pa, 'ADMIN');
await setRole(candidate, 'TESTER');
await expectStatus('a project admin removes a Tester', 200, pa.token, 'DELETE', `${members}/${await memberIdOf(candidate)}`);
await setRole(candidate, null);
await expectStatus('an API token cannot give a role, not even one below its owner', 403, pa.apiToken, 'POST', members, { email: candidate.email, role: 'VIEWER' });
await expectStatus('an API token cannot give the Project admin role', 403, pa.apiToken, 'POST', members, { email: candidate.email, role: 'ADMIN' });

console.log('--- Workspace admin ---');
await setRole(candidate, null);
await expectStatus('a workspace admin gives the Project admin role', 201, admin, 'POST', members, { email: candidate.email, role: 'ADMIN' });
const grantedRecord = await memberIdOf(candidate);
await expectStatus('a workspace admin changes a project admin to Tester', 200, admin, 'PATCH', `${members}/${grantedRecord}`, { role: 'TESTER' });
await expectStatus('a workspace admin raises a Tester to Project admin', 200, admin, 'PATCH', `${members}/${grantedRecord}`, { role: 'ADMIN' });
await expectStatus('a workspace admin removes a project admin', 200, admin, 'DELETE', `${members}/${grantedRecord}`);
await setRole(pa2, 'ADMIN');
await expectStatus('a workspace admin changes another project admin', 200, admin, 'PATCH', `${members}/${await memberIdOf(pa2)}`, { role: 'TESTER' });
await setRole(pa2, 'ADMIN');

console.log('--- Other roles ---');
const target = await memberIdOf(pa2);
for (const who of [tester, viewer]) {
  await expectStatus(`a ${who.label} cannot add a member`, 403, who.token, 'POST', members, { email: candidate.email, role: 'VIEWER' });
  await expectStatus(`a ${who.label} cannot change a member`, 403, who.token, 'PATCH', `${members}/${target}`, { role: 'VIEWER' });
  await expectStatus(`a ${who.label} cannot remove a member`, 403, who.token, 'DELETE', `${members}/${target}`);
}
check('...and the project admin is untouched', (await memberIdOf(pa2)) === target);

console.log('--- Invitations with a project ---');
const invite = (body) => call(admin, 'POST', `/workspaces/${ws.id}/invitations`, body);
const roleOf = async (userId) => (await ok(admin, 'GET', members)).find((m) => m.user.id === userId)?.role;

// An existing account accepts an invitation that carries a project and a role.
const existingEmail = `existing-${sfx}@roles.test`;
const existing = await register({ email: existingEmail, displayName: 'Existing', password: PASSWORD });
const withProject = await invite({ email: existingEmail, role: 'MEMBER', projectId: project.id, projectRole: 'TESTER' });
check(`[${withProject.status}] an invitation can carry a project and a role`, withProject.status === 201 && withProject.json?.projectRole === 'TESTER' && withProject.json?.project?.id === project.id, JSON.stringify(withProject.json));
const listed = (await ok(admin, 'GET', `/workspaces/${ws.id}/invitations`)).find((i) => i.email === existingEmail);
check('the list shows its project and role', listed?.projectRole === 'TESTER' && listed?.project?.key === 'RL' && listed?.project?.name === 'Roles project', JSON.stringify(listed));
const preview = await call(null, 'GET', `/invitations/${withProject.json?.token}`);
check(`[${preview.status}] the preview shows its project and role without signing in`, preview.status === 200 && preview.json?.projectRole === 'TESTER' && preview.json?.project?.name === 'Roles project', JSON.stringify(preview.json));
check('the person has no project role before accepting', (await roleOf(existing.user.id)) === undefined);
await expectStatus('the invited account accepts', 201, existing.accessToken, 'POST', `/invitations/${withProject.json?.token}/accept`);
check('accepting gives the project role', (await roleOf(existing.user.id)) === 'TESTER', String(await roleOf(existing.user.id)));

// A new account created with the link gets the role too.
const newEmail = `newcomer-${sfx}@roles.test`;
const forNewcomer = await invite({ email: newEmail, role: 'MEMBER', projectId: project.id, projectRole: 'VIEWER' });
const newcomer = await register({ email: newEmail, displayName: 'Newcomer', password: PASSWORD, inviteToken: forNewcomer.json?.token });
check('signing up with the link gives the project role', (await roleOf(newcomer.user.id)) === 'VIEWER', String(await roleOf(newcomer.user.id)));

// An invitation without a project behaves as before.
const plainEmail = `plain-${sfx}@roles.test`;
const plain = await register({ email: plainEmail, displayName: 'Plain', password: PASSWORD });
const withoutProject = await invite({ email: plainEmail, role: 'MEMBER' });
check('an invitation without a project has none in the response', withoutProject.json?.project === null && withoutProject.json?.projectRole === null, JSON.stringify(withoutProject.json));
await expectStatus('...and accepts', 201, plain.accessToken, 'POST', `/invitations/${withoutProject.json?.token}/accept`);
check('...without a project role', (await roleOf(plain.user.id)) === undefined);

// What an invitation may not combine.
const other = await invite({ email: `bad-${sfx}@roles.test`, role: 'ADMIN', projectId: project.id, projectRole: 'TESTER' });
check(`[${other.status}] a workspace admin invitation takes no project`, other.status === 400, JSON.stringify(other.json));
const onlyProject = await invite({ email: `bad-${sfx}@roles.test`, role: 'MEMBER', projectId: project.id });
check(`[${onlyProject.status}] a project without a role is rejected`, onlyProject.status === 400, JSON.stringify(onlyProject.json));
const onlyRole = await invite({ email: `bad-${sfx}@roles.test`, role: 'MEMBER', projectRole: 'TESTER' });
check(`[${onlyRole.status}] a role without a project is rejected`, onlyRole.status === 400, JSON.stringify(onlyRole.json));
const otherWorkspace = await ok(admin, 'POST', '/workspaces', { name: 'Roles other', slug: `roles-other-${sfx}` });
const foreignProject = await ok(admin, 'POST', `/workspaces/${otherWorkspace.id}/projects`, { key: 'RO', name: 'Other project' });
const foreign = await invite({ email: `bad-${sfx}@roles.test`, role: 'MEMBER', projectId: foreignProject.id, projectRole: 'TESTER' });
check(`[${foreign.status}] a project of another workspace is not found`, foreign.status === 404, JSON.stringify(foreign.json));
const archivedProject = await ok(admin, 'POST', `/workspaces/${ws.id}/projects`, { key: 'RA', name: 'Archived project' });
await ok(admin, 'DELETE', `/projects/${archivedProject.id}`);
const archived = await invite({ email: `bad-${sfx}@roles.test`, role: 'MEMBER', projectId: archivedProject.id, projectRole: 'TESTER' });
check(`[${archived.status}] an archived project is rejected`, archived.status === 400, JSON.stringify(archived.json));

console.log(failures === 0 ? '\nAll role checks passed.' : `\n${failures} role check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
