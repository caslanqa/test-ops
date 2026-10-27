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
//   many                     thirty cases in the design, five more than the app keeps
//   revise                   the first coverage audit (since the last reset) asks for a revision
//   dup                      the coverage audit says draft 0 repeats the first existing case it was given
//   fenced, prefixed, think, double   a valid answer wrapped in a code fence / after a sentence / after a <think> block / encoded twice
//   array                    the answer is a JSON array, not an object
// How the request asks for the answer decides what these models do (the mode is what the request carries: tools,
// response_format json_schema, response_format json_object, or nothing):
//   tools-only               a valid answer only through a tool call; prose otherwise
//   json-object-only         a valid answer only with response_format json_object; prose otherwise
//   no-tools                 HTTP 400 "tools are not supported" for a tool call; valid with json_object; prose otherwise
//   prompt-only              a valid answer only when the request carries neither tools nor response_format
//   repairs                  prose, until the user message says the previous answer "was rejected"; then valid
//   slow-after-review        the requirement review is instant, every later call answers after 20 s
// Control: GET /__last (the last request: path, headers, body), GET /__calls (every request: path, model, mode,
// and the system prompt of an OpenAI-compatible one),
// POST /__reset, POST /__quit. Start it with `docker compose exec -T app node -` and the file on stdin.
const fs = require('fs');
const http = require('http');

// Delayed answers (slow, slow-after-review) wait 20 s unless this file exists; a test that kills the app and
// restarts it creates it, so the resumed run doesn't have to wait again.
const FAST_FILE = '/tmp/fake-ai-fast';
const delay = () => (fs.existsSync(FAST_FILE) ? 0 : 20000);
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
// Thirty cases, five more than the app keeps: what a model that doesn't count sends.
const MANY = { cases: Array.from({ length: 30 }, (_, i) => ({ ...DESIGN.cases[i % 2], title: `Case number ${i + 1}` })) };
const audit = (revisionNeeded, duplicates = []) => ({
  coverage: [{ criterion: 0, caseIndexes: [0] }, { criterion: 1, caseIndexes: [1] }],
  uncovered: [],
  duplicates,
  revisionNeeded,
  notes: revisionNeeded ? 'Add a boundary case for exactly one hour' : 'Both criteria are covered',
});
function cannedOutput(schemaName, model, userText = '') {
  switch (schemaName) {
    case 'connection_test': return { ok: true };
    case 'requirement_review': return REVIEW;
    case 'test_design': return model === 'many' ? MANY : DESIGN;
    case 'coverage_audit': {
      if (model === 'dup') {
        // The prompt lists the project's existing cases as "<id> | <title>" under this tag; name the first one.
        const listed = userText.split('<existing_cases_of_the_project>\n')[1]?.split('\n')[0]?.split(' | ')[0];
        return audit(false, listed ? [{ caseIndex: 0, existingCaseId: listed, reason: 'Same steps as the existing case' }] : []);
      }
      return audit(model === 'revise' && audits++ === 0);
    }
    default: return {};
  }
}

function validAnswer(res, anthropic, model, schemaName, output, mode = 'JSON_SCHEMA') {
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
          choices: [
            {
              index: 0,
              message:
                mode === 'TOOL_CALL'
                  ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_fake', type: 'function', function: { name: schemaName, arguments: JSON.stringify(output) } }] }
                  : { role: 'assistant', content: JSON.stringify(output) },
              finish_reason: mode === 'TOOL_CALL' ? 'tool_calls' : 'stop',
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        },
  );
}
/** Prose where the JSON should be: what a model says when it can't or won't keep to the format. */
function prose(res, anthropic, model) {
  const text = 'Sure! I would be happy to help, but I cannot produce JSON for this.';
  json(res, 200, anthropic
    ? { id: 'msg_fake', type: 'message', role: 'assistant', model, content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 11, output_tokens: 4 } }
    : { id: 'chatcmpl-fake', object: 'chat.completion', model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 } });
}
/** The answer as given text, the way models that don't keep to the schema send it. */
function wrapped(res, anthropic, model, schemaName, text) {
  if (anthropic) return validAnswer(res, anthropic, model, schemaName, cannedOutput(schemaName, model));
  json(res, 200, {
    id: 'chatcmpl-fake',
    object: 'chat.completion',
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  });
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
    const mode = body.tools ? 'TOOL_CALL' : body.response_format?.type === 'json_schema' ? 'JSON_SCHEMA' : body.response_format?.type === 'json_object' ? 'JSON_OBJECT' : 'PROMPT';
    // Without a schema in the request (json_object, no format) the role in the system prompt says which answer is meant.
    const systemText = String((body.messages || []).filter((m) => m.role === 'system').map((m) => m.content).join('\n'));
    const inferred = /connection test/.test(systemText) ? 'connection_test' : /requirement reviewer/.test(systemText) ? 'requirement_review' : /coverage auditor/.test(systemText) ? 'coverage_audit' : /test designer/.test(systemText) ? 'test_design' : undefined;
    const schemaName = anthropic ? body.tool_choice?.name : (body.tool_choice?.function?.name ?? body.response_format?.json_schema?.name ?? inferred);
    last = { path: req.url, headers: req.headers, body };
    const userText = String((body.messages || []).filter((m) => m.role === 'user').map((m) => m.content).join('\n'));
    calls.push({ path: req.url, model, mode, system: systemText });

    switch (model) {
      case 'bad-json':
        return notJson(res, anthropic, model);
      case 'fenced':
        return wrapped(res, anthropic, model, schemaName, '```json\n' + JSON.stringify(cannedOutput(schemaName, model, userText), null, 2) + '\n```');
      case 'prefixed':
        return wrapped(res, anthropic, model, schemaName, 'Here is the JSON you asked for:\n' + JSON.stringify(cannedOutput(schemaName, model, userText)) + '\nLet me know if you need anything else.');
      case 'think':
        return wrapped(res, anthropic, model, schemaName, '<think>The user wants {"ok": true}; I will answer in JSON.</think>\n' + JSON.stringify(cannedOutput(schemaName, model, userText)));
      case 'double':
        return wrapped(res, anthropic, model, schemaName, JSON.stringify(JSON.stringify(cannedOutput(schemaName, model, userText))));
      case 'array':
        return wrapped(res, anthropic, model, schemaName, JSON.stringify([cannedOutput(schemaName, model, userText)]));
      case 'tools-only':
        return mode === 'TOOL_CALL' ? validAnswer(res, anthropic, model, schemaName, cannedOutput(schemaName, model, userText), mode) : prose(res, anthropic, model);
      case 'json-object-only':
        return mode === 'JSON_OBJECT' ? validAnswer(res, anthropic, model, schemaName, cannedOutput(schemaName, model, userText), mode) : prose(res, anthropic, model);
      case 'no-tools':
        if (mode === 'TOOL_CALL') return json(res, 400, { error: { message: 'tools are not supported by this server' } });
        return mode === 'JSON_OBJECT' ? validAnswer(res, anthropic, model, schemaName, cannedOutput(schemaName, model, userText), mode) : prose(res, anthropic, model);
      case 'prompt-only':
        return mode === 'PROMPT' ? validAnswer(res, anthropic, model, schemaName, cannedOutput(schemaName, model, userText), mode) : prose(res, anthropic, model);
      case 'repairs':
        return /was rejected/.test(userText) ? validAnswer(res, anthropic, model, schemaName, cannedOutput(schemaName, model, userText), mode) : prose(res, anthropic, model);
      case 'invalid':
        return validAnswer(res, anthropic, model, schemaName, { ok: 'yes' }, mode);
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
        return void setTimeout(() => validAnswer(res, anthropic, model, schemaName, cannedOutput(schemaName, model, userText)), delay());
      case 'slow-after-review':
        if (schemaName === 'requirement_review') return validAnswer(res, anthropic, model, schemaName, REVIEW);
        return void setTimeout(() => validAnswer(res, anthropic, model, schemaName, cannedOutput(schemaName, model, userText)), delay());
      case 'flaky':
        if (flakyCalls++ === 0) return notJson(res, anthropic, model);
        return validAnswer(res, anthropic, model, schemaName, cannedOutput(schemaName, model, userText));
      default:
        return validAnswer(res, anthropic, model, schemaName, cannedOutput(schemaName, model, userText), mode);
    }
  });
});
server.listen(8098, '127.0.0.1', () => console.log('READY'));
// A run that was killed without calling /__quit must not leave this behind for good.
setTimeout(() => process.exit(0), 20 * 60 * 1000);
