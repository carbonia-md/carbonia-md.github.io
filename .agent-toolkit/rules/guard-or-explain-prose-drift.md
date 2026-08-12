---
tier: doctrine
---

# Correcting prose that drifted from code: guard it or explain why not

When a task's Objective is "a document says something about the code that is no longer
true", fixing the sentence is half the work. The DoD must also carry one of:

- **(a) a machine guard** that derives the documented value from the source and fails CI
  when they disagree, in this repository's idiom (a node script that asserts the contract
  and `process.exit(1)`, wired into an npm gate the `test` job runs); or
- **(b) an explicit justification** for why a guard is infeasible or already exists,
  naming the guard and the path it covers.

Applies to any statement derived from code: gate scan roots, script names, flag defaults,
schema field lists, released versions, directory layouts. This repository is a template,
so a stale statement propagates to every adopter on the next tag merge, and an adopter
has no way to tell a wrong claim from a right one without reading the source it describes.
A reviewer treats a drift-correction PR carrying neither (a) nor (b) as an incomplete DoD,
not a nit.

The guard belongs beside the source it derives from, never in a file an adopter is
expected to edit. A guard over adopter-owned prose lives in the adopter's own tree.

**Why:** three tasks in one milestone fixed the same defect class, prose stating gate
scan-root scope that had drifted from the `SCAN_ROOTS` arrays. Only one shipped a guard
(`scripts/ci/check-scan-root-docs.mjs`), and that one made its slice of the class
non-recurring at zero marginal cost; the other two paid the fix cost without buying the
immunity. Days later the same class reappeared in a version statement. Fixing drift N
times before someone ships the guard is the failure mode this rule exists to stop.
