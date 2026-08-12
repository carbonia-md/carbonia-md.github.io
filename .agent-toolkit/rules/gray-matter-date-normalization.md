---
tier: gotcha
triggers:
  paths:
    - "scripts/core/build-*.mjs"
  objective:
    - "gray-matter"
    - "frontmatter date"
  definition_of_done:
    - "gray-matter"
    - "date normalization"
---
# gray-matter dates must be normalized to ISO strings immediately

`gray-matter` silently coerces unquoted YAML `date:` values (e.g. `date: 2026-06-19`) to
JavaScript `Date` objects. `String(date)` on these produces a non-ISO, locale-dependent
form like `"Thu Jun 19 2026 00:00:00 GMT-0700"` that breaks lexicographic sort, substring
operations like `.slice(0, 10)`, and any consumer expecting ISO-8601.

Every script that reads `matter(raw).data.date` must normalize immediately:

```js
const date = fm.date instanceof Date ? fm.date.toISOString() : fm.date ? String(fm.date) : null;
```

**Why (LB-9):** `build-latest.mjs` passed `String(fm.date)` as the fallback date. The
reviewer (S1) identified that this breaks the newest-first sort AND `latest.template`'s
`date.slice(0,10)` day-grouping — latent at 3 fixtures (all carry ISO git dates) but would
fire the moment an article's every commit is cosmetic-filtered. Same class of bug hit
`build-kb-index.mjs` (caught in the evidence pass); both fixed in the same session. The
pattern recurs because gray-matter's coercion is silent and `String()` looks plausible.
