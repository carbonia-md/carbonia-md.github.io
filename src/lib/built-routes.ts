/**
 * built-routes.ts — the routes an `astro build` of this instance produces.
 *
 * Two pages validate a `knowledge/` manifest's declared `article` link against the
 * built route set before rendering it: `/soundscape` (a category's `article`) and
 * `/chat` (a context's `article`). Both need the same answer, and the answer is a
 * restatement of what `src/pages/[category]/[slug].astro`'s `getStaticPaths` filter
 * does — so it lives in one place rather than being derived twice and drifting the
 * first time the route rules change.
 *
 * The collection is passed in rather than fetched here: `getCollection` is an
 * `astro:content` import that only resolves inside the Astro build, and keeping it
 * out means this module is readable — and testable — as plain Node.
 *
 * This file lives under src/, which both machine gates scan: its source is pure
 * ASCII and carries no place-specific string.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { PlaceConfig } from '../../place.config';

/** The one field of a content-collection entry this needs: `<category>/<name>.md`. */
export interface CollectionEntryId {
  id: string;
}

/** Content root. `src/content/` is a derived projection of it, written by sync. */
const KNOWLEDGE_DIR = 'knowledge';

/**
 * The same collection entries `getCollection('en')` yields, discovered from
 * `knowledge/` on disk instead of through `astro:content`.
 *
 * A plain Node caller -- `npm run qr:sheet` -- needs the built route set too, and it
 * has no Astro module runner to ask. Deriving it from `knowledge/` rather than from a
 * build artifact means the answer is available BEFORE anything is built and cannot go
 * stale against it: `knowledge/` is the single source of truth (iron rule 1) and
 * `src/content/` is a copy of it that sync writes.
 *
 * This mirrors ONE rule from `scripts/core/sync.sh`, and mirrors it exactly: the
 * default language projects `knowledge/{category.title}/` to
 * `src/content/en/{category.slug}/`. The directory is the category's TITLE and the
 * collection id carries its SLUG, so a scan that treated the directory name as the id
 * would miss every article whose category is titled differently from its slug -- which
 * is every category with a capital letter in its name.
 *
 * A leading `_` marks a manifest rather than an article, the same filter the three
 * scanners that walk `knowledge/` apply. Never throws: an absent or unreadable
 * `knowledge/` yields no entries, and the caller decides what that means.
 */
export function knowledgeCollectionIds(
  config: PlaceConfig,
  root: string = process.cwd(),
): CollectionEntryId[] {
  const base = join(root, KNOWLEDGE_DIR);
  const ids: CollectionEntryId[] = [];

  for (const category of config.categories) {
    let files: string[];
    try {
      files = readdirSync(join(base, category.title), { withFileTypes: true })
        .filter(
          (entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('_'),
        )
        .map((entry) => entry.name);
    } catch {
      // A category with no directory yet is a normal state, not an error.
      continue;
    }
    for (const file of files) ids.push({ id: `${category.slug}/${file}` });
  }

  return ids;
}

/**
 * Every site-root-absolute route this build produces:
 *
 *   - the file-based static pages under `src/pages/` (dynamic `[...]` routes
 *     excluded — they are the article routes, derived below from the collection);
 *   - one hub per configured category;
 *   - one article route per collection entry whose category is configured, which is
 *     the same filter `src/pages/[category]/[slug].astro` applies in
 *     `getStaticPaths`. An article in a directory that is not a configured category
 *     has no page, so a link to it would be a 404.
 */
export function builtRoutes(
  config: PlaceConfig,
  collection: CollectionEntryId[],
  // Absolute when the caller is not running from the repository root, which every
  // caller outside the Astro build is.
  pagesDir = 'src/pages',
): string[] {
  const categorySlugs = new Set(config.categories.map((category) => category.slug));

  const staticRoutes = readdirSync(pagesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.astro') && !entry.name.startsWith('['))
    .map((entry) => entry.name.replace(/\.astro$/, ''))
    .map((name) => (name === 'index' ? '/' : `/${name}`));

  const hubRoutes = [...categorySlugs].map((slug) => `/${slug}`);

  const articleRoutes = collection
    .map((article) => {
      const parts = article.id.split('/');
      if (parts.length < 2) return null;
      return `/${parts[0]}/${parts.slice(1).join('/').replace(/\.md$/, '')}`;
    })
    .filter((route): route is string => route !== null && categorySlugs.has(route.split('/')[1]));

  return [...staticRoutes, ...hubRoutes, ...articleRoutes];
}
