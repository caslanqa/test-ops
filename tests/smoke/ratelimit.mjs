// Rate limit smoke test: general limit headers, login/password attempt limits, requests without valid
// credentials, 429 response.
// Runs against a running stack and creates its own data:
//   docker compose up -d --wait && docker compose exec -T app node prisma/seed.js
//   node tests/smoke/ratelimit.mjs
// Limit values are not hard-coded; they are read from the response headers, so the test also works
// on installations with a changed AUTH_RATE_LIMIT_PER_MINUTE. Run it after the other smoke tests: if
// the same IP's credential attempt budget is not enough, it waits for the window to reset.
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

/** Retries until the limit is reached; returns the resulting 429 response and the earlier statuses. */
async function exhaust(limit, request) {
  const statuses = [];
  for (let i = 0; i < limit; i++) statuses.push((await request()).status);
  return { statuses, blocked: await request() };
}
function checkBlocked(label, blocked) {
  const retryAfter = num(blocked.headers, 'retry-after');
  check(`[${blocked.status}] ${label}: 429 once the limit is exceeded`, blocked.status === 429, JSON.stringify(blocked.json));
  check(`${label}: Retry-After 1-60 s`, retryAfter >= 1 && retryAfter <= 60, `(Retry-After: ${retryAfter})`);
  check(
    `${label}: message that can be shown to the user`,
    /^Too many attempts\. Try again in \d+ seconds?\.$/.test(blocked.json?.message ?? ''),
    JSON.stringify(blocked.json),
  );
}

// 1) Health probes are not rate limited and carry no counter headers.
for (let i = 0; i < 3; i++) {
  const r = await call(null, 'GET', '/health', undefined, ORIGIN);
  check(`[${r.status}] /health #${i + 1} exempt from the limit`, r.status === 200 && !r.headers.has('x-ratelimit-limit'));
}

// 2) General limit: anonymous requests count too, and the counter is per identity, not per route.
const anon = await call(null, 'GET', '/auth/config');
check('anonymous request has X-RateLimit-Limit', num(anon.headers, 'x-ratelimit-limit') > 0, `(${anon.headers.get('x-ratelimit-limit')})`);

const adminLogin = await call(null, 'POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
check(`[${adminLogin.status}] admin login`, adminLogin.status === 200, JSON.stringify(adminLogin.json));
const admin = adminLogin.json?.accessToken;
const authLimit = num(adminLogin.headers, 'x-ratelimit-limit-auth');
const authIpRemaining = num(adminLogin.headers, 'x-ratelimit-remaining-auth-ip');
const authIpReset = num(adminLogin.headers, 'x-ratelimit-reset-auth-ip');

const me1 = await call(admin, 'GET', '/auth/me');
const ws = await call(admin, 'GET', '/workspaces');
const r1 = num(me1.headers, 'x-ratelimit-remaining');
const r2 = num(ws.headers, 'x-ratelimit-remaining');
check('different endpoints decrement the same user counter', r1 !== undefined && r2 === r1 - 1, `(/auth/me: ${r1}, /workspaces: ${r2})`);

if (!(authLimit > 0)) {
  console.log('SKIP credential attempt limit is disabled (AUTH_RATE_LIMIT_PER_MINUTE=0)');
} else {
  // IP budget this test uses: login attempts + admin login + registration + password attempts.
  const needed = 2 * (authLimit + 1) + 2;
  if (authIpRemaining !== undefined && authIpRemaining < needed) {
    console.log(`.. per-IP attempt budget is insufficient (${authIpRemaining} < ${needed}); waiting ${authIpReset} s`);
    await new Promise((resolve) => setTimeout(resolve, (authIpReset + 1) * 1000));
  }

  // 3) Login: limit per account (+IP); password guessing slows down.
  const target = `rl-${sfx}@test.local`;
  const login = await exhaust(authLimit, () => call(null, 'POST', '/auth/login', { email: target, password: 'WrongPass123' }));
  check(`first ${authLimit} wrong logins return 401`, login.statuses.every((s) => s === 401), `(${login.statuses.join(',')})`);
  checkBlocked('login', login.blocked);
  const upper = await call(null, 'POST', '/auth/login', { email: target.toUpperCase(), password: 'WrongPass123' });
  check(`[${upper.status}] email letter case does not bypass the limit`, upper.status === 429);

  const again = await call(null, 'POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check(`[${again.status}] other accounts from the same IP are not locked`, again.status === 200, JSON.stringify(again.json));

  // 4) Password change: per-user limit (password guessing with a hijacked session).
  const reg = await call(null, 'POST', '/auth/register', { email: `rl-user-${sfx}@test.local`, displayName: 'Rate Limit', password: 'FirstPass123' });
  check(`[${reg.status}] registration`, reg.status === 201, JSON.stringify(reg.json));
  const user = reg.json?.accessToken;
  const pw = await exhaust(authLimit, () =>
    call(user, 'PATCH', '/auth/me/password', { currentPassword: 'WrongPass123', newPassword: 'NewPass4567' }),
  );
  check(`first ${authLimit} wrong password changes return 401`, pw.statuses.every((s) => s === 401), `(${pw.statuses.join(',')})`);
  checkBlocked('password change', pw.blocked);

  // A user who hit the credential attempt limit can still use everything else.
  const meAfter = await call(user, 'GET', '/auth/me');
  check(`[${meAfter.status}] the password limit does not affect other endpoints`, meAfter.status === 200);
}

// 5) Requests without valid credentials count against the client address. AuthGuard rejects them
//    before the per-user limit runs, so they used to be unlimited and each guessed API token cost a
//    database lookup. The 401s of the earlier suites count too, so the 429 may come a bit earlier.
const ipLimit = num(anon.headers, 'x-ratelimit-limit');
if (!(ipLimit > 0)) {
  console.log('SKIP request limit is disabled (RATE_LIMIT_PER_MINUTE=0)');
} else {
  const ciToken = (await call(admin, 'POST', '/api-tokens', { name: `rate limit ${sfx}` })).json?.token;
  const wrongToken = () => call('tops_not-a-real-token', 'GET', '/workspaces');
  let first = await wrongToken();
  if (first.status === 429) {
    const wait = num(first.headers, 'retry-after') ?? 60;
    console.log(`.. this address is still blocked from an earlier run; waiting ${wait} s`);
    await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000));
    first = await wrongToken();
  }
  const unauthorized = [];
  let blocked = first;
  while (blocked.status === 401 && unauthorized.length < ipLimit) {
    unauthorized.push(blocked.status);
    blocked = await wrongToken();
  }
  check(`requests with a wrong API token get 401 up to the limit (${unauthorized.length} of at most ${ipLimit})`,
    unauthorized.length > 0 && unauthorized.length <= ipLimit, `(stopped at ${blocked.status})`);
  const wait = num(blocked.headers, 'retry-after');
  check(`[${blocked.status}] then 429 with Retry-After 1-60 s`, blocked.status === 429 && wait >= 1 && wait <= 60, JSON.stringify(blocked.json));
  const noToken = await call(null, 'GET', '/workspaces');
  check(`[${noToken.status}] requests without a token from that address get 429 too`, noToken.status === 429);
  const tokenWhileBlocked = await call(ciToken, 'GET', '/auth/me');
  check(`[${tokenWhileBlocked.status}] API tokens from that address wait as well (no lookups while blocked)`, tokenWhileBlocked.status === 429);
  const session = await call(admin, 'GET', '/auth/me');
  check(`[${session.status}] signed-in web sessions from that address keep working`, session.status === 200);
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
