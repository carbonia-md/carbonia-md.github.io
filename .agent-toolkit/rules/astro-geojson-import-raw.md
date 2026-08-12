---
tier: gotcha
triggers:
  paths:
    - "**/*.geojson"
    - "**/*.topojson"
    - "**/*.ndjson"
  objective:
    - "geojson"
    - "map marker"
  definition_of_done:
    - "geojson"
---
# Astro/Vite: import .geojson (and other non-JSON data extensions) as ?raw + JSON.parse

Vite registers no loader for the `.geojson` extension, so
`import data from '../data/x.geojson'` fails the build. Import the file as raw text and
`JSON.parse` it in frontmatter (build-time), or read it with `node:fs`:

```ts
import raw from '../data/map-markers.geojson?raw';
const data = JSON.parse(raw);
```

Applies to any build-time import of a data file whose extension Vite does not treat as JSON
(`.geojson`, `.topojson`, `.ndjson`, …). A plain `.json` import works and needs no `?raw`.
Renaming to `.json` is NOT an option when a DoD or downstream contract pins the extension
(LB-15's `src/data/map-markers.geojson`). A file consumed at runtime via `fetch()` (e.g.
`public/data/boundary.geojson`) is unaffected — this rule is only about build-time imports.

**Why (LB-15):** `map.template.astro` first tried `import markers from '…/map-markers.geojson'`;
Vite had no loader and the page failed to build. Fixed with `?raw` + `JSON.parse` (PR #16).
