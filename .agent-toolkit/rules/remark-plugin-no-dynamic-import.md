---
tier: gotcha
triggers:
  paths:
    - "plugins/**/*.mjs"
    - "**/remark-*.mjs"
    - "**/rehype-*.mjs"
    - "astro.config.ts"
  objective:
    - "remark"
    - "rehype"
    - "wikilink"
  definition_of_done:
    - "remark"
    - "rehype"
---
# Remark/rehype plugins cannot dynamically import project config

Plugins in Astro's remark/rehype pipeline execute inside Vite's module runner, where
dynamic `import('./foo.ts')` of local project files crashes. Pass project-specific data
(categories, languages, config objects) as **plugin options** from `astro.config.ts`,
which CAN import local `.ts` modules at config-evaluation time.

Pattern:
```js
// astro.config.ts — import works here (config-time, not transform-time)
import placeConfig from './place.config';
export default defineConfig({
  markdown: { remarkPlugins: [[myPlugin, { data: placeConfig.whatever }]] },
});

// plugins/my-plugin.mjs — use options, never dynamic import
export default function myPlugin(options = {}) {
  const { data } = options;
}
```

**Why (LB-6):** The remark-wikilinks plugin initially tried
`import('../place.config.ts')` to get category mappings. Vite's module runner
context resolved differently than Node and crashed. Fixed by injecting the
categories as plugin options from astro.config.ts (commit 1c06bac, PR #8).
