/**
 * chat-contexts.ts — the `knowledge/chat/_contexts.md` manifest reader.
 *
 * A context is a physical place a reader can be standing in when they scan a code:
 * a trailhead, a pier, a museum room. It carries the greeting `/chat?ctx=<slug>`
 * opens with, and an optional retrieval hint that biases the first question toward
 * the articles about that spot. Greetings and location labels are prose about a
 * place, which is content, so the whole list lives in `knowledge/` and never in
 * `place.config.ts` or `src/`.
 *
 * The file is named `_contexts.md` and the leading underscore is load-bearing: it
 * is what makes the file invisible to the three scanners that walk `knowledge/`
 * looking for articles —
 *
 *   - scripts/core/test-frontmatter.mjs    discovers categories from the filesystem,
 *                                          then filters `!f.startsWith('_')`
 *   - scripts/tools/article-health.py      globs `*.md`, skipping `startswith("_")`
 *   - scripts/core/build-content-dates.mjs returns null for `file.startsWith('_')`
 *
 * Rename it without that prefix and the article pipeline starts treating this list
 * of greetings as an article with no title, description, or category.
 *
 * The whole manifest is optional, and so is every consumer's route set. Every read
 * path degrades to an empty or reduced result instead of throwing: `readFileSync`
 * inside `try/catch`, never `await import()` — Rollup resolves a literal import
 * specifier before any catch handler runs, so a try/catch around a dynamic import
 * of a missing file is dead code
 * (`.agent-toolkit/rules/optional-build-time-json-readfilesync.md`).
 *
 * This file lives under src/, which both machine gates scan: its source is pure
 * ASCII and carries no place-specific string. Every place-bearing value comes from
 * the manifest it reads.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import matter from 'gray-matter';

/** Repository-relative path of the manifest. The `_` prefix is load-bearing. */
export const CONTEXT_MANIFEST_PATH = 'knowledge/chat/_contexts.md';

/**
 * The schema, as data. `scripts/ci/check-chat-context-schema-docs.mjs` derives the
 * documented field lists from these two arrays, so prose that restates the schema
 * cannot drift from the reader that implements it
 * (`.agent-toolkit/rules/guard-or-explain-prose-drift.md`). Order is the order a
 * diagnostic — and the documentation — names them in.
 */
export const CONTEXT_REQUIRED_FIELDS = ['slug', 'label', 'greeting'] as const;
export const CONTEXT_OPTIONAL_FIELDS = ['hint', 'article'] as const;

/**
 * The longest `hint` a context may carry.
 *
 * This is not a style preference: the chat worker rejects a request whose `hint`
 * exceeds its own `MAX_HINT_CHARS` with a 400 for the WHOLE request, not by ignoring
 * the field. A manifest that ships a longer hint would therefore turn a printed code
 * into a permanent error: the reader scans it, gets the greeting, asks anything, and
 * every question that session fails. Bounding it here, where every other manifest
 * defect is already caught and named, is what keeps that failure out of the build in
 * the first place.
 *
 * The two sides carry one value, held together by
 * `scripts/ci/check-chat-context-schema-docs.mjs`: it derives this number and fails
 * CI when the worker's constant, or the prose that documents the limit, disagrees.
 * They cannot share an import - an adopter may delete a worker tree it does not
 * deploy (`scripts/ci/run-worker-tests.mjs` treats an absent `workers/` as a skip),
 * and a page build that imported from one would break in that instance.
 */
export const CONTEXT_HINT_MAX_CHARS = 200;

/**
 * A slug is the `ctx` query value of a URL that gets PRINTED and then scanned off a
 * wall. Restricting it to lowercase kebab means the string in the code, the string
 * in the address bar, and the string in the manifest are the same three bytes for
 * byte — no percent-encoding round trip to get wrong, and nothing a phone camera's
 * URL preview can render ambiguously.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ChatContext {
  /** URL-safe identifier; the `ctx` query value. */
  slug: string;
  /** Human name of the place, shown on the printed card. */
  label: string;
  /** The opening message `/chat?ctx=<slug>` renders. */
  greeting: string;
  /** Retrieval hint appended to the embedded text of the first query, or null. */
  hint: string | null;
  /** A route this build produces, already validated, or null. */
  article: string | null;
}

export interface ChatContextManifest {
  /** Contexts that survived validation, in manifest order. */
  contexts: ChatContext[];
  /**
   * How many entries the `contexts` list held before validation, so a caller can
   * tell "this manifest declares nothing" from "everything it declared was
   * rejected". Those look identical in `contexts` and are opposite states to
   * report: the first is a place with nothing on a wall yet, the second is a
   * manifest to go fix.
   */
  declared: number;
  /** The manifest body (free-form human notes), trimmed. */
  notes: string;
  /** Build-time diagnostics. Also emitted through `console.warn`. */
  warnings: string[];
}

export interface ReadChatContextsOptions {
  /**
   * The routes this build actually produces, site-root-absolute.
   *
   * Only the caller knows the built route set, so it is injected rather than
   * derived here. Supplying it makes "this `article` resolves to no built route" a
   * decidable claim, and an entry that fails it is dropped. OMITTING it is not the
   * same statement: `npm run qr:sheet` can run before anything is built, and there
   * the claim cannot be evaluated at all — so the link alone is dropped and the
   * context still prints, rather than a card silently vanishing off a sheet because
   * the site had not been built yet.
   */
  knownRoutes?: Iterable<string>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
 * It is reported and then treated as no route set, because this module never
 * throws: a bad option must not take the whole page down.
 */
function toRouteSet(declared: unknown, warnings: string[]): Set<string> | null {
  if (declared === undefined) return null;

  const iterable =
    declared !== null &&
    typeof declared !== 'string' &&
    typeof (declared as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function';

  if (!iterable) {
    warnings.push(
      `${CONTEXT_MANIFEST_PATH}: \`knownRoutes\` must be an iterable of route strings, got ` +
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

/**
 * Resolves one context's optional `article`.
 *
 * Returns the route to render, or `{ drop: true }` when the whole context has to go.
 * The two are different failures: a declared `article` that provably resolves to
 * nothing is a broken context, because the greeting it belongs to is what sends a
 * reader at the link — while an unverifiable one is only an unverifiable link.
 */
function readArticle(
  declared: unknown,
  slug: string,
  routes: Set<string> | null,
  warnings: string[],
): { article: string | null; drop: boolean } {
  if (declared === undefined || declared === null) return { article: null, drop: false };

  if (routes === null) {
    warnings.push(
      `${CONTEXT_MANIFEST_PATH}: context "${slug}" declares an \`article\`, but no route set ` +
        'was supplied, so the link cannot be proven to resolve. Link omitted; the context ' +
        'still works.',
    );
    return { article: null, drop: false };
  }

  if (!isNonEmptyString(declared)) {
    warnings.push(
      `${CONTEXT_MANIFEST_PATH}: context "${slug}" declares a non-string \`article\`; skipped.`,
    );
    return { article: null, drop: true };
  }

  const article = declared.trim();

  // `//host/path` is protocol-relative: it leads off this site despite the leading
  // slash, so it is rejected on shape rather than left to a route lookup.
  const siteRootAbsolute = article.startsWith('/') && !article.startsWith('//');

  if (!siteRootAbsolute || !routes.has(routeKey(article))) {
    warnings.push(
      `${CONTEXT_MANIFEST_PATH}: context "${slug}" declares \`article\` "${article}", which ` +
        'does not resolve to a route this build produces; skipped. The remaining contexts ' +
        'still work.',
    );
    return { article: null, drop: true };
  }

  return { article, drop: false };
}

/**
 * Validates one item of the `contexts` list. Returns the context, or null after
 * recording exactly one warning naming what was wrong with it.
 */
function readContext(
  item: unknown,
  index: number,
  seenSlugs: Set<string>,
  routes: Set<string> | null,
  warnings: string[],
): ChatContext | null {
  const at = `context ${index}`;

  if (!isMapping(item)) {
    warnings.push(`${CONTEXT_MANIFEST_PATH}: ${at} is not a mapping; skipped.`);
    return null;
  }

  const invalid = CONTEXT_REQUIRED_FIELDS.filter((field) => !isNonEmptyString(item[field]));
  if (invalid.length > 0) {
    warnings.push(
      `${CONTEXT_MANIFEST_PATH}: ${at} is missing or has a non-string ${invalid.join(', ')}; skipped.`,
    );
    return null;
  }

  const slug = (item.slug as string).trim();

  if (!SLUG_PATTERN.test(slug)) {
    warnings.push(
      `${CONTEXT_MANIFEST_PATH}: ${at} declares the slug "${slug}", which is not lowercase ` +
        'letters, digits, and single hyphens; skipped. A slug is printed inside a URL, so it ' +
        'may not need percent-encoding.',
    );
    return null;
  }

  // Slugs are what a printed code resolves against. A duplicate would make one of
  // the two unreachable, so the later one is dropped rather than shadowed.
  if (seenSlugs.has(slug)) {
    warnings.push(
      `${CONTEXT_MANIFEST_PATH}: ${at} repeats the slug "${slug}", which an earlier context ` +
        'already uses; skipped. A slug is what a scanned code resolves to and must be unique.',
    );
    return null;
  }

  const { article, drop } = readArticle(item.article, slug, routes, warnings);
  if (drop) return null;

  // A hint renders nothing to a reader and cannot become a link, so a malformed one
  // costs the context its retrieval bias and nothing else. Dropping the whole
  // context over it would take a printed code out of service for a value nobody
  // sees.
  //
  // A hint the worker would refuse is the same class of defect: it is dropped rather
  // than sent, because a hint the request cannot carry costs the context its
  // retrieval bias, while sending it would cost the context every answer.
  let hint: string | null = null;
  if (item.hint !== undefined && item.hint !== null && item.hint !== '') {
    if (!isNonEmptyString(item.hint)) {
      warnings.push(
        `${CONTEXT_MANIFEST_PATH}: context "${slug}" declares a non-string \`hint\`; ignored. ` +
          'The context still works, without a retrieval hint.',
      );
    } else if (item.hint.trim().length > CONTEXT_HINT_MAX_CHARS) {
      // Measured after trimming, exactly as the worker measures it, so the two agree
      // on the same string rather than on the same field.
      warnings.push(
        `${CONTEXT_MANIFEST_PATH}: context "${slug}" declares a \`hint\` of ` +
          `${item.hint.trim().length} characters, over the ${CONTEXT_HINT_MAX_CHARS}-character ` +
          'limit the chat worker accepts; ignored. Sending it would fail every question ' +
          'asked from this context, so the context works without a retrieval hint. ' +
          'Shorten it to keep the bias.',
      );
    } else {
      hint = item.hint.trim();
    }
  }

  seenSlugs.add(slug);

  return {
    slug,
    label: (item.label as string).trim(),
    greeting: (item.greeting as string).trim(),
    hint,
    article,
  };
}

/**
 * Reads the manifest under `root` (default: the current working directory, which is
 * the repository root during `astro build`).
 *
 * Never throws. An absent manifest returns zero contexts and no warning at all —
 * an instance that declares no context is not broken, it simply has no QR flow. A
 * malformed entry, a duplicate slug, an unusable slug, and an `article` that
 * resolves to no built route each skip that one context alone and record a warning
 * naming it; every other context still works.
 */
export function readChatContexts(
  root: string = process.cwd(),
  // Nullable, not just optional: the plain-JS callers under `scripts/` get no type
  // checking, and this module's contract is that it never throws.
  options?: ReadChatContextsOptions | null,
): ChatContextManifest {
  let raw: string;
  try {
    raw = readFileSync(resolve(root, CONTEXT_MANIFEST_PATH), 'utf8');
  } catch {
    // No QR flow in this instance. `/chat` behaves exactly as it does without one.
    return { contexts: [], declared: 0, notes: '', warnings: [] };
  }

  const warnings: string[] = [];

  let parsed;
  try {
    parsed = matter(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    warnings.push(
      `${CONTEXT_MANIFEST_PATH}: frontmatter could not be parsed (${reason}); no contexts read.`,
    );
    return emit({ contexts: [], declared: 0, notes: '', warnings });
  }

  const notes = String(parsed.content ?? '').trim();
  const data = (parsed.data as Record<string, unknown>) ?? {};
  const routes = toRouteSet(options?.knownRoutes, warnings);
  const declared = data.contexts;

  if (declared === undefined || declared === null) {
    warnings.push(`${CONTEXT_MANIFEST_PATH}: no \`contexts\` list; no contexts read.`);
    return emit({ contexts: [], declared: 0, notes, warnings });
  }

  if (!Array.isArray(declared)) {
    warnings.push(
      `${CONTEXT_MANIFEST_PATH}: \`contexts\` must be a list, got ${typeof declared}; ` +
        'no contexts read.',
    );
    return emit({ contexts: [], declared: 0, notes, warnings });
  }

  const seenSlugs = new Set<string>();
  const contexts: ChatContext[] = [];
  declared.forEach((item, index) => {
    const context = readContext(item, index, seenSlugs, routes, warnings);
    if (context) contexts.push(context);
  });

  return emit({ contexts, declared: declared.length, notes, warnings });
}

/**
 * Emit every diagnostic to the build log before returning it. Warning at the source
 * is what makes a dropped context visible in a real `astro build` transcript rather
 * than depending on each caller remembering to print what it was handed.
 */
function emit(result: ChatContextManifest): ChatContextManifest {
  for (const warning of result.warnings) console.warn(warning);
  return result;
}
