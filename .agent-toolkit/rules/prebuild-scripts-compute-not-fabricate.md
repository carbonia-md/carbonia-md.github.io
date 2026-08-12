---
tier: gotcha
triggers:
  paths:
    - "scripts/core/build-*.mjs"
  objective:
    - "prebuild"
    - "dashboard"
  definition_of_done:
    - "prebuild"
    - "computed from real"
---
# Prebuild scripts have full repo access: compute, never fabricate

Prebuild scripts (`scripts/core/build-*.mjs`) run in the repo root with full filesystem and
git access. Other prebuild scripts already shell to `git log`, read `knowledge/` frontmatter,
walk `scripts/tools/lib/`, etc. A prebuild script that substitutes hardcoded constants for
values that can be computed from the repo is fabricating data.

A comment like "no git/filesystem access at prebuild time" justifying a constant is always
factually wrong and is a review **blocker** (same class as dead fork code: it ships
fabricated numbers as measured health).

**Why (LB-22):** `build-dashboard-lite.mjs` initially hardcoded 5 of 6 immune dimensions
(review_coverage 50, plugin_health 80, citation_density 50, tool_freshness 60,
drift_velocity 90) while claiming prebuild had no fs/git access. The immune score was
arithmetically pinned to [41, 88] regardless of editorial state. Review B1 blocker; fixed by
computing all dimensions from real data (git log, frontmatter, article bodies).
