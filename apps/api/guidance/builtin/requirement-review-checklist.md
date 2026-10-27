---
key: requirement-review-checklist
title: Requirement review checklist
summary: What to look for when reading a requirement before cases are written.
kind: CASE_CONTENT
steps: [REVIEW]
priority: 500
version: 1
license: MIT
origin: TestOps
---
When you review a requirement, look for these and report what you find as findings.

- Ambiguity: words such as "fast", "easy", "appropriate" or "etc." with no measure. Ask for the number or the list.
- Testability: an acceptance criterion that no one could check from outside the system. Say how it could be made checkable.
- Missing paths: what happens on an error, on empty input, on a repeated action, on a slow or failed dependency, for a user without permission.
- Roles and states: who may do this, and in which states of the record it is allowed or refused.
- Limits: sizes, counts, lengths, rates and time limits, and what happens at and beyond them.
- Data: where values come from, their formats, and what is kept or deleted afterwards.
- Contradictions: with another criterion in the same requirement, or with behaviour the product already has.
- Out of scope: what the requirement does not say but a reader might assume.

Each acceptance criterion you list must be one a case could check. Do not invent criteria the text does not support; put a doubt in the findings instead.
