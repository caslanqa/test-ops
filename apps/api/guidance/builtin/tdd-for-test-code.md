---
key: tdd-for-test-code
title: Test-first for automation code
summary: Write the check, watch it fail for the right reason, then make it pass.
kind: AUTOMATION_CODE
steps: [CODEGEN]
priority: 500
version: 1
license: MIT
origin: Adapted from ECC (tdd-workflow), https://github.com/affaan-m/ECC
---
When you write code for a test, or code that a test is written for, work test-first.

1. Write the test for one behaviour. Run it and watch it fail, and check that it fails for the reason you expect (the feature is missing), not for a typo or a broken setup. A test that never failed proves nothing.
2. Write the smallest change that makes it pass. Do not add behaviour the test does not ask for.
3. Run the whole suite, not only the new test, and read the output.
4. Refactor with the tests green, and keep them green.

For a defect, first write a test that reproduces it and fails; then fix it. The test stays as the regression check.

Keep tests honest
- Test behaviour a user or a caller can see, not how the code is built inside. A test that breaks when you rename a private function is a bad test.
- Name a test after the behaviour it checks, so a failure reads as a sentence.
- Make tests deterministic: fixed clocks, seeded data, no dependence on test order or on the network you do not control.
- Mock only what you do not own and cannot run (a payment provider, the clock). Do not mock the thing under test.
- Cover the edges: empty input, the boundaries, the error paths, and a repeated call.
