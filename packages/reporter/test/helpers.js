import assert from 'node:assert/strict';
import { createReporterClient } from '../core.js';

export const API_BASE = 'https://t.example/api/v1';

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
    if (init.body instanceof FormData) {
      // Uploads are streamed from disk, and the files may be gone when a test looks at the request.
      call.form = new FormData();
      for (const [field, file] of init.body) {
        call.form.append(field, new File([await file.arrayBuffer()], file.name, { type: file.type }));
      }
    } else if (typeof init.body === 'string') call.body = JSON.parse(init.body);
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

/**
 * A Playwright TestCase stand-in with only what the reporter reads. `results` lists the attempts in
 * order; the reporter must use the last one.
 */
export function fakeTest({ id, title = id, testCaseId, expectedStatus = 'passed', results }) {
  return {
    id,
    title,
    titlePath: () => ['', 'chromium', 'shop.spec.ts', title],
    annotations: testCaseId ? [{ type: 'testops', description: testCaseId }] : [],
    expectedStatus,
    results: results.map((result) => ({
      status: result.status,
      duration: result.duration ?? 5,
      startTime: new Date('2026-10-23T10:00:00.000Z'),
      steps: result.steps ?? [],
      attachments: result.attachments ?? [],
      stdout: result.stdout ?? [],
      stderr: result.stderr ?? [],
      errors: result.errors ?? [],
      annotations: [],
    })),
  };
}

/** A Playwright Suite stand-in. */
export function fakeSuite(tests) {
  return { allTests: () => tests };
}

/**
 * Playwright's 1-based line and column for a test, as reported in test.location: the `(` of
 * `test(...)`, or the start of the modifier name in `test.only(...)`. `text` starts at that point.
 */
export function locationOf(source, text) {
  const index = source.indexOf(text);
  assert.notEqual(index, -1, `${text} is not in the source`);
  const before = source.slice(0, index);
  return { line: before.split('\n').length, column: index - (before.lastIndexOf('\n') + 1) + 1 };
}
