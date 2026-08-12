/**
 * sounds.ts — the `knowledge/sounds/` manifest reader.
 *
 * The soundscape page is the one surface whose data lives in `knowledge/` but is
 * not an article. The manifest is Markdown so `knowledge/` stays Markdown, and it
 * is named `_manifest.md` because the leading underscore is what makes it
 * invisible to every scanner that walks `knowledge/`:
 *
 *   - scripts/core/test-frontmatter.mjs   discovers categories from the filesystem,
 *                                         then filters `!f.startsWith('_')`
 *   - scripts/tools/article-health.py     globs `*.md`, skipping `startswith("_")`
 *   - scripts/core/build-content-dates.mjs returns null for `file.startsWith('_')`
 *
 * Rename it without that prefix and the article pipeline starts treating it as an
 * article with no title, description, or category.
 *
 * Two manifest shapes are accepted and normalized into one structure:
 *
 *   - **flat** — a top-level `sounds` list, the shape the first release shipped.
 *     It becomes a single implicit category that renders no heading, so an
 *     existing manifest keeps rendering exactly as it did.
 *   - **categorized** — a top-level `categories` list, each category carrying its
 *     own `sounds` list, an optional `wishlist` of sounds still wanted, and an
 *     optional `article` link.
 *
 * The whole manifest is optional. An adopted instance ships no `knowledge/sounds/`
 * at all (the init wizard removes the demo tree), so every read path here degrades
 * to an empty result instead of throwing: `readFileSync` inside `try/catch`, never
 * `await import()` — Rollup resolves a literal import specifier before any catch
 * handler runs, so the try/catch around a dynamic import of a missing file is dead
 * code (`.agent-toolkit/rules/optional-build-time-json-readfilesync.md`).
 *
 * This file lives under src/, which both machine gates scan: its source is pure
 * ASCII and carries no place-specific string.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import matter from 'gray-matter';

/** Repository-relative path of the manifest. The `_` prefix is load-bearing. */
export const MANIFEST_PATH = 'knowledge/sounds/_manifest.md';

/**
 * Anchor id of the implicit category a flat manifest normalizes into. A flat
 * manifest declares no id, and `<section id>` still has to be addressable.
 */
export const IMPLICIT_CATEGORY_ID = 'recordings';

/** Public-directory prefix a manifest `file` is resolved against on disk. */
const PUBLIC_DIR = 'public';

/**
 * The schema, as data. `scripts/ci/check-soundscape-schema-docs.mjs` derives the
 * documented field lists from these five arrays, so prose that restates the
 * schema cannot drift from the reader that implements it
 * (`.agent-toolkit/rules/guard-or-explain-prose-drift.md`). Order is the order a
 * diagnostic — and the documentation — names them in.
 */
export const RECORDING_REQUIRED_FIELDS = ['title', 'location', 'credit', 'file'] as const;
export const RECORDING_OPTIONAL_FIELDS = [
  'description',
  'icon',
  'contributor',
  'contributorUrl',
  'date',
] as const;
export const CATEGORY_REQUIRED_FIELDS = ['id', 'icon', 'title'] as const;
export const CATEGORY_OPTIONAL_FIELDS = ['article'] as const;
export const WISHLIST_REQUIRED_FIELDS = ['icon', 'text'] as const;

export interface SoundEntry {
  /** Display title of the recording. */
  title: string;
  /** Where it was captured, in the instance's own words. */
  location: string;
  /** Attribution. Synthesized demo clips say so here rather than claiming a place. */
  credit: string;
  /** Site-root-absolute public path, e.g. `/media/sounds/clip.mp3`. */
  file: string;
  /** One or two sentences of context, or null. */
  description: string | null;
  /** Decorative glyph shown on the card, or null. */
  icon: string | null;
  /** Who recorded it, or null. */
  contributor: string | null;
  /** Where that contributor can be reached, or null. */
  contributorUrl: string | null;
  /** ISO-8601 string, or null when the entry declares no date. */
  date: string | null;
}

export interface WishlistItem {
  /** Decorative glyph. */
  icon: string;
  /** The sound this place still wants someone to record. */
  text: string;
}

export interface SoundCategory {
  /** Anchor id, unique across the manifest. */
  id: string;
  /** Heading text, or null for the implicit category, which renders no heading. */
  title: string | null;
  /** Decorative glyph beside the heading, or null for the implicit category. */
  icon: string | null;
  /** A route this build produces, already validated, or null. */
  article: string | null;
  /** Entries that survived validation, in manifest order. */
  entries: SoundEntry[];
  /** Sounds still wanted in this category, in manifest order. */
  wishlist: WishlistItem[];
}

export interface SoundscapeManifest {
  /** Categories that survived validation, in manifest order. */
  categories: SoundCategory[];
  /** Every surviving entry, across all categories, in manifest order. */
  entries: SoundEntry[];
  /** The manifest body (free-form human notes), trimmed. */
  notes: string;
  /** Build-time diagnostics. Also emitted through `console.warn`. */
  warnings: string[];
}

export interface ReadSoundscapeOptions {
  /**
   * The routes this build actually produces, site-root-absolute. Only the page
   * knows the built route set (it comes from the content collection plus
   * `place.config.ts`), so it is injected rather than derived here — which also
   * keeps this module readable outside Astro.
   *
   * Omitting it is fail-closed, not permissive: a declared `article` cannot be
   * proven to resolve, so it is dropped with a warning instead of shipping a
   * possible 404.
   */
  knownRoutes?: Iterable<string>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** A required field's trimmed value; the caller has already validated it. */
const req = (record: Record<string, unknown>, field: string): string =>
  (record[field] as string).trim();

/** An optional string field: absent, empty, or non-string all become null. */
function optionalString(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * gray-matter silently coerces an unquoted YAML `date: 2026-07-30` to a JavaScript
 * `Date`. `String(date)` on one of those yields a locale-dependent, non-ISO form
 * that breaks lexicographic sort and `.slice(0, 10)`, so normalize at the boundary
 * (`.agent-toolkit/rules/gray-matter-date-normalization.md`).
 */
function normalizeDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

/**
 * A `file` must stay inside `public/`: site-root-absolute, no `..` segment.
 *
 * Segments are split on both separators because the value is checked here and
 * joined with `path.join` below. On Windows `path.join` treats `\` as a separator,
 * so `/media\..\..\secret.mp3` is a single segment to a `/`-only split and three
 * segments to the join that follows it -- the containment claim has to hold on the
 * platform that reads the manifest, not just on POSIX.
 */
function isSafePublicPath(file: string): boolean {
  if (!file.startsWith('/')) return false;
  return !file.split(/[\\/]/).includes('..');
}

/** Route identity: one optional trailing slash, and no fragment or query. */
function routeKey(path: string): string {
  const bare = path.split('#')[0].split('?')[0];
  return bare.length > 1 ? bare.replace(/\/+$/, '') : bare;
}

/**
 * Normalizes the caller's `knownRoutes` into a lookup set, or null for "no route
 * set supplied".
 *
 * An unusable value — anything not iterable, and a bare string, which is iterable
 * but would yield one route per character — is a caller defect, not manifest data.
 * It is reported and then treated as no route set, because this module's contract
 * is that it never throws: a bad option must not take the whole page down, and
 * failing closed drops the links it could not prove rather than shipping them.
 */
function toRouteSet(declared: unknown, warnings: string[]): Set<string> | null {
  if (declared === undefined) return null;

  const iterable =
    declared !== null &&
    typeof declared !== 'string' &&
    typeof (declared as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function';

  if (!iterable) {
    warnings.push(
      `${MANIFEST_PATH}: \`knownRoutes\` must be an iterable of route strings, got ` +
        `${declared === null ? 'null' : typeof declared}; treated as no route set, so every ` +
        'declared `article` link is omitted.',
    );
    return null;
  }

  const routes = new Set<string>();
  for (const route of declared as Iterable<unknown>) {
    if (isNonEmptyString(route)) routes.add(routeKey(route.trim()));
  }
  return routes;
}

/** Diagnostic prefix: `entry 2` standing alone, or scoped to its category. */
function where(index: number, categoryId: string | null): string {
  return categoryId === null ? `entry ${index}` : `entry ${index} in category "${categoryId}"`;
}

/**
 * Validates one item of a `sounds` list. Returns the entry, or null after
 * recording exactly one warning naming what was wrong with it.
 */
function readEntry(
  item: unknown,
  index: number,
  categoryId: string | null,
  root: string,
  warnings: string[],
): SoundEntry | null {
  const at = where(index, categoryId);

  if (!isMapping(item)) {
    warnings.push(`${MANIFEST_PATH}: ${at} is not a mapping; skipped.`);
    return null;
  }

  const invalid = RECORDING_REQUIRED_FIELDS.filter((f) => !isNonEmptyString(item[f]));
  if (invalid.length > 0) {
    warnings.push(
      `${MANIFEST_PATH}: ${at} is missing or has a non-string ${invalid.join(', ')}; skipped.`,
    );
    return null;
  }

  const title = req(item, 'title');
  const file = req(item, 'file');

  if (!isSafePublicPath(file)) {
    warnings.push(
      `${MANIFEST_PATH}: ${at} "${title}" declares an unusable file "${file}"; ` +
        'a file must be a site-root-absolute path with no ".." segment. Skipped.',
    );
    return null;
  }

  if (!existsSync(join(root, PUBLIC_DIR, file))) {
    warnings.push(
      `${MANIFEST_PATH}: ${at} "${title}" declares "${file}", which does not exist ` +
        `under ${PUBLIC_DIR}/. Skipped; the remaining entries still render.`,
    );
    return null;
  }

  return {
    title,
    location: req(item, 'location'),
    credit: req(item, 'credit'),
    file,
    description: optionalString(item.description),
    icon: optionalString(item.icon),
    contributor: optionalString(item.contributor),
    contributorUrl: optionalString(item.contributorUrl),
    date: normalizeDate(item.date),
  };
}

/**
 * Reads a `sounds` value into entries. An absent or empty list is a supported
 * state and warns nothing; a non-list warns once and yields nothing.
 */
function readEntries(
  declared: unknown,
  categoryId: string | null,
  root: string,
  warnings: string[],
): SoundEntry[] {
  if (declared === undefined || declared === null) return [];

  if (!Array.isArray(declared)) {
    const scope = categoryId === null ? '' : ` in category "${categoryId}"`;
    warnings.push(
      `${MANIFEST_PATH}: \`sounds\`${scope} must be a list, got ${typeof declared}; ` +
        'no entries rendered.',
    );
    return [];
  }

  const entries: SoundEntry[] = [];
  declared.forEach((item, index) => {
    const entry = readEntry(item, index, categoryId, root, warnings);
    if (entry) entries.push(entry);
  });
  return entries;
}

/** Reads a category's `wishlist`. Same discipline as a recording: skip one, keep the rest. */
function readWishlist(declared: unknown, categoryId: string, warnings: string[]): WishlistItem[] {
  if (declared === undefined || declared === null) return [];

  if (!Array.isArray(declared)) {
    warnings.push(
      `${MANIFEST_PATH}: \`wishlist\` in category "${categoryId}" must be a list, got ` +
        `${typeof declared}; no wishlist rendered.`,
    );
    return [];
  }

  const wishlist: WishlistItem[] = [];
  declared.forEach((item, index) => {
    const at = `wishlist entry ${index} in category "${categoryId}"`;

    if (!isMapping(item)) {
      warnings.push(`${MANIFEST_PATH}: ${at} is not a mapping; skipped.`);
      return;
    }

    const invalid = WISHLIST_REQUIRED_FIELDS.filter((f) => !isNonEmptyString(item[f]));
    if (invalid.length > 0) {
      warnings.push(
        `${MANIFEST_PATH}: ${at} is missing or has a non-string ${invalid.join(', ')}; skipped.`,
      );
      return;
    }

    wishlist.push({ icon: req(item, 'icon'), text: req(item, 'text') });
  });
  return wishlist;
}

/**
 * Resolves a category's optional `article` against the routes this build produces.
 *
 * Anything that cannot be proven to resolve is dropped with a warning naming the
 * category, so the page never ships a link into a 404 — which is also what keeps
 * the post-build internal-link check (`scripts/core/check-internal-links.mjs`)
 * green instead of failing the whole build over one manifest typo.
 */
function readArticle(
  declared: unknown,
  categoryId: string,
  routes: Set<string> | null,
  warnings: string[],
): string | null {
  if (declared === undefined || declared === null) return null;

  if (!isNonEmptyString(declared)) {
    warnings.push(
      `${MANIFEST_PATH}: category "${categoryId}" declares a non-string \`article\`; ` +
        'link omitted.',
    );
    return null;
  }

  const article = declared.trim();

  if (routes === null) {
    warnings.push(
      `${MANIFEST_PATH}: category "${categoryId}" declares \`article\` "${article}", but no ` +
        'route set was supplied, so the link cannot be proven to resolve. Link omitted.',
    );
    return null;
  }

  // `//host/path` is protocol-relative: it leads off this site despite the leading
  // slash, so it is rejected on shape rather than left to a route lookup.
  const siteRootAbsolute = article.startsWith('/') && !article.startsWith('//');

  if (!siteRootAbsolute || !routes.has(routeKey(article))) {
    warnings.push(
      `${MANIFEST_PATH}: category "${categoryId}" declares \`article\` "${article}", which ` +
        'does not resolve to a route this build produces. Link omitted; the category ' +
        'still renders.',
    );
    return null;
  }

  return article;
}

/** Validates one item of a `categories` list. Returns the category, or null. */
function readCategory(
  item: unknown,
  index: number,
  seenIds: Set<string>,
  root: string,
  routes: Set<string> | null,
  warnings: string[],
): SoundCategory | null {
  if (!isMapping(item)) {
    warnings.push(`${MANIFEST_PATH}: category ${index} is not a mapping; skipped.`);
    return null;
  }

  const invalid = CATEGORY_REQUIRED_FIELDS.filter((f) => !isNonEmptyString(item[f]));
  if (invalid.length > 0) {
    warnings.push(
      `${MANIFEST_PATH}: category ${index} is missing or has a non-string ` +
        `${invalid.join(', ')}; skipped.`,
    );
    return null;
  }

  const id = req(item, 'id');

  // Ids are `<section>` anchors. A duplicate would make one of the two
  // unreachable by fragment, so the later one is dropped rather than shadowed.
  if (seenIds.has(id)) {
    warnings.push(
      `${MANIFEST_PATH}: category ${index} repeats the id "${id}", which an earlier ` +
        'category already uses; skipped. Section ids are anchors and must be unique.',
    );
    return null;
  }
  seenIds.add(id);

  return {
    id,
    title: req(item, 'title'),
    icon: req(item, 'icon'),
    article: readArticle(item.article, id, routes, warnings),
    entries: readEntries(item.sounds, id, root, warnings),
    wishlist: readWishlist(item.wishlist, id, warnings),
  };
}

/**
 * Reads the manifest under `root` (default: the current working directory, which
 * is the repository root during `astro build`).
 *
 * Never throws. An absent manifest, an absent `sounds` list, and an empty list all
 * return zero entries — the page renders its documented empty state. A malformed
 * entry, category, or wishlist item, an unsafe `file`, a `file` with no matching
 * asset under `public/`, and an `article` that resolves to no built route each
 * skip that one thing alone and record a warning naming it; everything else still
 * renders.
 */
export function readSoundscape(
  root: string = process.cwd(),
  options: ReadSoundscapeOptions = {},
): SoundscapeManifest {
  const manifestPath = resolve(root, MANIFEST_PATH);

  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch {
    // No soundscape in this instance. The page's empty state is the contract.
    return { categories: [], entries: [], notes: '', warnings: [] };
  }

  const warnings: string[] = [];
  const empty = (notes: string) => emit({ categories: [], entries: [], notes, warnings });

  let parsed;
  try {
    parsed = matter(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    warnings.push(
      `${MANIFEST_PATH}: frontmatter could not be parsed (${reason}); no entries rendered.`,
    );
    return empty('');
  }

  const notes = String(parsed.content ?? '').trim();
  const data = (parsed.data as Record<string, unknown>) ?? {};
  const routes = toRouteSet(options.knownRoutes, warnings);

  const declaredCategories = data.categories;
  const hasCategories = Array.isArray(declaredCategories);

  if (declaredCategories !== undefined && declaredCategories !== null && !hasCategories) {
    warnings.push(
      `${MANIFEST_PATH}: \`categories\` must be a list, got ${typeof declaredCategories}; ` +
        'ignored, and a top-level `sounds` list is read instead.',
    );
  }

  if (hasCategories) {
    if (data.sounds !== undefined && data.sounds !== null) {
      warnings.push(
        `${MANIFEST_PATH}: a top-level \`sounds\` list is ignored because \`categories\` ` +
          'is declared; move those entries into a category.',
      );
    }

    const seenIds = new Set<string>();
    const categories: SoundCategory[] = [];
    declaredCategories.forEach((item, index) => {
      const category = readCategory(item, index, seenIds, root, routes, warnings);
      if (category) categories.push(category);
    });

    return emit({
      categories,
      entries: categories.flatMap((category) => category.entries),
      notes,
      warnings,
    });
  }

  // Flat shape: one implicit category, no heading. It exists only when it has
  // something to show, so a manifest with nothing playable still reaches the
  // page's documented empty state rather than an empty unlabelled section.
  const entries = readEntries(data.sounds, null, root, warnings);
  const categories: SoundCategory[] =
    entries.length === 0
      ? []
      : [
          {
            id: IMPLICIT_CATEGORY_ID,
            title: null,
            icon: null,
            article: null,
            entries,
            wishlist: [],
          },
        ];

  return emit({ categories, entries, notes, warnings });
}

/**
 * Emit every diagnostic to the build log before returning it. Warning at the source
 * is what makes a missing asset visible in a real `astro build` transcript rather
 * than depending on each caller remembering to print what it was handed.
 */
function emit(result: SoundscapeManifest): SoundscapeManifest {
  for (const warning of result.warnings) console.warn(warning);
  return result;
}
