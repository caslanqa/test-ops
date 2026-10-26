// Writes TestOps case IDs into Playwright test source, for `testops-sync --link`. It edits only
// the plain shapes it can recognize exactly and reports every other test, so a file is never
// changed in a way the author did not expect.

export const IMPORT_LINE = "import { testops } from '@testops/reporter';";

const REPORTER = '@testops/reporter';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
// Line terminators the way V8 counts them, which is how the line numbers Playwright reports are counted.
const LINE_BREAK = new RegExp(`\\r\\n|[\\n\\r${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}]`, 'g');
const SINGLE_LINE_BREAK = new RegExp(`[\\n\\r${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}]`);
const NOT_A_LINE_BREAK = new RegExp(`[^\\n\\r${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}]`, 'g');
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
const FIRST_IMPORT = /^[ \t]*import(?=[\s{*'"])/m;
const IMPORT_STATEMENT = /\bimport\s+([^;'"]*?)\s*from\s*(['"])([^'"]+)\2/g;
// Sticky patterns, matched at an exact offset.
const MODIFIER_CALL = /(?:only|skip|fixme|fail)\s*\(/y;
const NAMED_CALL = /[A-Za-z_$][\w$]*\s*\(/y;
// The argument after the title must be the test function. A details object or a helper call such as
// demoTestops(...) would make a second details argument, which Playwright does not accept.
const INLINE_FUNCTION = /(?:async\b|function\b|\(|[A-Za-z_$][\w$]*\s*=>)/y;
const SIMPLE_ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v' };
const LINE_CONTINUATIONS = new Set(['\n', LINE_SEPARATOR, PARAGRAPH_SEPARATOR]);

function skipSpace(source, index) {
  let position = index;
  while (position < source.length && /\s/.test(source[position])) position += 1;
  return position;
}

/**
 * The end (exclusive) of the quoted string that starts at `start`, or -1 when it is not closed. A
 * quote or a template literal may continue over lines only in the template form.
 */
function quotedEnd(source, start) {
  const quote = source[start];
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\') index += 1;
    else if (char === quote) return index + 1;
    else if (quote !== '`' && (char === '\n' || char === '\r')) return -1;
  }
  return -1;
}

/**
 * The source with the characters of comments (and a leading byte order mark) replaced by spaces, line
 * breaks kept, so offsets stay valid and a search for imports cannot be fooled by commented-out code.
 * Strings are skipped over, so a comment marker inside one is not taken for a comment. Regular expression
 * literals are not recognized: one holding a quote can hide the rest of its line from the search.
 */
function maskComments(source) {
  const blank = (text) => text.replace(NOT_A_LINE_BREAK, ' ');
  let result = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const pair = source.slice(index, index + 2);
    let end = index + 1;
    if (pair === '//') {
      end = index;
      while (end < source.length && !SINGLE_LINE_BREAK.test(source[end])) end += 1;
      result += blank(source.slice(index, end));
    } else if (pair === '/*') {
      const close = source.indexOf('*/', index + 2);
      end = close === -1 ? source.length : close + 2;
      result += blank(source.slice(index, end));
    } else if (char === "'" || char === '"' || char === '`') {
      const stop = quotedEnd(source, index);
      end = stop === -1 ? index + 1 : stop;
      result += source.slice(index, end);
    } else {
      result += char === BYTE_ORDER_MARK ? ' ' : char;
    }
    index = end;
  }
  return result;
}

/**
 * Where the testops import belongs, and whether the file already has it: `present` when it imports
 * `testops` by name from @testops/reporter, `conflict` when another import already binds that name.
 * Returns null for a file without an import.
 */
function importPlan(masked) {
  const first = FIRST_IMPORT.exec(masked);
  if (!first) return null;
  let present = false;
  let conflict = false;
  for (const [, clause, , specifier] of masked.matchAll(IMPORT_STATEMENT)) {
    const named = (/\{([^}]*)\}/.exec(clause)?.[1] ?? '').split(',').map((entry) => entry.trim());
    if (specifier === REPORTER && named.includes('testops')) present = true;
    else if (/\btestops\b/.test(clause)) conflict = true;
  }
  return { position: first.index + first[0].indexOf('import'), present, conflict };
}

/** The value of a string literal's body, or null when it uses an escape that is not worth resolving. */
function unquote(body) {
  let result = '';
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char !== '\\') {
      result += char;
      continue;
    }
    index += 1;
    const next = body[index];
    if (next === undefined) return null;
    if (Object.hasOwn(SIMPLE_ESCAPES, next)) {
      result += SIMPLE_ESCAPES[next];
    } else if (next === '0' && !/[0-9]/.test(body[index + 1] ?? '')) {
      result += '\0';
    } else if (/[0-9]/.test(next)) {
      return null;
    } else if (next === 'x') {
      const hex = body.slice(index + 1, index + 3);
      if (!/^[0-9a-f]{2}$/i.test(hex)) return null;
      result += String.fromCharCode(parseInt(hex, 16));
      index += 2;
    } else if (next === 'u' && body[index + 1] === '{') {
      const close = body.indexOf('}', index);
      const hex = close === -1 ? '' : body.slice(index + 2, close);
      if (!/^[0-9a-f]+$/i.test(hex) || parseInt(hex, 16) > 0x10ffff) return null;
      result += String.fromCodePoint(parseInt(hex, 16));
      index = close;
    } else if (next === 'u') {
      const hex = body.slice(index + 1, index + 5);
      if (!/^[0-9a-f]{4}$/i.test(hex)) return null;
      result += String.fromCharCode(parseInt(hex, 16));
      index += 4;
    } else if (next === '\r') {
      if (body[index + 1] === '\n') index += 1;
    } else if (!LINE_CONTINUATIONS.has(next)) {
      result += next;
    }
  }
  return result;
}

/**
 * Where `, testops('<id>')` goes for the test at a Playwright location: right after the title. Playwright
 * reports the start of the modifier name in `test.only(...)`, `test.skip(...)`, `test.fixme(...)` and
 * `test.fail(...)`, and for a plain `test(...)` the `(` (measured on Playwright 1.64) or the start of the
 * callee name (measured on 1.63); lines and columns are 1-based. When the discovered `title` is given, the
 * literal has to be that title: a file that changed since discovery, or a location that is off, never puts
 * an ID on another test.
 */
function insertionPoint(source, lineStarts, { line, column, title }) {
  const lineStart = lineStarts[line - 1];
  if (lineStart === undefined) return { reason: 'the location is outside the file' };
  const offset = lineStart + column - 1;

  let argumentsStart = -1;
  if (source[offset] === '(') {
    argumentsStart = offset + 1;
  } else {
    MODIFIER_CALL.lastIndex = offset;
    const modifier = MODIFIER_CALL.exec(source);
    if (modifier) {
      argumentsStart = offset + modifier[0].length;
    } else {
      NAMED_CALL.lastIndex = offset;
      const call = NAMED_CALL.exec(source);
      if (call) argumentsStart = offset + call[0].length;
    }
  }
  if (argumentsStart === -1) return { reason: 'the location is not a test call' };

  const titleStart = skipSpace(source, argumentsStart);
  const quote = source[titleStart];
  const titleEnd = quote === "'" || quote === '"' ? quotedEnd(source, titleStart) : -1;
  if (titleEnd === -1) return { reason: 'the title is not a plain string literal' };

  if (title !== undefined) {
    const literal = unquote(source.slice(titleStart + 1, titleEnd - 1));
    if (literal === null) return { reason: 'the title uses an escape that cannot be checked against the discovered title' };
    if (literal !== title) {
      return { reason: `the title there is ${JSON.stringify(literal)}, not ${JSON.stringify(title)}; the file may have changed since the tests were listed` };
    }
  }

  const comma = skipSpace(source, titleEnd);
  const next = skipSpace(source, comma + 1);
  INLINE_FUNCTION.lastIndex = next;
  if (source[comma] !== ',' || !INLINE_FUNCTION.test(source)) {
    return { reason: 'the second argument is not an inline test function (a details object or a helper call); add testops() by hand' };
  }
  return { position: titleEnd };
}

/**
 * Adds `testops('<id>')` to the tests at the given locations and the import when the file has none.
 * Tests that do not fit the plain shapes are returned in `skipped`, with their line and the reason.
 * When nothing can be linked the returned source is the input.
 */
export function linkTestsInSource(source, links) {
  const skipped = [];
  const skipAll = (reason) => {
    for (const link of links) skipped.push({ line: link.line, reason });
    return { source, linked: 0, skipped };
  };

  const plan = importPlan(maskComments(source));
  if (!plan) return skipAll('the file has no top-level import to put the testops import next to');
  if (plan.conflict) return skipAll('the file already uses the name testops for another import; add testops() by hand');

  const lineStarts = [0];
  for (const match of source.matchAll(LINE_BREAK)) lineStarts.push(match.index + match[0].length);

  const edits = [];
  for (const link of links) {
    if (!UUID.test(link.testCaseId)) {
      skipped.push({ line: link.line, reason: 'the case ID is not a UUID' });
      continue;
    }
    const found = insertionPoint(source, lineStarts, link);
    if (found.reason) skipped.push({ line: link.line, reason: found.reason });
    else edits.push({ position: found.position, text: `, testops('${link.testCaseId}')` });
  }
  if (edits.length === 0) return { source, linked: 0, skipped };

  const linked = edits.length;
  if (!plan.present) {
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    edits.push({ position: plan.position, text: `${IMPORT_LINE}${eol}` });
  }
  // From the bottom up, so an insertion never moves a position that is still to be used.
  edits.sort((a, b) => b.position - a.position);
  let result = source;
  for (const edit of edits) result = result.slice(0, edit.position) + edit.text + result.slice(edit.position);
  return { source: result, linked, skipped };
}
