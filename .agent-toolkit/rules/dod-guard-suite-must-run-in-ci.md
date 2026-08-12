---
tier: doctrine
---

# A test suite cited as a DoD guard counts only if CI runs it

When a packet or DoD names a test suite as the regression guard ("the next doc move fails
`npm run article-health:test`"), part of the task is verifying that suite actually runs in
CI — and wiring it in if not. A local-only suite is not a guard: nothing forces the next
session to run it, so the regression ships anyway. Check the CI workflow for the exact
script name before claiming the guard exists; a green local run is not evidence of a gate.

**Why (LB-34):** the article-health pytest suite existed but `deploy.yml` never ran it.
LB-28's `canonical_doc` re-point therefore left `test_config` silently red on `main` —
exactly the rot the suite was supposed to prevent. LB-34 discovered this while adding its
own gate and wired `npm run article-health:test` into the CI Test job (sekai-kb PR #4);
the DoD-3 root-cause guard was only real after that wiring.
