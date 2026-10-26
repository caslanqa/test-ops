// A fake AI provider for tests/smoke/ai.mjs. It runs inside the app container, so its address is a loopback
// one (the app may send requests there), and speaks both formats the app supports:
//   POST /v1/chat/completions  OpenAI-compatible chat completions with response_format json_schema
//   POST /v1/messages          Anthropic Messages with one forced tool
// How it answers depends on the request's `model`:
//   ok (and any other name)  a valid answer
//   bad-json                 an answer whose content isn't JSON
//   invalid                  JSON that doesn't fit the schema
//   fail500                  HTTP 500 with INTERNAL-SECRET-BODY in the body
//   unsupported              HTTP 400 saying response_format json_schema isn't supported
//   huge                     HTTP 200 with a body over 2 MiB
//   redirect                 HTTP 302
//   slow                     an answer after 20 s
//   flaky                    the first call (since the last reset) isn't JSON, the rest are valid
//   revise                   the first coverage audit (since the last reset) asks for a revision
//   slow-after-review        the requirement review is instant, every later call answers after 20 s
// Control: GET /__last (the last request: path, headers, body), GET /__calls (every request: path, model),
// POST /__reset, POST /__quit. Start it with `docker compose exec -T app node -` and the file on stdin.
const http = require('http');

let last = null;
let calls = [];
let flakyCalls = 0;
let audits = 0;

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const REVIEW = {
  summary: 'A user can reset a forgotten password by email.',
  acceptanceCriteria: ['A reset link is emailed to a known address', 'A reset link stops working after one hour'],
  findings: [{ kind: 'question', severity: 'low', text: 'Which template does the email use?' }],
};
const DESIGN = {
  cases: [
    {
      title: 'Reset link is emailed',
      preconditions: null,
      steps: [{ action: 'Request a reset for a known address', expectedResult: 'An email with a link arrives' }],
      priority: 'HIGH',
      type: 'FUNCTIONAL',
      kind: 'positive',
    },
    {
      title: 'Expired reset link is rejected',
      preconditions: 'A link older than one hour',
      steps: [{ action: 'Open the link', expectedResult: null }],
      priority: 'MEDIUM',
      type: 'REGRESSION',
      kind: 'negative',
    },
  ],
};
const audit = (revisionNeeded) => ({
  coverage: [{ criterion: 0, caseIndexes: [0] }, { criterion: 1, caseIndexes: [1] }],
  uncovered: [],
  duplicates: [],
  revisionNeeded,
  notes: revisionNeeded ? 'Add a boundary case for exactly one hour' : 'Both criteria are covered',
});
function cannedOutput(schemaName, model) {
  switch (schemaName) {
    case 'connection_test': return { ok: true };
    case 'requirement_review': return REVIEW;
    case 'test_design': return DESIGN;
    case 'coverage_audit': return audit(model === 'revise' && audits++ === 0);
    default: return {};
  }
}

function validAnswer(res, anthropic, model, schemaName, output) {
  json(
    res,
    200,
    anthropic
      ? {
          id: 'msg_fake',
          type: 'message',
          role: 'assistant',
          model,
          content: [{ type: 'tool_use', id: 'toolu_fake', name: schemaName, input: output }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 11, output_tokens: 7 },
        }
      : {
          id: 'chatcmpl-fake',
          object: 'chat.completion',
          model,
          choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(output) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        },
  );
}
function notJson(res, anthropic, model) {
  const text = 'this is not json';
  json(
    res,
    200,
    anthropic
      ? { id: 'msg_fake', type: 'message', role: 'assistant', model, content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 11, output_tokens: 4 } }
      : { id: 'chatcmpl-fake', object: 'chat.completion', model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 } },
  );
}

const server = http.createServer((req, res) => {
  res.on('error', () => {});
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('error', () => {});
  req.on('end', () => {
    if (req.url === '/__last') return json(res, 200, last);
    if (req.url === '/__calls') return json(res, 200, calls);
    if (req.url === '/__reset') {
      last = null;
      calls = [];
      flakyCalls = 0;
      audits = 0;
      return json(res, 200, { reset: true });
    }
    if (req.url === '/__quit') return res.end('bye', () => process.exit(0));

    const anthropic = req.url === '/v1/messages';
    if (!anthropic && req.url !== '/v1/chat/completions') return json(res, 404, { error: 'unknown path' });
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* an empty or broken body */ }
    const model = body.model;
    const schemaName = anthropic ? body.tool_choice?.name : body.response_format?.json_schema?.name;
    last = { path: req.url, headers: req.headers, body };
    calls.push({ path: req.url, model });

    switch (model) {
      case 'bad-json':
        return notJson(res, anthropic, model);
      case 'invalid':
        return validAnswer(res, anthropic, model, schemaName, { ok: 'yes' });
      case 'fail500':
        return json(res, 500, { error: { message: 'INTERNAL-SECRET-BODY' } });
      case 'unsupported':
        return json(res, 400, { error: { message: 'response_format json_schema is not supported by this server' } });
      case 'redirect':
        res.writeHead(302, { location: 'http://127.0.0.1:8098/v1/chat/completions' });
        return res.end();
      case 'huge': {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"pad":"');
        const chunk = 'a'.repeat(65536);
        for (let i = 0; i < 40; i++) res.write(chunk);
        return res.end('"}');
      }
      case 'slow':
        return void setTimeout(() => validAnswer(res, anthropic, model, schemaName, cannedOutput(schemaName, model)), 20000);
      case 'slow-after-review':
        if (schemaName === 'requirement_review') return validAnswer(res, anthropic, model, schemaName, REVIEW);
        return void setTimeout(() => validAnswer(res, anthropic, model, schemaName, cannedOutput(schemaName, model)), 20000);
      case 'flaky':
        if (flakyCalls++ === 0) return notJson(res, anthropic, model);
        return validAnswer(res, anthropic, model, schemaName, cannedOutput(schemaName, model));
      default:
        return validAnswer(res, anthropic, model, schemaName, cannedOutput(schemaName, model));
    }
  });
});
server.listen(8098, '127.0.0.1', () => console.log('READY'));
// A run that was killed without calling /__quit must not leave this behind for good.
setTimeout(() => process.exit(0), 20 * 60 * 1000);
