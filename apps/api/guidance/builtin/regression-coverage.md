---
key: regression-coverage
title: Regression coverage after a defect
summary: Cover the neighbours of a change and every path that serves the same feature.
kind: CASE_CONTENT
steps: [DESIGN, AUDIT]
priority: 500
version: 1
license: MIT
origin: Adapted from ECC (ai-regression-testing), https://github.com/affaan-m/ECC
---
Regressions hide where a feature has more than one path. When you design or audit cases, look for them.

- After a defect, there is a case that reproduces it, named after the behaviour that was wrong. If the requirement mentions a past defect, check that such a case exists.
- List every path that serves the same feature and make sure each is covered: the interface and the API, the production path and a sandbox or mock path, behaviour behind a feature flag and without it, and each user role that can reach it.
- A fix usually touches one path. The second and third path to the same result are where it breaks again, so a case for the main path is not enough.
- Check what the client reads, not only that the call succeeded: every field the screen or the caller depends on is present and has the right value.
- For changed behaviour, add cases for its neighbours: the features that use the same data, the same permission, or the same setting.
- Include the negative regression: what must still be refused or unchanged after the change.
- In an audit, say which of these paths no case covers, instead of reporting coverage because one case touches the feature.
