/**
 * build-embeddings.mjs — the corpus embedding builder (RAG retrieval substrate).
 *
 * Chunks every article under knowledge/, embeds each chunk with bge-m3 through the
 * Workers AI REST API, and writes ONE derived artifact:
 *
 *   workers/chat/vectors.json   {schema, model, dim, quant, builtAt, count, chunks, vectors}
 *
 * The artifact is GITIGNORED and never committed: it carries article titles, URLs, and
 * body text, and workers/ is a code tree that may hold no place identity (AGENTS.md iron
 * rule 2). Both machine gates skip it by name, and scripts/ci/check-worker-config.mjs
 * fails if a committed one ever appears.
 *
 * Not wired into the prebuild chain, by design: the site build must stay green with no
 * Cloudflare credentials in the environment. Run it by hand after a knowledge/ change:
 *
 *   export CF_ACCOUNT_ID=...
 *   printf 'token: ' && read -rs CF_AI_TOKEN && echo && export CF_AI_TOKEN
 *   npm run embeddings:build
 *
 * Both are read from the environment and never persisted: no log line prints the token
 * or the request URL, and errors name the variable and the HTTP status, never the value.
 * An inline `CF_AI_TOKEN=... npm run ...` prefix would land in shell history, which is
 * why the runbook leads with the prompt form.
 *
 * See docs/runbook/DEPLOY.md §Corpus embeddings for the token scope and neuron budget.
 *
 * ── The token heuristic ──────────────────────────────────────────────────────────
 * countTokens() counts whitespace-separated words, not model tokens. It is a
 * heuristic, deliberately: the real bge-m3 tokenizer is not available at build time
 * without pulling a tokenizer dependency, and chunk sizing only needs to be
 * approximately right. English prose runs about 1.3 model tokens per word, so a
 * 500-word ceiling is roughly 650 model tokens — comfortably inside bge-m3's 8192-token
 * sequence limit, and the error is in the safe direction. There is no character-count
 * branch for any script: the framework is English-only in every code tree, which
 * scripts/ci/check-english-only.mjs enforces (AGENTS.md, iron rule 2).
 *
 * ── The corpus: what is embedded, and what is reported instead ───────────────────
 * Articles are discovered from the filesystem — every `knowledge/<dir>/*.md` that does
 * not start with `_` — which is the same definition the editorial gates use
 * (scripts/core/test-frontmatter.mjs discovers categories "from filesystem (no config
 * coupling)", and article-health's --all sweep walks the same shape). A directory whose
 * name is not a configured category in place.config.ts still holds articles, and this
 * script must see them: collecting only the configured folders would let an article go
 * missing while assertFullCoverage, which only ever sees what was collected, reported
 * full coverage.
 *
 * Only the articles the site publishes are embedded. The rest are EXCLUDED and named in
 * the run output, one line each, never dropped silently. The reason is the citation
 * contract: a chunk's `url` must resolve to a real page (it is what the chat worker
 * cites), and only a configured category has one — scripts/core/sync.sh projects those
 * folders into src/content/, and build-kb-index.mjs lists them in public/kb/topics.json.
 * Embedding an unpublished article would let an answer cite a 404, which is worse than
 * the answer not being available. Wiring a route for such a directory (its name becoming
 * a configured category) moves its articles into the corpus with no change here.
 *
 * Root-level `knowledge/*.md` is not article-shaped in that definition and is neither
 * embedded nor reported: those are the workflow queues a human edits in place
 * (sync.sh carries the same skip set), not content.
 *
 * ── The chunking rules ───────────────────────────────────────────────────────────
 *  (a) Sections split on `##` headings (h2 exactly; `###` and deeper stay inside their
 *      parent section, and a `##` line inside a fenced code block is not a heading).
 *      A section's text includes its own `## Heading` line, so no body content is lost.
 *  (b) A section over MAX_TOKENS splits again on blank-line paragraph boundaries. A
 *      single paragraph that alone exceeds MAX_TOKENS is emitted whole — splitting
 *      mid-paragraph would cut sentences in half for no retrieval benefit.
 *  (c) Consecutive chunks carry ~OVERLAP_TOKENS of overlap: each chunk after the first
 *      is prefixed with the trailing words of the previous chunk, across section
 *      boundaries as well as within a section, so a chunk never opens without the
 *      context that led into it.
 *
 *      Token accounting, since (b) and (c) compose: MAX_TOKENS is the ceiling on a
 *      chunk's OWN body, and the overlap prefix is added on top of it. An emitted chunk
 *      is therefore at most MAX_TOKENS + OVERLAP_TOKENS words (550, about 715 model
 *      tokens at the ratio above), and larger only in rule (b)'s documented case, where
 *      one paragraph exceeds the ceiling by itself and ships whole. Both stay far inside
 *      bge-m3's 8192-token sequence limit, which is the constraint that matters; the
 *      300-500 range is a retrieval-quality target for the body, not a hard cap on the
 *      emitted string.
 *  (d) A section under MIN_TOKENS merges forward into the next chunk rather than
 *      emitting a stub that would retrieve on its heading alone. A trailing short
 *      section has no successor, so it merges backward into the last chunk instead;
 *      either way its content ships.
 *  (e) An article with no `##` heading is one section with an empty heading.
 *  (f) An empty (or whitespace-only) body yields zero chunks. run() fails the build on
 *      one, naming the file — a silently unembedded article is invisible to retrieval.
 *  (g) A chunk's `heading` is the heading of the section its OWN content starts in,
 *      re-derived per chunk rather than inherited from the unit it came out of. (d) and
 *      (b) compose into the case that makes this load-bearing: a merged unit spans two
 *      sections, and once it splits on paragraphs a later piece starts inside the second
 *      one. The overlap prefix from (c) never decides it — that text is context carried
 *      in from the chunk before, not where this chunk begins.
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, basename, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import matter from 'gray-matter';

export const SCHEMA = 'rag-v1';
export const MODEL = '@cf/baai/bge-m3';
export const DIM = 1024;
export const QUANT = 'i8-unit';
/** Workers AI accepts at most this many inputs per `text` array. */
export const MAX_BATCH = 100;
export const MAX_TOKENS = 500;
export const MIN_TOKENS = 100;
export const OVERLAP_TOKENS = 50;

const API_BASE = 'https://api.cloudflare.com/client/v4/accounts';
const OUTPUT_PATH = 'workers/chat/vectors.json';
const RETRY_BASE_MS = 500;

/* ── chunking ─────────────────────────────────────────────────────────────────── */

/**
 * Word-count token heuristic. See the header comment for why this is words, and what
 * the ratio to real model tokens is.
 */
export function countTokens(text) {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

const words = (text) => text.trim().split(/\s+/).filter(Boolean);

/** The trailing ~OVERLAP_TOKENS words of a chunk, used as the next chunk's prefix. */
function overlapPrefix(text) {
  const w = words(text);
  if (w.length === 0) return '';
  return w.slice(Math.max(0, w.length - OVERLAP_TOKENS)).join(' ');
}

/**
 * Split a body into `{heading, text}` sections on h2 boundaries. The text of each
 * section includes its own heading line. Content before the first heading is a section
 * with an empty heading. A `##` line inside a fenced code block is code, not a heading.
 */
function splitSections(body) {
  const sections = [];
  let heading = '';
  let lines = [];
  let inFence = false;

  const flush = () => {
    const text = lines.join('\n').trim();
    if (text) sections.push({ heading, text });
    lines = [];
  };

  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h2 = !inFence && /^##(\s|$)/.test(line) ? line.replace(/^##\s*/, '').trim() : null;
    if (h2 !== null) {
      flush();
      heading = h2;
      lines = [line];
      continue;
    }
    lines.push(line);
  }
  flush();
  return sections;
}

/**
 * Split one section's text into pieces of at most MAX_TOKENS words, breaking only on
 * blank-line paragraph boundaries. A paragraph that alone exceeds the ceiling becomes
 * its own piece.
 */
function splitOnParagraphs(text) {
  if (countTokens(text) <= MAX_TOKENS) return [text];
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const pieces = [];
  let current = [];
  let currentTokens = 0;
  for (const paragraph of paragraphs) {
    const size = countTokens(paragraph);
    if (current.length && currentTokens + size > MAX_TOKENS) {
      pieces.push(current.join('\n\n'));
      current = [];
      currentTokens = 0;
    }
    current.push(paragraph);
    currentTokens += size;
  }
  if (current.length) pieces.push(current.join('\n\n'));
  return pieces.length ? pieces : [text];
}

/**
 * (d) Merge any run under MIN_TOKENS forward into what follows: a stub retrieves on its
 * heading alone and answers nothing. The merged unit keeps the FIRST unit's heading,
 * because that is where the merged unit starts — but a merged unit spans more than one
 * section, so this heading is only where the unit OPENS, not the heading of every chunk
 * it goes on to produce. headingsIn() re-derives that per chunk. A trailing short unit
 * has nothing to merge forward into, so it merges backward into the last unit instead —
 * content is never dropped, and a single short unit stands alone rather than vanishing.
 *
 * Applied twice: to sections, and then to the paragraph pieces of each section, since
 * splitting an over-long section can leave a short tail (or a heading-only head, when
 * one paragraph alone exceeds the ceiling).
 */
function mergeShort(units) {
  const merged = [];
  let carried = null;
  for (const unit of units) {
    const text = carried ? `${carried.text}\n\n${unit.text}` : unit.text;
    const heading = carried ? carried.heading : unit.heading;
    if (countTokens(text) < MIN_TOKENS) {
      carried = { heading, text };
      continue;
    }
    merged.push({ heading, text });
    carried = null;
  }
  if (carried) {
    if (merged.length) {
      const last = merged[merged.length - 1];
      last.text = `${last.text}\n\n${carried.text}`;
    } else {
      merged.push(carried);
    }
  }
  return merged;
}

/**
 * The h2 headings a piece of body text contains, under splitSections' rules (h2 exactly,
 * and never inside a fenced code block). Returns `{leading, last}`, each null when absent:
 *
 *   leading — the heading on the piece's first non-blank line, when it opens with one.
 *             Non-null means the piece starts a new section rather than continuing one.
 *   last    — the final heading in the piece, which is the section any following piece
 *             continues in.
 *
 * Both are needed because a merged unit's text spans sections: knowing only which
 * headings a piece contains cannot say which section it STARTS in, and that is what the
 * chunk's `heading` metadata means.
 */
function headingsIn(text, initialInFence = false) {
  let inFence = initialInFence;
  let seenContent = false;
  let leading = null;
  let last = null;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      seenContent = true;
      continue;
    }
    if (!inFence && /^##(\s|$)/.test(line)) {
      const heading = line.replace(/^##\s*/, '').trim();
      if (!seenContent) leading = heading;
      last = heading;
      seenContent = true;
      continue;
    }
    if (line.trim()) seenContent = true;
  }
  return { leading, last, inFence };
}

/**
 * Chunk one article. Pure: no filesystem, no network, no mutation of the argument.
 * Every chunk carries exactly {id, slug, title, url, category, heading, chunkIndex, text}.
 *
 * `heading` is the heading of the section the chunk STARTS in. Tracking it per chunk
 * rather than per unit is what keeps that true after rule (d) merges a short section into
 * the next one: the merged unit opens under the short section's heading, but once it
 * splits on paragraphs, a later piece can start well inside the section that followed,
 * and labelling it with the unit's opening heading would hand every consumer — retrieval
 * ranking, the citation the chat worker renders — the wrong section.
 */
export function chunkArticle({ slug, title, url, category, body }) {
  const sections = splitSections(body || '');
  if (sections.length === 0) return [];

  const chunks = [];
  let previousText = null;
  for (const section of mergeShort(sections)) {
    const pieces = mergeShort(
      splitOnParagraphs(section.text).map((text) => ({ heading: section.heading, text })),
    );
    // The section in effect at the start of the next piece: the unit's own heading until
    // a piece carries a heading of its own, then the last one that piece opened.
    let current = section.heading;
    let fenceState = false;
    for (const { text: piece } of pieces) {
      const { leading, last, inFence } = headingsIn(piece, fenceState);
      fenceState = inFence;
      const heading = leading === null ? current : leading;
      // (c) Overlap: prefix every chunk after the first with the previous chunk's tail.
      // The prefix is context carried from the previous chunk, so it is deliberately not
      // scanned for headings: the chunk's section is where its OWN content starts.
      const prefix = previousText ? overlapPrefix(previousText) : '';
      const text = prefix ? `${prefix}\n\n${piece}` : piece;
      chunks.push({
        id: `${slug}#${chunks.length}`,
        slug,
        title,
        url,
        category,
        heading,
        chunkIndex: chunks.length,
        text,
      });
      if (last !== null) current = last;
      previousText = text;
    }
  }
  return chunks;
}

/* ── quantization ─────────────────────────────────────────────────────────────── */

/**
 * L2-normalize a float vector, then scale to int8 (x127). Ported from the pre-cut
 * instance's build-embeddings.mjs: because every stored vector is a unit vector, a
 * consumer's plain dot product divided by 127^2 IS the cosine similarity, with no
 * per-query normalization in the worker's CPU budget.
 */
export function l2normInt8(vec) {
  let n = 0;
  for (const x of vec) n += x * x;
  n = Math.sqrt(n) || 1;
  const out = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = Math.max(-127, Math.min(127, Math.round((vec[i] / n) * 127)));
  }
  return out;
}

/** Concatenate N int8 vectors into one flat N x dim buffer, base64-encoded. */
export function packVectors(vectors) {
  if (vectors.length === 0) return '';
  const dim = vectors[0].length;
  const flat = new Int8Array(vectors.length * dim);
  vectors.forEach((v, i) => {
    if (v.length !== dim) {
      throw new Error(`packVectors: vector ${i} has length ${v.length}, expected ${dim}`);
    }
    flat.set(v, i * dim);
  });
  return Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength).toString('base64');
}

/** The inverse of packVectors. */
export function unpackVectors(base64, dim) {
  if (!base64) return [];
  const buf = Buffer.from(base64, 'base64');
  if (buf.byteLength % dim !== 0) {
    throw new Error(`unpackVectors: ${buf.byteLength} bytes is not a multiple of dim ${dim}`);
  }
  const flat = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = [];
  for (let i = 0; i < flat.length; i += dim) out.push(flat.slice(i, i + dim));
  return out;
}

/* ── Workers AI REST ──────────────────────────────────────────────────────────── */

/**
 * Read the two required credentials. A missing or blank value is a hard stop naming the
 * variable: an unauthenticated call would fail deeper in with a less useful message, and
 * a silent skip would ship an artifact that is quietly missing chunks.
 */
export function readCredentials(env) {
  const accountId = (env.CF_ACCOUNT_ID || '').trim();
  if (!accountId) {
    throw new Error('CF_ACCOUNT_ID is not set. Export it before running the embedding build (docs/runbook/DEPLOY.md).');
  }
  const apiToken = (env.CF_AI_TOKEN || '').trim();
  if (!apiToken) {
    throw new Error('CF_AI_TOKEN is not set. Export it before running the embedding build (docs/runbook/DEPLOY.md).');
  }
  return { accountId, apiToken };
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Embed one batch of at most MAX_BATCH texts. Every non-2xx response is retried up to
 * `retries` times with exponential backoff and then fails the run — including 401, which
 * is not special-cased: one uniform rule is easier to reason about than a status
 * taxonomy, and a bad token costs three wasted requests exactly once.
 */
export async function embedBatch(texts, options = {}) {
  const {
    accountId,
    apiToken,
    fetchImpl = globalThis.fetch,
    model = MODEL,
    dim = DIM,
    retries = 3,
    sleep = defaultSleep,
  } = options;

  if (texts.length > MAX_BATCH) {
    throw new Error(`embedBatch: ${texts.length} inputs exceeds the ${MAX_BATCH}-input batch limit`);
  }

  const url = `${API_BASE}/${accountId}/ai/run/${model}`;
  let lastStatus = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: texts }),
    });
    if (!res.ok) {
      lastStatus = res.status;
      continue;
    }
    const payload = await res.json();
    const data = payload?.result?.data;
    if (!Array.isArray(data)) {
      throw new Error('Workers AI returned no result.data array');
    }
    if (data.length !== texts.length) {
      throw new Error(`Workers AI returned ${data.length} vectors for ${texts.length} inputs`);
    }
    for (const vec of data) {
      if (!Array.isArray(vec) || vec.length !== dim) {
        throw new Error(
          `Workers AI returned a vector of length ${Array.isArray(vec) ? vec.length : 'n/a'}, expected ${dim}`,
        );
      }
    }
    return data;
  }
  throw new Error(`Workers AI request failed with HTTP ${lastStatus} after ${retries + 1} attempts`);
}

/* ── corpus ───────────────────────────────────────────────────────────────────── */

/** Why an article-shaped file under knowledge/ was not embedded. */
export const UNPUBLISHED =
  'the site publishes no page for it: its directory is not a category in place.config.ts';

/**
 * Discover every article under knowledge/ from the filesystem, and split them into the
 * ones this build embeds and the ones it does not. See the header comment for why the
 * scan is filesystem-driven and why an unpublished article is reported rather than
 * embedded.
 *
 * Returns `{articles, excluded}`:
 *   articles — published, in a configured category, so `url` matches that article's
 *              public/kb/topics.json entry one-for-one. Sorted by file path.
 *   excluded — `{file, reason}` for every article-shaped file that is not published.
 *              run() prints each one. Never silently empty of something it found.
 *
 * A `_`-prefixed file is not an article at all (the soundscape manifest is one), so it
 * appears in neither list.
 */
export async function collectArticles(root = process.cwd()) {
  const placeConfig = (await import(resolve(root, 'place.config.ts'))).default;
  // Configured category folder title -> url slug. The folder names are the titles.
  const categoryOf = new Map(placeConfig.categories.map((c) => [c.title, c.slug]));

  const knowledge = resolve(root, 'knowledge');
  let entries;
  try {
    entries = await readdir(knowledge, { withFileTypes: true });
  } catch {
    return { articles: [], excluded: [] }; // no knowledge/ tree yet
  }

  const articles = [];
  const excluded = [];
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = join(knowledge, entry.name);
    const files = (await readdir(dir))
      .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
      .sort();
    const category = categoryOf.get(entry.name);

    for (const file of files) {
      const abs = join(dir, file);
      if (!category) {
        excluded.push({ file: relative(root, abs), reason: UNPUBLISHED });
        continue;
      }
      const { data, content } = matter(await readFile(abs, 'utf-8'));
      const name = basename(file, '.md');
      articles.push({
        file: relative(root, abs),
        slug: `${category}/${name}`,
        title: data.title || name,
        url: `/${category}/${name}`,
        category,
        body: content,
      });
    }
  }
  return { articles, excluded };
}

/**
 * Every article must produce at least one chunk. An article that produced none is
 * unreachable by retrieval while looking perfectly healthy on the site, so this fails
 * the run rather than warning.
 */
export function assertFullCoverage(perArticle) {
  const empty = perArticle.filter((a) => a.chunkCount === 0).map((a) => a.file);
  if (empty.length) {
    throw new Error(
      `${empty.length} article(s) produced zero chunks and would be invisible to retrieval:\n` +
        empty.map((f) => `  ${f}`).join('\n'),
    );
  }
}

/**
 * Assemble the artifact. The manifest fields are the contract later phases read: a
 * consumer compares `schema`/`model`/`dim`/`quant` against what it expects and refuses a
 * stale index rather than silently querying vectors from a different model.
 */
export function buildArtifact({ chunks, vectors, model = MODEL, builtAt }) {
  if (chunks.length !== vectors.length) {
    throw new Error(`buildArtifact: ${chunks.length} chunks but ${vectors.length} vectors`);
  }
  return {
    schema: SCHEMA,
    model,
    dim: DIM,
    quant: QUANT,
    builtAt: builtAt || new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    count: chunks.length,
    chunks,
    vectors: packVectors(vectors),
  };
}

/* ── the run ──────────────────────────────────────────────────────────────────── */

/** What gets embedded: title and heading give the chunk its retrieval context. */
export const embedInput = (chunk) =>
  [chunk.title, chunk.heading, chunk.text].filter(Boolean).join('\n');

/**
 * Embed every chunk, batch by batch, soft-failing within the run and hard-failing at the
 * end. A batch that exhausts its retry budget is recorded and the loop CONTINUES: one
 * bad batch must not hide the state of the rest of the corpus, so the operator gets the
 * whole failure picture from one run instead of discovering it one batch per run.
 *
 * Returns `{vectors, failures}`. A non-empty `failures` means the run has no complete
 * set of vectors, and run() fails on it without writing an artifact: a partial
 * vectors.json is an index that is silently missing content, which is exactly what
 * assertFullCoverage exists to prevent. Fail-soft is the loop, not the outcome.
 */
export async function embedAllChunks({ chunks, accountId, apiToken, embed = embedBatch, onProgress }) {
  const vectors = [];
  const failures = [];
  for (let i = 0; i < chunks.length; i += MAX_BATCH) {
    const batch = chunks.slice(i, i + MAX_BATCH);
    try {
      const raw = await embed(batch.map(embedInput), { accountId, apiToken });
      for (const vec of raw) vectors.push(l2normInt8(vec));
      onProgress?.({ embedded: vectors.length, total: chunks.length });
    } catch (e) {
      failures.push({
        firstChunk: i,
        chunkCount: batch.length,
        slugs: [...new Set(batch.map((c) => c.slug))],
        message: e.message,
      });
      onProgress?.({ embedded: vectors.length, total: chunks.length, failed: batch.length, message: e.message });
    }
  }
  return { vectors, failures };
}

async function run() {
  const root = process.cwd();
  const { accountId, apiToken } = readCredentials(process.env);

  const { articles, excluded } = await collectArticles(root);

  // Every article-shaped file this scan found but will not embed, by name. Printed
  // before the work starts and on every run: an article missing from the index is a
  // question the chat worker cannot answer, and the operator has to be able to see it.
  if (excluded.length) {
    console.log(`[embeddings] ${excluded.length} article(s) NOT embedded — ${UNPUBLISHED}:`);
    for (const { file } of excluded) console.log(`[embeddings]   ${file}`);
  }

  const chunks = [];
  const perArticle = [];
  for (const article of articles) {
    const articleChunks = chunkArticle(article);
    perArticle.push({ file: article.file, chunkCount: articleChunks.length });
    chunks.push(...articleChunks);
  }
  assertFullCoverage(perArticle);

  console.log(
    `[embeddings] ${articles.length} articles in, ${chunks.length} chunks out — embedding with ${MODEL}`,
  );

  const { vectors, failures } = await embedAllChunks({
    chunks,
    accountId,
    apiToken,
    onProgress: ({ embedded, total, failed, message }) => {
      if (failed) console.error(`[embeddings]   ${failed} chunk(s) FAILED: ${message}`);
      else console.log(`[embeddings]   ${embedded}/${total} embedded`);
    },
  });

  if (failures.length) {
    const failedChunks = failures.reduce((n, f) => n + f.chunkCount, 0);
    throw new Error(
      `${failedChunks} of ${chunks.length} chunk(s) in ${failures.length} batch(es) failed to embed; ` +
        `no artifact was written. Affected articles:\n` +
        failures.map((f) => f.slugs.map((s) => `  ${s} (${f.message})`).join('\n')).join('\n'),
    );
  }

  const artifact = buildArtifact({ chunks, vectors });
  const outPath = resolve(root, OUTPUT_PATH);
  await mkdir(resolve(outPath, '..'), { recursive: true });
  const json = JSON.stringify(artifact);
  await writeFile(outPath, json, 'utf-8');

  console.log(
    `[embeddings] ${articles.length} articles in, ${chunks.length} chunks out, ` +
      `${Buffer.byteLength(json)} bytes -> ${OUTPUT_PATH}`,
  );
}

// Only the direct `node scripts/core/build-embeddings.mjs` invocation runs the build; an
// import (tests, later consumers) gets the pure functions and no side effects.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => {
    console.error(`[embeddings] FAILED: ${e.message}`);
    process.exit(1);
  });
}
