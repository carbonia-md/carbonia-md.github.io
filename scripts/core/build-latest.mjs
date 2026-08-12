/**
 * build-latest.mjs — src/data/latest.json (newest-first article timeline data).
 *
 * Source of truth: knowledge/ frontmatter joined with src/data/content-dates.json
 * (git last-content-change time → accurate "shipped" ordering, not hand-set
 * frontmatter dates). Falls back to frontmatter.date when an article has no git
 * content date yet, so the /latest page is never spuriously empty.
 *
 * Consumed (server-side, build-time import) by src/pages/latest.astro.
 * Categories + languages flow from place.config.ts (genericity gate). Runs AFTER
 * content-dates in the prebuild chain; non-fatal on error.
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
const LANGS = placeConfig.place.languages?.length
  ? placeConfig.place.languages
  : ['en'];
const DEFAULT_LANG = LANGS[0];
const PER_LANG = 240;

const urlKey = (lang, cat, slug) =>
  lang === DEFAULT_LANG ? `/${cat}/${slug}/` : `/${lang}/${cat}/${slug}/`;
const href = (lang, cat, slug) => {
  const enc = encodeURIComponent(slug);
  return lang === DEFAULT_LANG ? `/${cat}/${enc}` : `/${lang}/${cat}/${enc}`;
};

async function main() {
  let dates = {};
  try {
    const raw = await readFile(resolve(ROOT, 'src/data/content-dates.json'), 'utf-8');
    dates = JSON.parse(raw).dates ?? {};
  } catch {
    // content-dates not built yet — frontmatter dates carry ordering.
  }

  await mkdir(resolve(ROOT, 'src/data'), { recursive: true });

  const byLang = {};
  for (const lang of LANGS) {
    const items = [];
    for (const { slug: catSlug, title } of CATEGORIES) {
      const dir =
        lang === DEFAULT_LANG
          ? resolve(ROOT, 'knowledge', title)
          : resolve(ROOT, 'knowledge', lang, title);
      let files;
      try {
        files = await readdir(dir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith('.md') || f.startsWith('_')) continue;
        const slug = basename(f, '.md');
        let fm = {};
        try {
          fm = matter(await readFile(join(dir, f), 'utf-8')).data ?? {};
        } catch {
          /* unreadable frontmatter — fall back to slug title */
        }
        // NFC-normalize the key slug to match build-content-dates.mjs's keys
        // (git paths can be NFD); frontmatter-date fallback normalized to ISO —
        // gray-matter parses an unquoted YAML date to a JS Date, whose String()
        // is a non-ISO form that would break lexicographic date sort + day-grouping.
        const gitDate = dates[urlKey(lang, catSlug, slug.normalize('NFC'))];
        const fmDate =
          fm.date instanceof Date ? fm.date.toISOString() : fm.date ? String(fm.date) : null;
        const date = gitDate || fmDate;
        if (!date) continue; // no git date and no frontmatter date → skip
        const tags = Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : [];
        items.push({
          title: fm.title || slug,
          description: fm.description || '',
          category: catSlug,
          slug,
          href: href(lang, catSlug, slug),
          date,
          readingTime: fm.readingTime || null,
          image: fm.image || '',
          tags,
        });
      }
    }
    items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    byLang[lang] = items.slice(0, PER_LANG);
  }

  const out = { _generated: new Date().toISOString(), perLang: PER_LANG, byLang };
  await writeFile(resolve(ROOT, 'src/data/latest.json'), JSON.stringify(out));
  const total = Object.values(byLang).reduce((s, a) => s + a.length, 0);
  console.log(`✓ latest.json: ${total} entries across ${LANGS.length} lang(s)`);
}

main().catch((e) => {
  console.error('build-latest.mjs failed (non-fatal):', e.message);
});
