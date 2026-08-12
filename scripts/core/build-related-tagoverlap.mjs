/**
 * build-related-tagoverlap.mjs — deterministic related-articles via tag overlap
 * plus a wiki-link bonus. Emits src/data/related/en.json as { "cat/slug": ["cat/slug", ...] },
 * consumed by the article route → ArticleSidebar "Related" list.
 *
 * Categories flow from place.config.ts (genericity gate).
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import matter from 'gray-matter';

const ROOT = process.cwd();
const placeConfig = (await import(resolve(ROOT, 'place.config.ts'))).default;

const CATEGORIES = placeConfig.categories.map((c) => ({
  slug: c.slug,
  title: c.title,
}));
const TOP_K = 8;
const WIKI_LINK_BONUS = 2;

const args = process.argv.slice(2);
const outDir = resolve(ROOT, args[args.indexOf('--out') + 1] || 'src/data/related');

async function scanArticles() {
  const docs = [];
  for (const { slug, title } of CATEGORIES) {
    const dir = resolve(ROOT, 'knowledge', title);
    let files;
    try {
      files = (await readdir(dir)).filter(
        (f) => f.endsWith('.md') && !f.startsWith('_'),
      );
    } catch {
      continue;
    }
    for (const file of files) {
      const raw = await readFile(join(dir, file), 'utf-8');
      const { data, content } = matter(raw);
      const name = basename(file, '.md');
      const tags = Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : [];
      const wikiLinks = [...content.matchAll(/\[\[([^\]|]+)/g)].map((m) => m[1]);
      docs.push({
        slug: `${slug}/${name}`,
        tags: tags.map((t) => String(t).toLowerCase()),
        wikiLinks,
      });
    }
  }
  return docs;
}

function score(a, b) {
  let s = 0;
  const bTags = new Set(b.tags);
  for (const t of a.tags) if (bTags.has(t)) s++;
  const bName = b.slug.split('/')[1];
  if (a.wikiLinks.includes(bName)) s += WIKI_LINK_BONUS;
  const aName = a.slug.split('/')[1];
  if (b.wikiLinks.includes(aName)) s += WIKI_LINK_BONUS;
  return s;
}

const docs = await scanArticles();
const related = {};
for (const doc of docs) {
  related[doc.slug] = docs
    .filter((d) => d.slug !== doc.slug)
    .map((d) => ({ slug: d.slug, s: score(doc, d) }))
    .filter((d) => d.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, TOP_K)
    .map((d) => d.slug);
}

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'en.json'), JSON.stringify(related, null, 2));
console.log(`✅ tag-overlap: ${Object.keys(related).length} articles → ${outDir}/en.json`);
