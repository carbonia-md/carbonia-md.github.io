/**
 * check-internal-links.mjs — post-build internal-link verifier.
 *
 * Scans every built HTML page under dist/ and validates each internal
 * navigation link (<a href="/...">) resolves to a real built file. Catches the
 * real failure mode: a getStaticPaths drop or a typo'd cross-reference producing
 * a dead link INTO a namespace the site already builds (e.g. /history/<gone>).
 *
 * A link into a KNOWN planned namespace not yet delivered (PLANNED_ROUTES, from
 * SPEC §Pages — /graph, /map, /dashboard, /changelog, /about, /contribute) is
 * pending, not broken; the check self-adjusts as each phase adds its route. But
 * a link into a namespace that is neither built nor planned is a typo/orphan and
 * IS reported. Only <a> navigation is checked (not <link>/asset hrefs).
 *
 * Exit 1 if broken links >= BROKEN_LINK_THRESHOLD (default 0) or dist/ missing.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();
const DIST = resolve(ROOT, 'dist');
const THRESHOLD = Number(process.env.BROKEN_LINK_THRESHOLD || 0);

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (e.name.endsWith('.html')) out.push(full);
  }
  return out;
}

async function isFile(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

// Top-level route namespaces the build actually produced (dist/ subdirectories).
const builtTopDirs = new Set(
  (await readdir(DIST, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name),
);

// Top-level page namespaces later phases deliver (SPEC §Pages). A link into one
// of these that does not resolve yet is pending, not broken. A link into a
// namespace that is neither built NOR planned is a typo/orphan → broken.
const PLANNED_ROUTES = new Set([
  'graph',
  'map',
  'changelog',
  'about',
  'contribute',
  'explore',
  'latest',
]);

async function resolves(pathname) {
  let clean = pathname.split('#')[0].split('?')[0];
  try {
    clean = decodeURIComponent(clean);
  } catch {
    return false;
  }
  if (clean === '/') return isFile(join(DIST, 'index.html'));
  const noSlash = clean.replace(/\/$/, '');
  const fsPath = join(DIST, noSlash);
  if (/\.[a-z0-9]+$/i.test(noSlash)) return isFile(fsPath); // asset
  return (await isFile(join(fsPath, 'index.html'))) || (await isFile(`${fsPath}.html`));
}

const pages = await walk(DIST);
if (pages.length === 0) {
  console.error('ERROR: no HTML pages under dist/ — run the build first.');
  process.exit(1);
}

// Only <a> navigation hrefs (not <link rel=icon>/<script src> etc.).
const anchorRe = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
const broken = new Map(); // href -> count
const pending = new Set(); // future-phase namespaces skipped (reported as info)
let checked = 0;

for (const page of pages) {
  const html = await readFile(page, 'utf-8');
  const seen = new Set();
  let m;
  while ((m = anchorRe.exec(html))) {
    const href = m[1];
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    const key = href.split('#')[0].split('?')[0];
    if (!key || key === '/' || seen.has(key)) continue;
    seen.add(key);
    checked++;
    if (await resolves(href)) continue;
    const firstSeg = key.replace(/^\//, '').split('/')[0];
    // Broken if the namespace is already built (page should exist) OR is neither
    // built nor a planned SPEC route (a typo/orphan). Pending only when it is a
    // known planned route not delivered yet.
    if (PLANNED_ROUTES.has(firstSeg) && !builtTopDirs.has(firstSeg)) {
      pending.add(`/${firstSeg}`);
    } else {
      broken.set(key, (broken.get(key) || 0) + 1);
    }
  }
}

console.log(`🔗 internal-links: checked ${checked} unique links across ${pages.length} pages`);
if (pending.size) {
  console.log(
    `   (skipped ${pending.size} pending future-phase namespace(s): ${[...pending].sort().join(', ')})`,
  );
}
if (broken.size > THRESHOLD) {
  console.error(`\n🔴 ${broken.size} broken internal link(s) into built namespaces:`);
  for (const [href, count] of [...broken].sort((a, b) => b[1] - a[1])) {
    console.error(`   - ${href}  (${count} page${count > 1 ? 's' : ''})`);
  }
  process.exit(1);
}
console.log(`✅ internal-links passed (${broken.size} broken, threshold ${THRESHOLD}).`);
