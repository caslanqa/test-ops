'use strict';

// CommonJS entry of @testops/reporter, for projects and Node versions that cannot require() an ES
// module (Node before 20.19 and 22.12, or a linked workspace package that Playwright compiles itself).
// The code lives in the ES modules; this file loads it with import(), which every Node version allows
// from CommonJS. Only testops() has to work synchronously, so it is shared as CommonJS.

const { testops } = require('./annotation.cjs');

/** The Playwright reporter: forwards to the ES module reporter, which it loads on first use. */
class TestOpsReporter {
  constructor(options = {}) {
    this.options = options;
    this.ready = undefined;
  }

  printsToStdio() {
    return false;
  }

  onBegin(config, suite) {
    // Playwright may not wait for onBegin; onEnd waits for this instead.
    this.ready = import('./reporter.js').then(({ default: Reporter }) => {
      const reporter = new Reporter(this.options);
      reporter.onBegin(config, suite);
      return reporter;
    });
    // A failure surfaces in onEnd; this keeps it from being reported as unhandled before that.
    this.ready.catch(() => {});
  }

  async onEnd(result) {
    return (await this.ready)?.onEnd(result);
  }
}

/** Syncs titles and automation status of annotated tests to their TestOps cases. */
async function syncTestCases(...args) {
  return (await import('./core.js')).syncTestCases(...args);
}

Object.defineProperty(exports, '__esModule', { value: true });
exports.default = TestOpsReporter;
exports.testops = testops;
exports.syncTestCases = syncTestCases;
