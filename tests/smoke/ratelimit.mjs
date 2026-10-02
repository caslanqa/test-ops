// Rate limit smoke testi: genel limit başlıkları, giriş/parola denemesi limitleri, 429 yanıtı.
// Çalışan bir stack'e karşı koşar ve kendi verisini oluşturur:
//   docker compose up -d --wait && docker compose exec -T app node prisma/seed.js
//   node tests/smoke/ratelimit.mjs
// Limit değerleri sabit yazılmaz, yanıt başlıklarından okunur; böylece AUTH_RATE_LIMIT_PER_MINUTE
// değiştirilmiş kurulumlarda da çalışır. Diğer smoke testlerinden sonra koşturulmalıdır: aynı IP'nin
// kimlik denemesi bütçesi yetmezse pencerenin sıfırlanmasını bekler.
const BASE = process.env.BASE ?? 'http://localhost:8080/api/v1';
const ORIGIN = new URL(BASE).origin;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@testops.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
const sfx = Date.now().toString(36);
let failures = 0;

async function call(token, method, path, body, base = BASE) {
  const res = await fetch(base + path, {
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
  return { status: res.status, json, headers: res.headers };
}
function check(label, pass, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${pass ? '' : ` ${detail}`}`);
}
const num = (headers, name) => {
  const value = headers.get(name);
  return value === null ? undefined : Number(value);
};

/** Limit dolana kadar dener; dolduğunda dönen 429 yanıtını ve önceki durumları verir. */
async function exhaust(limit, request) {
  const statuses = [];
  for (let i = 0; i < limit; i++) statuses.push((await request()).status);
  return { statuses, blocked: await request() };
}
function checkBlocked(label, blocked) {
  const retryAfter = num(blocked.headers, 'retry-after');
  check(`[${blocked.status}] ${label}: limit aşılınca 429`, blocked.status === 429, JSON.stringify(blocked.json));
  check(`${label}: Retry-After 1-60 sn`, retryAfter >= 1 && retryAfter <= 60, `(Retry-After: ${retryAfter})`);
  check(
    `${label}: kullanıcıya gösterilebilir mesaj`,
    /^Too many attempts\. Try again in \d+ seconds?\.$/.test(blocked.json?.message ?? ''),
    JSON.stringify(blocked.json),
  );
}

// 1) Sağlık yoklamaları limitlenmez ve sayaç başlığı taşımaz.
for (let i = 0; i < 3; i++) {
  const r = await call(null, 'GET', '/health', undefined, ORIGIN);
  check(`[${r.status}] /health #${i + 1} limit dışı`, r.status === 200 && !r.headers.has('x-ratelimit-limit'));
}

// 2) Genel limit: anonim istekler de sayılır, sayaç route başına değil kimlik başına.
const anon = await call(null, 'GET', '/auth/config');
check('anonim istekte X-RateLimit-Limit var', num(anon.headers, 'x-ratelimit-limit') > 0, `(${anon.headers.get('x-ratelimit-limit')})`);

const adminLogin = await call(null, 'POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
check(`[${adminLogin.status}] admin girişi`, adminLogin.status === 200, JSON.stringify(adminLogin.json));
const admin = adminLogin.json?.accessToken;
const authLimit = num(adminLogin.headers, 'x-ratelimit-limit-auth');
const authIpRemaining = num(adminLogin.headers, 'x-ratelimit-remaining-auth-ip');
const authIpReset = num(adminLogin.headers, 'x-ratelimit-reset-auth-ip');

const me1 = await call(admin, 'GET', '/auth/me');
const ws = await call(admin, 'GET', '/workspaces');
const r1 = num(me1.headers, 'x-ratelimit-remaining');
const r2 = num(ws.headers, 'x-ratelimit-remaining');
check('farklı endpoint\'ler aynı kullanıcı sayacını düşürür', r1 !== undefined && r2 === r1 - 1, `(/auth/me: ${r1}, /workspaces: ${r2})`);

if (!(authLimit > 0)) {
  console.log('SKIP kimlik denemesi limiti kapalı (AUTH_RATE_LIMIT_PER_MINUTE=0)');
} else {
  // Bu testin kullanacağı IP bütçesi: giriş denemeleri + admin girişi + kayıt + parola denemeleri.
  const needed = 2 * (authLimit + 1) + 2;
  if (authIpRemaining !== undefined && authIpRemaining < needed) {
    console.log(`.. IP başına deneme bütçesi yetersiz (${authIpRemaining} < ${needed}); ${authIpReset} sn bekleniyor`);
    await new Promise((resolve) => setTimeout(resolve, (authIpReset + 1) * 1000));
  }

  // 3) Giriş: hesap (+IP) başına limit; parola tahmini yavaşlar.
  const target = `rl-${sfx}@test.local`;
  const login = await exhaust(authLimit, () => call(null, 'POST', '/auth/login', { email: target, password: 'YanlisParola1' }));
  check(`ilk ${authLimit} yanlış giriş 401`, login.statuses.every((s) => s === 401), `(${login.statuses.join(',')})`);
  checkBlocked('giriş', login.blocked);
  const upper = await call(null, 'POST', '/auth/login', { email: target.toUpperCase(), password: 'YanlisParola1' });
  check(`[${upper.status}] e-postanın harf büyüklüğü limiti atlatmaz`, upper.status === 429);

  const again = await call(null, 'POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check(`[${again.status}] aynı IP'den başka hesap kilitlenmez`, again.status === 200, JSON.stringify(again.json));

  // 4) Parola değişikliği: kullanıcı başına limit (ele geçirilmiş oturumla parola tahmini).
  const reg = await call(null, 'POST', '/auth/register', { email: `rl-user-${sfx}@test.local`, displayName: 'Rate Limit', password: 'IlkParola123' });
  check(`[${reg.status}] kayıt`, reg.status === 201, JSON.stringify(reg.json));
  const user = reg.json?.accessToken;
  const pw = await exhaust(authLimit, () =>
    call(user, 'PATCH', '/auth/me/password', { currentPassword: 'YanlisParola1', newPassword: 'YeniParola456' }),
  );
  check(`ilk ${authLimit} yanlış parola değişikliği 401`, pw.statuses.every((s) => s === 401), `(${pw.statuses.join(',')})`);
  checkBlocked('parola değişikliği', pw.blocked);

  // Kimlik denemesi limitine takılan kullanıcı diğer işlemlerine devam edebilir.
  const meAfter = await call(user, 'GET', '/auth/me');
  check(`[${meAfter.status}] parola limiti diğer endpoint'leri etkilemez`, meAfter.status === 200);
}

console.log(failures === 0 ? '\nTÜMÜ GEÇTİ' : `\n${failures} KONTROL BAŞARISIZ`);
process.exit(failures === 0 ? 0 : 1);
