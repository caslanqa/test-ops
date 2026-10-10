// OpenAPI smoke test: the published API reference stays complete and matches what AuthGuard enforces.
// Runs against a running stack:
//   docker compose up -d --wait && docker compose exec -T app node prisma/seed.js
//   node tests/smoke/openapi.mjs
// BASE, ADMIN_EMAIL, ADMIN_PASSWORD can be used to change the target.
const BASE = process.env.BASE ?? 'http://localhost:8080/api/v1';
const ORIGIN = new URL(BASE).origin;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@testops.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
let failures = 0;

function check(label, pass, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${pass ? '' : ` ${detail}`}`);
}

// Endpoints that must work without a token. Adding a public endpoint is a deliberate,
// reviewed change: update this list together with the @Public() decorator.
const EXPECTED_PUBLIC = [
  'GET /api/v1/auth/config',
  'GET /api/v1/invitations/{token}',
  'GET /api/v1/public/runs/{token}',
  'GET /health',
  'GET /ready',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/register',
];

const docRes = await fetch(`${ORIGIN}/api/docs-json`);
check(`[${docRes.status}] /api/docs-json`, docRes.status === 200);
const doc = await docRes.json();

const operations = Object.entries(doc.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
    .map(([method, op]) => ({ key: `${method.toUpperCase()} ${path}`, op })),
);
check(`documents the API (${operations.length} operations)`, operations.length > 50);

const withoutSecurity = operations.filter(({ op }) => !Array.isArray(op.security)).map(({ key }) => key);
check('every operation declares its security', withoutSecurity.length === 0, withoutSecurity.join(', '));

const publicOps = operations.filter(({ op }) => op.security?.length === 0).map(({ key }) => key).sort();
check(
  'public operations are exactly the @Public() endpoints',
  JSON.stringify(publicOps) === JSON.stringify(EXPECTED_PUBLIC),
  `got ${JSON.stringify(publicOps)}`,
);
const bearer = operations.filter(({ op }) => op.security?.some((s) => 'bearer' in s)).length;
check('all other operations require the bearer token', bearer === operations.length - publicOps.length);

const leftovers = operations.filter(({ op }) => Object.keys(op).some((k) => k.startsWith('x-testops'))).length;
check('internal x-testops markers are removed', leftovers === 0, `${leftovers} operations`);

const schemas = doc.components?.schemas ?? {};
const empty = Object.entries(schemas).filter(([, s]) => !s.properties && !s.enum && !s.allOf).map(([n]) => n);
check(`no empty schemas (${Object.keys(schemas).length} schemas)`, empty.length === 0, empty.join(', '));

// Free-form JSON is the only legitimate untyped object; anything else is a field the plugin
// couldn't infer (typically a Prisma enum without @ApiProperty({ enum })).
const FREE_FORM = ['CreateTestCaseDto.customFields', 'UpdateTestCaseDto.customFields'];
const untyped = Object.entries(schemas).flatMap(([name, s]) =>
  Object.entries(s.properties ?? {})
    .filter(([, p]) => p.type === 'object' && !p.$ref && !p.properties)
    .map(([prop]) => `${name}.${prop}`)
    .filter((key) => !FREE_FORM.includes(key)),
);
check('no untyped object properties', untyped.length === 0, untyped.join(', '));

const login = schemas.LoginDto;
check(
  'LoginDto documents email and password as required',
  login?.properties?.email && login?.properties?.password && ['email', 'password'].every((p) => login.required?.includes(p)),
  JSON.stringify(login),
);
const bulk = schemas.BulkSubmitResultsDto?.properties?.results;
check('bulk results are limited to 500 items', bulk?.maxItems === 500, JSON.stringify(bulk));
// Named enums are emitted as their own schema and referenced from the property.
const resolve = (p) => (p?.$ref ? schemas[p.$ref.split('/').pop()] : p);
const status = resolve(schemas.SubmitResultDto?.properties?.status);
check('result status lists its values', (status?.enum ?? []).includes('PASSED'), JSON.stringify(status));
check('describes rate limits (FR-077)', /Retry-After/.test(doc.info?.description ?? ''));

const ui = await fetch(`${ORIGIN}/api/docs`);
const html = await ui.text();
check(`[${ui.status}] Swagger UI is served`, ui.status === 200 && html.includes('TestOps API reference'));

const anon = await fetch(`${BASE}/system/info`);
check(`[${anon.status}] /system/info requires sign-in`, anon.status === 401);
const loginRes = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
});
const { accessToken } = await loginRes.json();
const info = await fetch(`${BASE}/system/info`, { headers: { authorization: `Bearer ${accessToken}` } });
const infoBody = await info.json();
check(
  `[${info.status}] /system/info returns the version`,
  info.status === 200 && typeof infoBody.version === 'string' && infoBody.version.length > 0 && infoBody.apiVersion === 'v1',
  JSON.stringify(infoBody),
);
check('the public document does not reveal the release version', doc.info?.version === 'v1' && !JSON.stringify(doc).includes(infoBody.version) || infoBody.version === 'dev', doc.info?.version);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
