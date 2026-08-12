---
tier: gotcha
triggers:
  objective:
    - "build-time json"
    - "graceful degradation"
    - "optional json"
  definition_of_done:
    - "graceful degradation"
    - "json absent"
---
# Optional build-time JSON: use readFileSync, not import()

When an Astro template needs to consume a JSON file that may be absent at build time
(graceful degradation), use `readFileSync` + `try/catch` in the frontmatter:

```astro
---
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let data = null;
try {
  const raw = readFileSync(resolve(process.cwd(), 'src/data/foo.json'), 'utf8');
  data = JSON.parse(raw);
} catch {
  // file absent at build time — render fallback
}
---
```

Do NOT use `await import('../data/foo.json')`. Rollup resolves literal import specifiers at
build time. If the file is absent, the build fails with `Could not resolve` before any catch
handler runs. The try/catch around a dynamic import of a missing file is dead code.

This extends the `astro-geojson-import-raw` rule (which covers non-JSON extensions that Vite
lacks a loader for) to the case where the file's *existence* is optional.

**Why (LB-22):** `dashboard.template.astro` initially used `await import('../data/dashboard-lite.json')`
in a try/catch for graceful degradation. The catch never fired; absent JSON crashed the build
with a Rollup resolution error. DoD-2 ("build stays green when JSON absent") was unmet until
the fix switched to readFileSync.
