// CI webhook smoke test (project → Integrations).
//   node tests/smoke/webhooks.mjs
//     Against the default stack: private addresses are refused (when saved, and when a name
//     resolves to one at call time), secrets never come back, API tokens can't manage the webhook,
//     and only runs with automated cases (not runs CI started) call it.
//   WEBHOOK_ALLOW_PRIVATE_NETWORKS=true docker compose up -d --wait app && node tests/smoke/webhooks.mjs --deliver
//     Real calls: a small receiver runs inside the app container (docker compose exec), and the
//     test checks the body, the headers, the signature, failures and retries.
// Needs the seeded admin (prisma/seed.js); BASE, ADMIN_EMAIL and ADMIN_PASSWORD change the target.
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';

const BASE = process.env.BASE ?? 'http://localhost:8080/api/v1';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@testops.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
const deliverMode = process.argv.includes('--deliver');
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
  return { status: res.status, json, text };
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** The run's CI status once its webhook call has an outcome (the call runs in the background). */
async function ciStatus(token, P, runId, { settled = true } = {}) {
  for (let i = 0; i < 30; i++) {
    const status = await ok(token, 'GET', `${P}/runs/${runId}/ci`);
    if (!settled || (status.lastDelivery && status.lastDelivery.attempts > 0)) return status;
    await sleep(200);
  }
  return ok(token, 'GET', `${P}/runs/${runId}/ci`);
}

const admin = (await ok(null, 'POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).accessToken;
const ws = await ok(admin, 'POST', '/workspaces', { name: `Webhooks ${sfx}`, slug: `webhooks-${sfx}` });
const project = await ok(admin, 'POST', `/workspaces/${ws.id}/projects`, { key: 'HOOK', name: 'Webhooks' });
const P = `/projects/${project.id}`;
const automated = await ok(admin, 'POST', `${P}/cases`, { title: 'Pay by card', automationStatus: 'AUTOMATED', tags: ['e2e:checkout-card'] });
const manual = await ok(admin, 'POST', `${P}/cases`, { title: 'Looks right on a phone' });

if (!deliverMode) {
  console.log('--- Saving a webhook ---');
  check('a project starts without a webhook', (await ok(admin, 'GET', `${P}/webhook`)).webhook === null);
  await expectStatus('a private IP address is refused', 400, admin, 'PUT', `${P}/webhook`, { url: 'http://127.0.0.1:8099/hook' });
  await expectStatus('...and so is localhost', 400, admin, 'PUT', `${P}/webhook`, { url: 'https://localhost/hook' });
  await expectStatus('...and the cloud metadata address', 400, admin, 'PUT', `${P}/webhook`, { url: 'http://169.254.169.254/latest/meta-data' });
  await expectStatus('only http(s) URLs are accepted', 400, admin, 'PUT', `${P}/webhook`, { url: 'ftp://ci.example.com/hook' });
  await expectStatus('credentials in the URL are refused', 400, admin, 'PUT', `${P}/webhook`, { url: 'https://user:pass@ci.example.com/hook' });
  await expectStatus('headers TestOps sets itself are refused', 400, admin, 'PUT', `${P}/webhook`, { url: 'https://ci.example.com/hook', headers: [{ name: 'Content-Type', value: 'text/plain' }] });
  // "postgres" is the database container: a name that only resolves to a private address.
  const created = await call(admin, 'PUT', `${P}/webhook`, {
    url: 'http://postgres:5432/hook',
    headers: [{ name: 'Authorization', value: 'Bearer s3cret-value' }],
  });
  check(`[${created.status}] a webhook is created, with its signing secret shown once`,
    created.status === 200 && /^[0-9a-f]{64}$/.test(created.json?.secret ?? '') && created.json.webhook.headerNames.join() === 'Authorization', created.text);
  const settings = await call(admin, 'GET', `${P}/webhook`);
  check('header values and the secret never come back', !settings.text.includes('s3cret-value') && !settings.text.includes(created.json.secret)
    && !settings.text.includes('Encrypted'), settings.text);
  const kept = await ok(admin, 'PUT', `${P}/webhook`, { url: 'http://postgres:5432/hook2' });
  check('saving without headers keeps them, and no new secret is made', kept.webhook.headerNames.join() === 'Authorization' && kept.secret === null);
  const apiToken = (await ok(admin, 'POST', '/api-tokens', { name: `webhooks-${sfx}` })).token;
  await expectStatus('an API token cannot read the webhook', 403, apiToken, 'GET', `${P}/webhook`);
  await expectStatus('...or change it', 403, apiToken, 'PUT', `${P}/webhook`, { url: 'https://evil.example.com/hook' });

  console.log('--- Calls ---');
  const ping = await ok(admin, 'POST', `${P}/webhook/ping`);
  check('a name that resolves to a private address is refused when calling', ping.status === 'FAILED' && /private or local/.test(ping.error ?? ''), JSON.stringify(ping));
  const run = await ok(admin, 'POST', `${P}/runs`, { title: 'Mixed run', testCaseIds: [automated.id, manual.id] });
  const status = await ciStatus(admin, P, run.id);
  check('a run with automated cases calls the webhook', status.configured && status.lastDelivery?.status === 'FAILED', JSON.stringify(status));
  const ciRun = await ok(apiToken, 'POST', `${P}/runs`, { title: 'From CI', source: 'CI', testCaseIds: [automated.id] });
  await sleep(500);
  check('a run that CI started never calls it', (await ok(admin, 'GET', `${P}/runs/${ciRun.id}/ci`)).lastDelivery === null);
  const manualRun = await ok(admin, 'POST', `${P}/runs`, { title: 'Manual run', testCaseIds: [manual.id] });
  await sleep(500);
  check('...and neither does a run without automated cases', (await ok(admin, 'GET', `${P}/runs/${manualRun.id}/ci`)).lastDelivery === null);
  await expectStatus('Trigger CI on a run without automated cases is refused', 400, admin, 'POST', `${P}/runs/${manualRun.id}/ci`);
  await ok(admin, 'PUT', `${P}/webhook`, { url: 'http://postgres:5432/hook2', enabled: false });
  const offRun = await ok(admin, 'POST', `${P}/runs`, { title: 'Webhook off', testCaseIds: [automated.id] });
  await sleep(500);
  check('a switched-off webhook is not called', (await ok(admin, 'GET', `${P}/runs/${offRun.id}/ci`)).lastDelivery === null);
  await expectStatus('a removed webhook is gone', 204, admin, 'DELETE', `${P}/webhook`);
  check('...and the project has none', (await ok(admin, 'GET', `${P}/webhook`)).webhook === null);
} else {
  console.log('--- Calls to a receiver in the app container ---');
  // Prints every request as a JSON line; /fail answers 500 and /forbidden 401, the rest 204.
  const receiverCode = `const http=require('http');http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{const code=q.url.startsWith('/fail')?500:q.url.startsWith('/forbidden')?401:204;console.log(JSON.stringify({path:q.url,headers:q.headers,body:b}));s.writeHead(code);s.end(code===204?'':'nope');});}).listen(8099,'127.0.0.1',()=>console.log('READY'));`;
  const receiver = spawn('docker', ['compose', 'exec', '-T', 'app', 'node', '-e', receiverCode], { stdio: ['ignore', 'pipe', 'inherit'] });
  const received = [];
  let ready = false;
  let buffer = '';
  receiver.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line === 'READY') ready = true;
      else if (line.startsWith('{')) received.push(JSON.parse(line));
    }
  });
  for (let i = 0; i < 50 && !ready; i++) await sleep(200);
  check('the receiver started', ready);
  const waitFor = async (match) => {
    for (let i = 0; i < 50; i++) {
      const found = received.find(match);
      if (found) return found;
      await sleep(200);
    }
    return undefined;
  };
  try {
    const created = await ok(admin, 'PUT', `${P}/webhook`, {
      url: 'http://127.0.0.1:8099/ok',
      headers: [{ name: 'Authorization', value: 'Bearer ci-token' }],
    });
    const secret = created.secret;
    const ping = await ok(admin, 'POST', `${P}/webhook/ping`);
    check('a test call is delivered', ping.status === 'SUCCEEDED' && ping.responseCode === 204, JSON.stringify(ping));
    const pinged = await waitFor((r) => r.headers['x-testops-event'] === 'ping');
    check('...with the saved header', pinged?.headers.authorization === 'Bearer ci-token', JSON.stringify(pinged?.headers));
    check('...signed with the secret',
      pinged?.headers['x-testops-signature-256'] === `sha256=${createHmac('sha256', secret).update(pinged.body).digest('hex')}`);
    check('...in the shape of a GitHub repository_dispatch', JSON.parse(pinged?.body ?? '{}').event_type === 'testops.ping');

    const run = await ok(admin, 'POST', `${P}/runs`, { title: 'Release check', testCaseIds: [automated.id, manual.id] });
    const started = await waitFor((r) => r.headers['x-testops-event'] === 'run.started');
    const payload = JSON.parse(started?.body ?? '{}').client_payload ?? {};
    check('a started run is delivered to CI', payload.run?.id === run.id && /\/api\/v1$/.test(payload.api_url ?? ''), started?.body);
    check('...with only its automated cases and their keys',
      payload.automated_cases?.length === 1 && payload.automated_cases[0].test_case_id === automated.id
        && payload.automation_keys?.join() === 'checkout-card', JSON.stringify(payload));
    check('...and the run shows it was delivered', (await ciStatus(admin, P, run.id)).lastDelivery?.status === 'SUCCEEDED');

    await ok(admin, 'PUT', `${P}/webhook`, { url: 'http://127.0.0.1:8099/forbidden' });
    const refused = await ok(admin, 'POST', `${P}/runs/${run.id}/ci`);
    check('a 4xx answer fails at once, without retries', refused.status === 'FAILED' && refused.attempts === 1 && refused.responseCode === 401, JSON.stringify(refused));
    await ok(admin, 'PUT', `${P}/webhook`, { url: 'http://127.0.0.1:8099/fail' });
    const failing = await ok(admin, 'POST', `${P}/runs/${run.id}/ci`);
    check('a 5xx answer is tried again later', failing.status === 'PENDING' && failing.attempts === 1 && failing.responseCode === 500, JSON.stringify(failing));
    await ok(admin, 'POST', `${P}/runs/${run.id}/complete`);
    await expectStatus('a completed run cannot trigger CI', 400, admin, 'POST', `${P}/runs/${run.id}/ci`);
  } finally {
    receiver.kill();
  }
}

await ok(admin, 'DELETE', `/workspaces/${ws.id}`, { confirmName: ws.name });
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
