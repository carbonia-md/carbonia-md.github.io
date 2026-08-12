---
tier: gotcha
triggers:
  paths:
    - ".github/workflows/**"
  objective:
    - "github actions"
    - "workflow"
  definition_of_done:
    - "permissions"
    - "least privilege"
---
# GitHub Actions: least-privilege permissions

Any workflow that runs pull-request code (checkout + `npm ci`/build/test on `pull_request`
executes untrusted postinstall and build scripts) must set top-level
`permissions: contents: read` and grant write scopes (`pages: write`, `id-token: write`,
`packages: write`, …) only on the specific job that needs them. Per-job `permissions:`
replace the top-level block, so a job without a scope cannot use it.

**Why:** LB-2's first `deploy.yml` put `pages: write` + `id-token: write` at the top level,
handing them to the `genericity`/`build` jobs that run PR-authored code (review S1, PR #2).
Fixed in 9d5357f by moving the write scopes to the `deploy` job only.
