---
key: browser-qa-checks
title: Browser checks for a web page
summary: A smoke, interaction, visual and accessibility pass, run safely.
kind: AUTOMATION_CODE
steps: [DESIGN, CODEGEN]
priority: 500
version: 1
license: MIT
origin: Adapted from ECC (browser-qa), https://github.com/affaan-m/ECC
---
For a web page, cover these four layers, in this order.

Smoke
- The page loads, there are no errors in the browser console (leave out third-party noise), and no request answers 4xx or 5xx that should not.

Interaction
- Every navigation link leads somewhere. Each form accepts valid data and shows a success state, and refuses invalid data with an error that says what is wrong.
- The sign-in flow works: sign in, reach a protected page, sign out.

Visual
- Check at three widths (about 375, 768 and 1440 pixels): nothing overflows the screen sideways, nothing is cut off, and dark mode is readable if the product has one. Without a stored baseline, report the visual check as inconclusive, never as a pass.

Accessibility
- Run an automated scan, and also use the keyboard: every control can be reached and used, focus is visible and in a sensible order, and dialogs trap and return focus. An automated scan finds only part of the problems, so a clean scan is necessary, not sufficient.

Safety
- Run read-only by default. Do not run a journey that changes data (checkout, delete, bulk edit) against production; do it on a staging copy, on purpose, with test accounts. Never use real credentials, and leave tokens and personal data out of screenshots and logs.
