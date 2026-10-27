---
key: case-design-principles
title: Test case design principles
summary: One behaviour per case, positive, negative and boundary cases, steps in the user's words, checkable expected results.
kind: CASE_CONTENT
steps: [REVIEW, DESIGN, AUDIT]
priority: 600
version: 1
license: MIT
origin: TestOps
---
Design test cases like this.

- One behaviour per case. If a title needs "and", split the case.
- Cover the positive path first. Then the negative paths (invalid input, missing permission, a dependency that fails) and the boundaries (empty, one, the maximum, one past the maximum).
- Write steps in the user's words: what they do and what they see, not how the code works. One action per step.
- Every expected result can be checked by someone who has not seen the code: a message that appears, a value that changes, a status, a record that exists. "Works correctly" is not an expected result.
- Do not repeat an existing case. If two cases differ only in their data and the behaviour is the same, keep one and say which kinds of data it stands for.
- Rank by risk. Payments, permissions, data loss and what users do every day are high priority; cosmetic variations are low.
- Name the preconditions (the account type, the data that must exist) so the case can be run without guessing.
- If something cannot be covered from what the requirement says, say what is missing instead of padding the list with weak cases.
