---
tier: gotcha
triggers:
  paths:
    - "package.json"
    - "package-lock.json"
  objective:
    - "dependency"
    - "lockfile"
  definition_of_done:
    - "lockfile"
    - "npm ci"
---
# Lockfile cross-platform validation

After changing dependencies, verify the lockfile is CI-valid before pushing:
`rm -rf node_modules && npm ci` must succeed. If it fails, or the change touches
a package with platform-conditional native bindings (@rolldown/*, esbuild, swc,
sharp, anything pulling @emnapi/*), regenerate from scratch:
`rm -rf node_modules package-lock.json && npm install`, then re-run `npm ci`.
Never regenerate the lockfile as a routine step for unrelated dep changes - full
regeneration re-resolves every transitive version and churns the diff.
Keep local npm major version matched to CI (node/npm divergence produces exactly
these hoisting mismatches).

**Caveat:** local `npm ci` on macOS validates lockfile-manifest sync but cannot fully
reproduce Linux hoisting behavior; this check narrows the window rather than closing it.
The regenerate-on-native-bindings trigger covers the LB-5 class of failure.

**Why (LB-5):** `npm install` on macOS nested `@emnapi/core` and `@emnapi/runtime` under
`@rolldown/binding-wasm32-wasi/node_modules/`; CI (ubuntu) resolved them as top-level
optional deps and rejected the lockfile with `npm ci`. Cost: 2 CI failure cycles (commits
039e8a0, ba503ef) before a clean regeneration (`rm -rf node_modules package-lock.json &&
npm install`) fixed it in f61811c.
