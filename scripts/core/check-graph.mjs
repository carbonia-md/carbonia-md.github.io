/**
 * check-graph.mjs — contract test for the /graph knowledge graph.
 *
 * The graph page (src/pages/graph.astro) emits its node/edge set as an
 * application/json island (<script id="graph-data">) that the client parses to
 * draw the D3 force graph. This asserts, per enabled language (the default language
 * at dist/graph/, the others at dist/{lang}/graph/), over the emitted JSON in the built page:
 *
 *   - one hub node per configured place.config category,
 *   - one article node per synced article under src/content/{lang}, and
 *   - at least one edge per node (the graph is wired, not a dust cloud),
 *
 * exiting 1 on any violation so a regression in the graph builder fails the build
 * instead of silently shipping an empty or malformed graph. Runs in the postbuild
 * chain (npm run build) and standalone. Categories flow from place.config.ts.
 */
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();
const placeConfig = (await import(resolve(ROOT, 'place.config.ts'))).default;
const CATEGORY_SLUGS = placeConfig.categories.map((c) => c.slug);
const LANGS = placeConfig.place.languages?.length
  ? placeConfig.place.languages
  : ['en'];
const DEFAULT_LANG = LANGS[0];

// ── Count synced articles on disk (the page's getCollection(lang) input) ──
async function countArticles(dir, cat) {
  let n = 0;
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) n += await countArticles(full, cat ?? entry.name);
      else if (
        entry.name.endsWith('.md') &&
        !entry.name.startsWith('_') &&
        CATEGORY_SLUGS.includes(cat)
      )
        n++;
    }
  } catch {}
  return n;
}

const summaries = [];
let failed = false;

for (const lang of LANGS) {
  const isDefault = lang === DEFAULT_LANG;
  const label = `[${lang}]`;
  const PAGE = isDefault
    ? resolve(ROOT, 'dist/graph/index.html')
    : resolve(ROOT, 'dist', lang, 'graph/index.html');
  const CONTENT_DIR = resolve(ROOT, 'src/content', lang);
  const errors = [];

  // ── 1. Extract the emitted graph-data island ──
  let graph;
  try {
    const html = await readFile(PAGE, 'utf-8');
    const m = html.match(
      /<script type="application\/json" id="graph-data"[^>]*>([\s\S]*?)<\/script>/,
    );
    if (!m) {
      console.error(`❌ graph check FAILED ${label}: no #graph-data island in ${PAGE}`);
      process.exit(1);
    }
    graph = JSON.parse(m[1]);
  } catch (e) {
    console.error(`❌ graph check FAILED ${label}: cannot read/parse ${PAGE}: ${e.message}`);
    process.exit(1);
  }

  if (!Array.isArray(graph?.nodes) || !Array.isArray(graph?.edges)) {
    console.error(`❌ graph check FAILED ${label}: graph data lacks nodes[]/edges[] arrays`);
    process.exit(1);
  }

  const syncedArticles = await countArticles(CONTENT_DIR, null);

  // ── Classify emitted nodes ──
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  // Hub nodes: id is exactly a category slug.
  const hubIds = new Set(graph.nodes.filter((n) => CATEGORY_SLUGS.includes(n.id)).map((n) => n.id));
  // Article nodes: url of the form /{cat}/{slug} after dropping the /{lang} prefix
  // (hubs are /{cat}; specials /about).
  const prefix = isDefault ? '' : `/${lang}`;
  const articleNodes = graph.nodes.filter(
    (n) =>
      typeof n.url === 'string' &&
      n.url.startsWith(prefix) &&
      /^\/[^/]+\/.+/.test(n.url.slice(prefix.length)),
  );

  // ── Assertions ──
  for (const slug of CATEGORY_SLUGS) {
    if (!hubIds.has(slug)) errors.push(`missing hub node for category "${slug}"`);
  }
  if (articleNodes.length !== syncedArticles) {
    errors.push(
      `article node count (${articleNodes.length}) != synced articles on disk (${syncedArticles})`,
    );
  }
  // Every edge endpoint must resolve to a real node.
  for (const [i, e] of graph.edges.entries()) {
    if (!nodeIds.has(e.source)) errors.push(`edge[${i}] source "${e.source}" is not a node`);
    if (!nodeIds.has(e.target)) errors.push(`edge[${i}] target "${e.target}" is not a node`);
  }
  // The graph must be wired: at least one edge per node (center fans out to hubs,
  // hubs to articles). A near-zero edge count means the builder collapsed.
  if (graph.edges.length < graph.nodes.length - 1) {
    errors.push(
      `only ${graph.edges.length} edge(s) for ${graph.nodes.length} node(s) — graph looks disconnected`,
    );
  }

  if (errors.length) {
    console.log(`\n🔴 ${errors.length} error(s) in /graph data ${label}:`);
    errors.forEach((e) => console.log(`   - ${e}`));
    failed = true;
  } else {
    summaries.push(
      `${label} ${graph.nodes.length} nodes (${hubIds.size} hubs, ${articleNodes.length} articles), ${graph.edges.length} edges`,
    );
  }
}

if (failed) {
  console.log('\n❌ graph check FAILED. Build blocked.');
  process.exit(1);
}

console.log(`✅ graph check passed: ${summaries.join('; ')}.`);
