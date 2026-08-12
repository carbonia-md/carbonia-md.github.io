/**
 * post-build-check.mjs — post-build smoke test.
 *
 * Catches silent build collapse (getStaticPaths returning 0 paths, empty catch
 * swallowing errors, a category hub rendering a placeholder instead of its cards).
 * Exit code 1 = CI must NOT deploy.
 *
 * Categories flow from place.config.ts (genericity gate). Scaled for any corpus
 * size: it does NOT require every category to be populated (false at fixture
 * scale) — it verifies the build produced the expected structural surfaces and
 * that populated categories actually render article cards.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();
const placeConfig = (await import(resolve(ROOT, 'place.config.ts'))).default;
const DIST = resolve(ROOT, 'dist');
const CATEGORIES = placeConfig.categories.map((c) => c.slug);

// Floor scales with the category set; below it, getStaticPaths likely collapsed.
const MIN_TOTAL_PAGES = CATEGORIES.length + 3;

const errors = [];
const warnings = [];

async function countHtml(dir) {
  let count = 0;
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) count += await countHtml(full);
      else if (entry.name.endsWith('.html')) count++;
    }
  } catch {}
  return count;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// ── 1. Total pages above collapse floor ──
const totalPages = await countHtml(DIST);
console.log(`📊 Total HTML pages: ${totalPages}`);
if (totalPages < MIN_TOTAL_PAGES) {
  errors.push(
    `Total pages (${totalPages}) below floor (${MIN_TOTAL_PAGES}). Likely a getStaticPaths failure.`,
  );
}

// ── 2. Structural surfaces this task and the shell must produce ──
const REQUIRED = [
  ['home', 'index.html'],
  ['explore', 'explore/index.html'],
  ['latest', 'latest/index.html'],
  ['404', '404.html'],
];
for (const [label, rel] of REQUIRED) {
  if (!(await exists(join(DIST, rel)))) errors.push(`missing ${label} page (dist/${rel})`);
}

// ── 3. Every configured category has a hub; populated ones render cards ──
for (const cat of CATEGORIES) {
  const catDir = join(DIST, cat);
  const indexPath = join(catDir, 'index.html');
  if (!(await exists(indexPath))) {
    errors.push(`/${cat}/ hub missing in dist/`);
    continue;
  }
  let articleDirs = [];
  try {
    articleDirs = (await readdir(catDir, { withFileTypes: true })).filter(
      (e) => e.isDirectory() && e.name !== 'index',
    );
  } catch {}
  if (articleDirs.length === 0) {
    console.log(`  · /${cat}/: hub only (no articles at this corpus size)`);
    continue;
  }
  // Populated category: hub must show article cards, and a sample article must be real.
  const html = await readFile(indexPath, 'utf-8');
  if (!html.includes('article-card') && !html.includes('articlesGrid')) {
    errors.push(`/${cat}/index.html has articles on disk but renders no article cards`);
  }
  const sampleHtml = join(catDir, articleDirs[0].name, 'index.html');
  if (await exists(sampleHtml)) {
    const s = await stat(sampleHtml);
    if (s.size < 1024) {
      warnings.push(`/${cat}/${articleDirs[0].name}/index.html suspiciously small (${s.size}B)`);
    }
  }
  console.log(`  ✅ /${cat}/: ${articleDirs.length} article(s)`);
}

// ── Report ──
if (warnings.length) {
  console.log(`\n⚠️  ${warnings.length} warning(s):`);
  warnings.forEach((w) => console.log(`   - ${w}`));
}
if (errors.length) {
  console.log(`\n🔴 ${errors.length} error(s):`);
  errors.forEach((e) => console.log(`   - ${e}`));
  console.log('\n❌ Post-build check FAILED. Deploy blocked.');
  process.exit(1);
}
console.log(`\n✅ Post-build check passed. ${totalPages} pages, all surfaces present.`);
