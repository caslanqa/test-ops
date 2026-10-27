---
key: playwright-e2e
title: Playwright end-to-end tests
summary: Stable locators, independent tests, web-first assertions and no sleeps.
kind: AUTOMATION_CODE
steps: [DESIGN, CODEGEN]
priority: 500
version: 1
license: MIT
origin: Adapted from ECC (e2e-testing), https://github.com/affaan-m/ECC
---
When a case will be automated with Playwright, design it so the test comes out stable.

Structure
- One user journey per test file, named after the behaviour. Group files by feature, not by page.
- Put repeated steps (sign in, open a record) in a page object or a fixture, so a change to the page is one edit.
- Each test creates the data it needs and does not depend on another test having run. Tests must be safe to run in parallel.

Locators
- Prefer what a user sees: getByRole with a name, getByLabel, getByText. Use a test id where there is no accessible name. Avoid CSS paths and XPath, which break when the layout changes.

Waiting
- Never wait a fixed time. Use web-first assertions (expect(locator).toBeVisible(), toHaveText), which retry until they hold, and wait for a response or a state, not for a number of seconds.
- Do not wait for "network idle" as a general rule; wait for the thing the next step needs.

Assertions
- Assert what the case's expected result says, one assertion per expected result, with the exact text or state.
- Check the outcome the user sees first; check the API or database only where the case is about it.

Running
- Keep traces on first retry and screenshots on failure. Retry only in CI. Give a flaky test a ticket and move it out of the blocking suite; do not hide it with longer timeouts.
