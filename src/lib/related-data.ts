/**
 * related-data.ts — read a language's prebuilt related-articles map.
 *
 * Prebuilt per language by scripts/core/build-related-tagoverlap.mjs:
 * { "cat/slug": ["cat/slug", ...] }. A language with no related-data file
 * yet (e.g. `it` before M5 lands the per-lang build) degrades to no related
 * links rather than failing the build.
 *
 * Lives in its own module rather than inline in a page's frontmatter:
 * `getStaticPaths` runs in an isolated scope and can only reference file
 * imports, not sibling top-level declarations in the same frontmatter script
 * — a helper defined alongside it there gets silently dropped from the
 * prerender bundle.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadRelatedData(lang: string): Record<string, string[]> {
  const path = resolve(process.cwd(), 'src/data/related', `${lang}.json`);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf-8'));
}
