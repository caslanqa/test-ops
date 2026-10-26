'use strict';

// The one implementation of testops(). It is CommonJS so that the ES module entry (index.js) and the
// CommonJS entry (index.cjs) can both load it synchronously: a test file calls it while it loads.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Links a Playwright test to a TestOps case; the returned details go in the test's second argument. */
function testops(testCaseId, defectTitle) {
  const id = typeof testCaseId === 'string' ? testCaseId.trim() : '';
  if (!id) return { annotation: [] };
  if (!UUID.test(id)) {
    throw new TypeError('A TestOps test ID must be a UUID copied from the test case details.');
  }
  return {
    tag: `@testops-${id}`,
    annotation: [
      { type: 'testops', description: id },
      ...(defectTitle ? [{ type: 'testops-defect', description: defectTitle }] : []),
    ],
  };
}

module.exports = { testops };
