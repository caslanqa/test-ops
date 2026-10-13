// Closed installation smoke test: with SELF_REGISTRATION=false only admins of an existing workspace
// may create a workspace (interim rule until the Installation Admin role, FR-090). Needs a stack
// started with sign-up disabled and the seed data (the seeded admin owns the "default" workspace):
//   SELF_REGISTRATION=false docker compose up -d --wait && docker compose exec -T app node prisma/seed.js
//   node tests/smoke/closed-install.mjs
// BASE, ADMIN_EMAIL and ADMIN_PASSWORD change the target. Not part of `test:smoke`, which runs
// against the default open configuration; CI runs it as a separate step after recreating the app.
const BASE = process.env.BASE ?? 'http://localhost:8080/api/v1';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@testops.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
const sfx = Date.now().toString(36);
let failures = 0;

async function call(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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

const config = await ok(null, 'GET', '/auth/config');
check('self-registration is disabled', config.selfRegistration === false, JSON.stringify(config));
await expectStatus('open sign-up is refused', 403, null, 'POST', '/auth/register', { email: `open-${sfx}@test.local`, displayName: 'Open', password: 'OpenPass123' });

const admin = (await ok(null, 'POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).accessToken;
const adminWs = (await ok(admin, 'GET', '/workspaces')).find((w) => w.slug === 'default') ?? (await ok(admin, 'GET', '/workspaces'))[0];
const email = `member-${sfx}@test.local`;
const invite = await ok(admin, 'POST', `/workspaces/${adminWs.id}/invitations`, { email, role: 'MEMBER' });
const member = (await ok(null, 'POST', '/auth/register', { email, displayName: 'Member', password: 'MemberPass123', inviteToken: invite.token })).accessToken;

await expectStatus('a workspace member (not admin) cannot create a workspace', 403, member, 'POST', '/workspaces', { name: `Member ${sfx}`, slug: `member-${sfx}` });
await expectStatus('a workspace admin can create a workspace', 201, admin, 'POST', '/workspaces', { name: `Admin ${sfx}`, slug: `admin-${sfx}` });

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
