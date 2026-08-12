---
tier: gotcha
triggers:
  paths:
    - "src/pages/**/*.astro"
  objective:
    - "getstaticpaths"
    - "static path"
    - "dynamic route"
  definition_of_done:
    - "getstaticpaths"
---
# Astro getStaticPaths: helper functions must be inlined or exported

Non-exported helper functions defined in .astro frontmatter are tree-shaken from the
prerender bundle by Astro's Vite build, even when defined before getStaticPaths in the
same scope. At runtime in the prerender chunk, calls to these functions throw
"X is not defined".

Either inline the logic directly inside getStaticPaths, or export the helper function.

**Why (LB-8):** A `computeTopPicks` function defined in frontmatter before
`getStaticPaths` was stripped from the compiled prerender chunk, causing a build-time
runtime error. Fixed by inlining the logic.
