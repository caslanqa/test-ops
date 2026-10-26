// Chooses the Playwright tests a TestOps dispatch asks for.
//
//   node scripts/pick-from-dispatch.mjs "$GITHUB_EVENT_PATH"
//
// Reads the GitHub event of a testops.run.started dispatch and appends `grep=<pattern>` to the file named by
// GITHUB_OUTPUT (or prints it when that is unset). The pattern matches the @testops-<case id> tag the
// reporter puts on each linked test, for every case in client_payload.automation_case_ids.
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CASE_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

/**
 * The --grep for the cases of a dispatch. Only values shaped like a case ID are used, since the pattern
 * ends up on a command line. With none left it is `(?!)`, which matches nothing: a run without automated
 * cases must not run every test.
 */
export function pickGrep(payload) {
  const ids = Array.isArray(payload?.automation_case_ids)
    ? payload.automation_case_ids.filter((id) => typeof id === 'string' && CASE_ID.test(id))
    : [];
  return ids.length ? `@testops-(${ids.join('|')})(\\s|$)` : '(?!)';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const eventPath = process.argv[2];
  if (!eventPath) {
    console.error('Usage: node scripts/pick-from-dispatch.mjs <GitHub event file>');
    process.exit(1);
  }
  const line = `grep=${pickGrep(JSON.parse(readFileSync(eventPath, 'utf8')).client_payload)}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
  else process.stdout.write(line);
}
