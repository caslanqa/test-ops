import { writeFileSync } from 'node:fs';

function testCaseId(test) {
  return test.annotations?.find((item) => item.type === 'testops')?.description;
}

/** Playwright discovery reporter used by `testops-sync`; it does not execute tests or contact the API. */
export default class TestOpsSyncReporter {
  printsToStdio() {
    return false;
  }

  onBegin(_config, suite) {
    const output = process.env.TESTOPS_SYNC_OUTPUT;
    if (!output) throw new Error('testops-sync did not provide its discovery output path.');
    const tests = suite.allTests().map((test) => ({
      testCaseId: testCaseId(test),
      title: test.title,
    }));
    writeFileSync(output, JSON.stringify(tests), 'utf8');
  }
}
