'use strict';

// CommonJS entry of @testops/reporter/core: the two functions an adapter calls, loaded from the ES
// module with import(). createReporterClient stays ES-only because it returns synchronously.

/** Uploads framework-neutral results using the TestOps v1 REST contract. */
async function reportResults(...args) {
  return (await import('./core.js')).reportResults(...args);
}

/** Syncs titles and automation status of annotated tests to their TestOps cases. */
async function syncTestCases(...args) {
  return (await import('./core.js')).syncTestCases(...args);
}

module.exports = { reportResults, syncTestCases };
