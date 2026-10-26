import { createReporterClient } from '../core.js';

const API_BASE = 'https://t.example/api/v1';

/**
 * A fetch stand-in for the reporter client. Route keys are "METHOD /path" relative to the API base
 * (query string included). A handler's plain return value answers 200 with that JSON; a value of the
 * form { status, body? } answers with that status. A request without a route throws.
 */
export function fakeFetch(routes) {
  const calls = [];
  async function fetch(url, init = {}) {
    const path = String(url).slice(API_BASE.length);
    const method = init.method ?? 'GET';
    const call = { method, path };
    if (init.body instanceof FormData) call.form = init.body;
    else if (typeof init.body === 'string') call.body = JSON.parse(init.body);
    calls.push(call);

    const handler = routes[`${method} ${path}`];
    if (!handler) throw new Error(`fakeFetch: no route for ${method} ${path}`);
    const answer = await handler(call);
    if (answer && typeof answer === 'object' && typeof answer.status === 'number') {
      return new Response(answer.body === undefined ? '' : JSON.stringify(answer.body), { status: answer.status });
    }
    return new Response(answer === undefined ? '' : JSON.stringify(answer), { status: 200 });
  }
  return { fetch, calls };
}

/** Captures console.log and console.warn until restore() is called. */
export function captureConsole() {
  const logs = [];
  const warnings = [];
  const original = { log: console.log, warn: console.warn };
  console.log = (...args) => logs.push(args.join(' '));
  console.warn = (...args) => warnings.push(args.join(' '));
  return {
    logs,
    warnings,
    restore() {
      console.log = original.log;
      console.warn = original.warn;
    },
  };
}

/** A reporter client wired to a fake fetch, with an empty environment so tests never read process.env. */
export function testClient(fetch, overrides = {}) {
  return createReporterClient(
    { apiUrl: API_BASE, token: 't', projectId: 'p', ...overrides },
    {},
    fetch,
  );
}
