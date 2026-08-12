---
tier: gotcha
triggers:
  paths:
    - "scripts/core/build-*.mjs"
  objective:
    - "prebuild"
    - "run-p"
    - "parallel prebuild"
  definition_of_done:
    - "prebuild"
---
# Parallel prebuild scripts must not clean sibling output

Scripts that run concurrently in the `run-p` prebuild group (package.json) must only
create/overwrite their OWN output files. Never `rm -rf` or empty a shared parent
directory (e.g. `public/kb/`) — a sibling script writes there concurrently and the
delete races with its writes. Each script cleans only its own subtree (e.g.
`public/kb/articles/` not `public/kb/`).

**Why (LB-9):** `build-kb-index.mjs` initially did `rm -rf public/kb` for idempotency,
which deleted the search indexes `build-search-index.mjs` had just written in the same
`run-p` group. The DoD evidence pass caught search indexes missing from `dist/`; cost: one
investigation + rewrite cycle during execution (no CI failure because the evidence pass ran
before push). Fixed by scoping the rm to `public/kb/articles/` only.
