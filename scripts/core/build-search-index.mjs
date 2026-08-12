/**
 * build-search-index.mjs — build-time MiniSearch index generator.
 *
 * Reads all markdown under knowledge/, tokenizes title/description/tags, and
 * emits serialized MiniSearch indexes at the /kb/ paths Layout.astro fetches:
 *
 *   public/kb/search-minisearch-{lang}.json  per enabled language (client fetches
 *                                            its own shard by <html lang>)
 *   public/kb/search-minisearch.json         combined fallback (all languages)
 *   public/kb/search-index.json              plain-array fallback for Layout's
 *                                            indexOf path when MiniSearch fails
 *
 * Tokenizer gate (place.config.languages): a purely-Latin config uses plain word
 * tokenization; the CJK bigram path activates only when a CJK language (zh/ja/ko)
 * is enabled. Categories + languages flow from place.config.ts (genericity gate).
 *
 * Field names stay `*_bigram` to match Layout.astro's MiniSearch loadJSON schema.
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import matter from 'gray-matter';
import MiniSearch from 'minisearch';

const ROOT = process.cwd();
const placeConfig = (await import(resolve(ROOT, 'place.config.ts'))).default;

const CATEGORIES = placeConfig.categories.map((c) => ({
  slug: c.slug,
  title: c.title,
}));
const LANGS = placeConfig.place.languages?.length
  ? placeConfig.place.languages
  : ['en'];
const DEFAULT_LANG = LANGS[0];
const USE_CJK = LANGS.some((l) => /^(zh|ja|ko)/i.test(l));

// ── Tokenizers ──

const LATIN_RE = /[a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9]/g;

const isCJK = (cp) =>
  (cp >= 0x4e00 && cp <= 0x9fff) ||
  (cp >= 0x3400 && cp <= 0x4dbf) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0x3100 && cp <= 0x312f) ||
  (cp >= 0x3040 && cp <= 0x30ff) || // Hiragana + Katakana
  (cp >= 0x31f0 && cp <= 0x31ff) || // Katakana phonetic extensions
  (cp >= 0xac00 && cp <= 0xd7a3); // Hangul syllables

function latinTokenize(text) {
  if (!text) return '';
  const normalized = text.toLowerCase().normalize('NFKC');
  const tokens = [];
  for (const m of normalized.matchAll(LATIN_RE)) {
    if (m[0].length >= 2) tokens.push(m[0]);
  }
  return tokens.join(' ');
}

function bigramTokenize(text) {
  if (!text) return '';
  const normalized = text.toLowerCase().normalize('NFKC');
  const tokens = [];
  for (const m of normalized.matchAll(LATIN_RE)) {
    if (m[0].length >= 2) tokens.push(m[0]);
  }
  const chars = [...normalized];
  for (let i = 0; i < chars.length - 1; i++) {
    if (isCJK(chars[i].codePointAt(0)) && isCJK(chars[i + 1].codePointAt(0))) {
      tokens.push(chars[i] + chars[i + 1]);
    }
  }
  return tokens.join(' ');
}

const tokenizeField = USE_CJK ? bigramTokenize : latinTokenize;

// ── Scan one language's articles ──

async function scanLang(lang, startId) {
  const docs = [];
  let id = startId;
  const isDefault = lang === DEFAULT_LANG;

  for (const { slug, title } of CATEGORIES) {
    const dir = isDefault
      ? resolve(ROOT, 'knowledge', title)
      : resolve(ROOT, 'knowledge', lang, title);
    let files;
    try {
      files = (await readdir(dir)).filter(
        (f) => f.endsWith('.md') && !f.startsWith('_'),
      );
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const { data } = matter(await readFile(join(dir, file), 'utf-8'));
        const name = basename(file, '.md');
        const title2 = data.title || name;
        const description = data.description || '';
        const tags = Array.isArray(data.tags)
          ? data.tags
          : data.tags
            ? [data.tags]
            : [];
        docs.push({
          id: id++,
          t: title2,
          d: description,
          u: isDefault ? `/${slug}/${name}` : `/${lang}/${slug}/${name}`,
          tags,
          lang,
          title_bigram: tokenizeField(title2),
          desc_bigram: tokenizeField(description),
          tags_bigram: tokenizeField(tags.join(' ')),
        });
      } catch {
        console.warn(`[search] skipped ${lang}/${file}: YAML parse error`);
      }
    }
  }
  return docs;
}

function buildIndex(docs) {
  const miniSearch = new MiniSearch({
    idField: 'id',
    fields: ['title_bigram', 'desc_bigram', 'tags_bigram'],
    storeFields: ['t', 'd', 'u', 'tags', 'lang'],
    tokenize: (text) => text.split(/\s+/).filter(Boolean),
    searchOptions: {
      boost: { title_bigram: 6, tags_bigram: 4, desc_bigram: 2 },
      prefix: true,
    },
  });
  miniSearch.addAll(docs);
  return JSON.stringify(miniSearch);
}

// ── Main ──

const kbDir = resolve(ROOT, 'public', 'kb');
await mkdir(kbDir, { recursive: true });

const docsByLang = new Map();
let nextId = 0;
for (const lang of LANGS) {
  const docs = await scanLang(lang, nextId);
  nextId += docs.length;
  docsByLang.set(lang, docs);
}

// Per-language shards (path Layout fetches first, by <html lang>).
for (const [lang, docs] of docsByLang) {
  const serialized = buildIndex(docs);
  await writeFile(join(kbDir, `search-minisearch-${lang}.json`), serialized, 'utf-8');
  console.log(
    `[search] shard ${lang}: ${docs.length} docs, ${(serialized.length / 1024).toFixed(0)} KB`,
  );
}

// Combined fallback (all languages) — Layout's second fetch.
const allDocs = LANGS.flatMap((lang) => docsByLang.get(lang) || []);
await writeFile(join(kbDir, 'search-minisearch.json'), buildIndex(allDocs), 'utf-8');

// Plain-array fallback for Layout's indexOf path (MiniSearch load failure).
const fallbackDocs = allDocs.map((d) => ({
  t: d.t,
  d: d.d,
  u: d.u,
  tags: d.tags,
  lang: d.lang,
}));
await writeFile(join(kbDir, 'search-index.json'), JSON.stringify(fallbackDocs), 'utf-8');

console.log(
  `[search] ${allDocs.length} docs across ${LANGS.length} lang(s) → public/kb/ (${USE_CJK ? 'bigram' : 'word'} tokenizer)`,
);
