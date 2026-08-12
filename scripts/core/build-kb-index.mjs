/**
 * build-kb-index.mjs — the /kb/ AI-consumer protocol generator.
 *
 * Ports the fork's generate-api.js to the vendor-agnostic /kb/ contract
 * (SPEC §Build pipeline: the static-endpoint namespace is /kb/, never the legacy
 * runtime-style prefix). One scan of knowledge/ emits:
 *
 *   public/kb/topics.json            — every article's metadata (the index an AI
 *                                      reads after llms.txt to decide what to fetch)
 *   public/kb/articles/{cat}/{slug}.md — raw markdown per article (one HTTP request
 *                                      per article, no clone/MCP required)
 *   public/llms.txt                  — the llms.txt boot file (llmstxt.org), lists
 *                                      every present article grouped by category
 *
 * Place identity (name, domain, categories) flows from place.config.ts — zero
 * hardcoded strings (genericity gate, ADR 002).
 */
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import matter from 'gray-matter';

const ROOT = process.cwd();
const placeConfig = (await import(resolve(ROOT, 'place.config.ts'))).default;

const { name: placeName, domain, tagline } = placeConfig.place;
const { repo } = placeConfig.links;
const SITE = `https://${domain}`;
// Site display name mirrors Layout.astro: "<Name>.<tld>" (e.g. domain foo.md → .md).
const siteName = `${placeName}${'.' + domain.split('.').pop()}`;

// slug → knowledge/ folder title (folders are the config category titles).
const CATEGORIES = placeConfig.categories.map((c) => ({
  slug: c.slug,
  title: c.title,
}));

const KB_DIR = resolve(ROOT, 'public', 'kb');
const ARTICLES_DIR = join(KB_DIR, 'articles');

function readingTimeFromBody(body) {
  const words = body.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  return Math.max(1, Math.round(words.length / 200));
}

async function scan() {
  const articles = [];
  for (const { slug, title } of CATEGORIES) {
    const dir = resolve(ROOT, 'knowledge', title);
    let files;
    try {
      files = (await readdir(dir)).filter(
        (f) => f.endsWith('.md') && !f.startsWith('_'),
      );
    } catch {
      continue; // category folder not present yet
    }
    for (const file of files) {
      const raw = await readFile(join(dir, file), 'utf-8');
      const { data, content } = matter(raw);
      const name = basename(file, '.md');
      const tags = Array.isArray(data.tags)
        ? data.tags
        : data.tags
          ? [data.tags]
          : [];
      articles.push({
        title: data.title || name,
        description: data.description || '',
        category: slug,
        tags,
        url: `/${slug}/${name}`,
        kb: `/kb/articles/${slug}/${name}.md`,
        readingTime: readingTimeFromBody(content),
        date:
          data.date instanceof Date
            ? data.date.toISOString()
            : data.date
              ? String(data.date)
              : null,
        featured: data.featured === true || data.featured === 'true',
        raw, // carried for the per-article .md emit; stripped from topics.json
      });
    }
  }
  articles.sort((a, b) => a.title.localeCompare(b.title, 'en'));
  return articles;
}

const articles = await scan();

// Fresh output tree (idempotent; drops articles removed from knowledge/). Clean
// only THIS script's outputs — public/kb/ is shared with build-search-index.mjs,
// which runs concurrently in the prebuild run-p group; rm-ing all of public/kb
// here would race-delete the search indexes.
await rm(ARTICLES_DIR, { recursive: true, force: true });
await mkdir(ARTICLES_DIR, { recursive: true });

// ── topics.json ──
const topics = articles.map(({ raw, ...meta }) => meta);
await writeFile(join(KB_DIR, 'topics.json'), JSON.stringify(topics), 'utf-8');

// ── per-article raw markdown ──
for (const a of articles) {
  const dest = join(ARTICLES_DIR, a.category, `${basename(a.url)}.md`);
  await mkdir(resolve(dest, '..'), { recursive: true });
  await writeFile(dest, a.raw, 'utf-8');
}

// ── llms.txt ──
const byCat = new Map(CATEGORIES.map((c) => [c.slug, []]));
for (const a of articles) byCat.get(a.category)?.push(a);

const catTitle = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c.title]));
const lines = [];
lines.push(`# ${siteName}`);
lines.push('');
lines.push(`> ${tagline}`);
lines.push(`> Website: ${SITE} | GitHub: ${repo}`);
lines.push('> This file follows the llms.txt convention (https://llmstxt.org/).');
lines.push('');
lines.push('## Machine endpoints');
lines.push('');
lines.push(`- Topics index: ${SITE}/kb/topics.json`);
lines.push(`- Full-text search index: ${SITE}/kb/search-index.json`);
lines.push(`- Per-article markdown: ${SITE}/kb/articles/{category}/{slug}.md`);
lines.push('');
lines.push(`## Articles (${articles.length})`);
lines.push('');
for (const { slug } of CATEGORIES) {
  const list = byCat.get(slug) || [];
  if (list.length === 0) continue;
  lines.push(`### ${catTitle[slug]}`);
  lines.push('');
  for (const a of list) {
    const desc = a.description ? `: ${a.description}` : '';
    lines.push(`- [${a.title}](${SITE}${a.url})${desc} — raw: ${a.kb}`);
  }
  lines.push('');
}
await writeFile(resolve(ROOT, 'public', 'llms.txt'), lines.join('\n'), 'utf-8');

console.log(
  `[kb-index] ${articles.length} articles → topics.json + articles/*.md + llms.txt`,
);
