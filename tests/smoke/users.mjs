// Kullanıcı yönetimi smoke testi: kayıt, parola, roller, üyelik kapsamı.
// Çalışan bir stack'e karşı koşar ve kendi verisini oluşturur:
//   docker compose up -d --wait && docker compose exec -T app node prisma/seed.js
//   node tests/smoke/users.mjs
// SELF_REGISTRATION=true (varsayılan) olmalı. BASE, ADMIN_EMAIL, ADMIN_PASSWORD ile hedef değiştirilebilir.
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
  check(`[${r.status}] ${label}`, r.status === expected, `(beklenen ${expected}) ${JSON.stringify(r.json)}`);
  return r;
}

const admin = (await ok(null, 'POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).accessToken;

console.log('--- Kayıt ve oturum ---');
const config = await ok(null, 'GET', '/auth/config');
check('kayıt yapılandırması açık', config.selfRegistration === true, JSON.stringify(config));
const email = `Yeni.Kullanici-${sfx}@Test.Local`;
const reg = await expectStatus('kayıt ol', 201, null, 'POST', '/auth/register', { email, displayName: 'Yeni Kullanıcı', password: 'IlkParola123' });
let user = reg.json.accessToken;
check('kayıtta e-posta küçük harfe çevrildi', reg.json.user.email === email.toLowerCase(), reg.json.user.email);
await expectStatus('aynı e-postayla (farklı harf) tekrar kayıt reddedilir', 409, null, 'POST', '/auth/register', { email: email.toUpperCase(), displayName: 'X Y', password: 'BaskaParola1' });
await expectStatus('kısa parola reddedilir', 400, null, 'POST', '/auth/register', { email: `kisa-${sfx}@test.local`, displayName: 'Kısa', password: '123' });
await expectStatus('büyük harfli e-postayla giriş', 200, null, 'POST', '/auth/login', { email: email.toUpperCase(), password: 'IlkParola123' });
const fresh = await ok(user, 'GET', '/workspaces');
check('yeni kullanıcının hiçbir workspace erişimi yok', fresh.length === 0, JSON.stringify(fresh));

console.log('--- Profil ve parola ---');
const prof = await ok(user, 'PATCH', '/auth/me', { displayName: 'Ayşe Yılmaz' });
check('ad güncellendi', prof.displayName === 'Ayşe Yılmaz', JSON.stringify(prof));
await expectStatus('yanlış mevcut parola', 401, user, 'PATCH', '/auth/me/password', { currentPassword: 'yanlis', newPassword: 'YeniParola456' });
await expectStatus('parola değiştir', 204, user, 'PATCH', '/auth/me/password', { currentPassword: 'IlkParola123', newPassword: 'YeniParola456' });
await expectStatus('eski parolayla giriş reddedilir', 401, null, 'POST', '/auth/login', { email, password: 'IlkParola123' });
user = (await ok(null, 'POST', '/auth/login', { email, password: 'YeniParola456' })).accessToken;
check('yeni parolayla giriş', !!user);
const tok = await ok(user, 'POST', '/api-tokens', { name: 'smoke' });
await expectStatus('API token ile parola değiştirilemez', 403, tok.token, 'PATCH', '/auth/me/password', { currentPassword: 'YeniParola456', newPassword: 'Baska789012' });
const revoked = await ok(user, 'DELETE', `/api-tokens/${tok.id}`);
check('token iptal yanıtında tokenHash yok', revoked && !('tokenHash' in revoked), JSON.stringify(revoked));
await expectStatus('iptal edilen token reddedilir', 401, tok.token, 'GET', '/auth/me');

console.log('--- Workspace üyeliği ve roller ---');
const ws = await ok(admin, 'POST', '/workspaces', { name: 'Üyelik testi', slug: `uyelik-${sfx}` });
const pA = await ok(admin, 'POST', `/workspaces/${ws.id}/projects`, { key: 'UA', name: 'Proje A' });
const pB = await ok(admin, 'POST', `/workspaces/${ws.id}/projects`, { key: 'UB', name: 'Proje B' });
await expectStatus('workspace üyesi olmayanı projeye ekleme reddedilir', 400, admin, 'POST', `/projects/${pA.id}/members`, { email, role: 'TESTER' });
await ok(admin, 'POST', `/workspaces/${ws.id}/members`, { email: email.toUpperCase(), role: 'MEMBER' });
const wsAsUser = await ok(user, 'GET', `/workspaces/${ws.id}`);
check('workspace yanıtında rol: MEMBER', wsAsUser.currentUserRole === 'MEMBER', JSON.stringify(wsAsUser));
check('admin için rol: ADMIN', (await ok(admin, 'GET', `/workspaces/${ws.id}`)).currentUserRole === 'ADMIN');
await expectStatus('üye projeye ekleme', 201, admin, 'POST', `/projects/${pA.id}/members`, { email, role: 'VIEWER' });
const visible = await ok(user, 'GET', `/workspaces/${ws.id}/projects`);
check('üye yalnızca kendi projesini görür', visible.length === 1 && visible[0].id === pA.id, JSON.stringify(visible.map((p) => p.key)));
check('admin tüm projeleri görür', (await ok(admin, 'GET', `/workspaces/${ws.id}/projects`)).length === 2);
check('proje yanıtında rol: VIEWER', (await ok(user, 'GET', `/projects/${pA.id}`)).currentUserRole === 'VIEWER');
check('workspace admin projede ADMIN görünür', (await ok(admin, 'GET', `/projects/${pB.id}`)).currentUserRole === 'ADMIN');
await expectStatus('VIEWER case oluşturamaz', 403, user, 'POST', `/projects/${pA.id}/cases`, { title: 'x' });
const pm = (await ok(admin, 'GET', `/projects/${pA.id}/members`)).find((m) => m.user.email === email.toLowerCase());
await ok(admin, 'PATCH', `/projects/${pA.id}/members/${pm.id}`, { role: 'TESTER' });
await expectStatus('TESTER case oluşturur', 201, user, 'POST', `/projects/${pA.id}/cases`, { title: 'Tester case' });
await expectStatus('üye olmadığı projeye erişemez', 403, user, 'GET', `/projects/${pB.id}`);

console.log('--- Son admin koruması ---');
const wsMembers = await ok(admin, 'GET', `/workspaces/${ws.id}/members`);
const adminMember = wsMembers.find((m) => m.user.email === ADMIN_EMAIL);
const userMember = wsMembers.find((m) => m.user.email === email.toLowerCase());
await expectStatus('son admin üyeye düşürülemez', 400, admin, 'PATCH', `/workspaces/${ws.id}/members/${adminMember.id}`, { role: 'MEMBER' });
await expectStatus('son admin çıkarılamaz', 400, admin, 'DELETE', `/workspaces/${ws.id}/members/${adminMember.id}`);
await expectStatus('son admin tekrar ekleme yoluyla düşürülemez', 400, admin, 'POST', `/workspaces/${ws.id}/members`, { email: ADMIN_EMAIL, role: 'MEMBER' });
await ok(admin, 'PATCH', `/workspaces/${ws.id}/members/${userMember.id}`, { role: 'ADMIN' });
await expectStatus('ikinci admin varken admin düşürülebilir', 200, admin, 'PATCH', `/workspaces/${ws.id}/members/${userMember.id}`, { role: 'MEMBER' });

console.log('--- Workspace\'ten çıkarma proje erişimini de kaldırır ---');
await expectStatus('üyeyi workspace\'ten çıkar', 200, admin, 'DELETE', `/workspaces/${ws.id}/members/${userMember.id}`);
await expectStatus('çıkarılan üye projeye erişemez', 403, user, 'GET', `/projects/${pA.id}`);
const left = await ok(admin, 'GET', `/projects/${pA.id}/members`);
check('proje üyeliği de silindi', !left.some((m) => m.user.email === email.toLowerCase()), JSON.stringify(left.map((m) => m.user.email)));

console.log(`\n${failures === 0 ? 'TÜMÜ GEÇTİ' : `${failures} BAŞARISIZ`}`);
process.exit(failures === 0 ? 0 : 1);
