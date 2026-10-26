// Writes TestOps case IDs into Playwright test source, for `testops-sync --link`. It edits only
// the plain shapes it can recognize exactly and reports every other test, so a file is never
// changed in a way the author did not expect.

export const IMPORT_LINE = "import { testops } from '@testops/reporter';";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TESTOPS_IMPORT = /import\s*\{[^}]*\btestops\b[^}]*\}\s*from\s*['"]@testops\/reporter['"]/;
const FIRST_IMPORT = /^import\s/m;
// Sticky patterns, matched at an exact offset.
const MODIFIER_CALL = /(?:only|skip|fixme|fail)\s*\(/y;
// The argument after the title must be the test function. A details object or a helper call such as
// demoTestops(...) would make a second details argument, which Playwright does not accept.
const INLINE_FUNCTION = /(?:async\b|function\b|\(|[A-Za-z_$][\w$]*\s*=>)/y;

function skipSpace(source, index) {
  let position = index;
  while (position < source.length && /\s/.test(source[position])) position += 1;
  return position;
}

/** The end (exclusive) of the quoted string literal that starts at `start`, or -1 when none does. */
function stringEnd(source, start) {
  const quote = source[start];
  if (quote !== "'" && quote !== '"') return -1;
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\') index += 1;
    else if (char === quote) return index + 1;
    else if (char === '\n') return -1;
  }
  return -1;
}

/**
 * Where `, testops('<id>')` goes for the test at a Playwright location: right after the title. Playwright
 * reports the `(` of `test(...)`, or the start of the modifier name in `test.only(...)`, `test.skip(...)`,
 * `test.fixme(...)` and `test.fail(...)` (1-based line and column, measured on Playwright 1.64).
 */
function insertionPoint(source, lineStarts, { line, column }) {
  const lineStart = lineStarts[line - 1];
  if (lineStart === undefined) return { reason: 'the location is outside the file' };
  const offset = lineStart + column - 1;

  let argumentsStart = -1;
  if (source[offset] === '(') {
    argumentsStart = offset + 1;
  } else {
    MODIFIER_CALL.lastIndex = offset;
    const modifier = MODIFIER_CALL.exec(source);
    if (modifier) argumentsStart = offset + modifier[0].length;
  }
  if (argumentsStart === -1) return { reason: 'the location is not a test call' };

  const titleStart = skipSpace(source, argumentsStart);
  const titleEnd = stringEnd(source, titleStart);
  if (titleEnd === -1) return { reason: 'the title is not a plain string literal' };

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
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') lineStarts.push(index + 1);
  }
  const firstImport = FIRST_IMPORT.exec(source);
  const skipped = [];
  if (!firstImport) {
    for (const link of links) {
      skipped.push({ line: link.line, reason: 'the file has no top-level import to put the testops import next to' });
    }
    return { source, linked: 0, skipped };
  }

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
  if (!TESTOPS_IMPORT.test(source)) {
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    edits.push({ position: firstImport.index, text: `${IMPORT_LINE}${eol}` });
  }
  // From the bottom up, so an insertion never moves a position that is still to be used.
  edits.sort((a, b) => b.position - a.position);
  let result = source;
  for (const edit of edits) result = result.slice(0, edit.position) + edit.text + result.slice(edit.position);
  return { source: result, linked, skipped };
}
