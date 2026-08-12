/**
 * build-map-markers.mjs — src/data/map-markers.geojson (Leaflet marker source).
 *
 * Rewrite of the fork's generate-map-markers.js, stripped of every place-specific
 * heuristic it carried: the geocode lookup table, the neighborhood lat/lng bands,
 * landmark match-scoring, filename→category inference, and the hardcoded category
 * map. None of that survives — a marker exists iff an article declares an explicit
 * `geo:` line, and category is read straight off the content path.
 *
 * Source of truth: src/content/en/<category-slug>/<slug>.md (the synced
 * projection of knowledge/, written by scripts/core/sync.sh). Category is the
 * article's parent-directory slug, validated against place.config.categories.
 * Marker colors are deliberately NOT baked in here — the map page maps
 * category → color via src/utils/categoryConfig.ts, so this file stays
 * place-agnostic and the emitted GeoJSON never encodes a palette.
 *
 * `geo` frontmatter schema: "Name,lat,lng,Area" (Area, the 4th field, optional —
 * SPEC §Content model). Articles without a parseable `geo` line are simply
 * absent from the map; there is no auto-geocoding fallback.
 *
 * Emits a GeoJSON FeatureCollection, one Point Feature per geo-carrying article:
 *   properties = { slug, title, category, description, area }
 *   geometry   = { type: 'Point', coordinates: [lng, lat] }
 *
 * Runs in the run-p prebuild group and writes ONLY its own file
 * (.agent-toolkit/rules/prebuild-parallel-no-sibling-rm.md). Consumed at build time by
 * src/templates/map.template.astro; the public sibling public/data/boundary.geojson
 * feeds the same page and, downstream, 5.5's SystemDiagram. Non-fatal on error,
 * but always writes a valid (possibly empty) FeatureCollection so the map page's
 * build-time import never breaks the build.
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import matter from 'gray-matter';

const ROOT = process.cwd();
const placeConfig = (await import(resolve(ROOT, 'place.config.ts'))).default;
const CONTENT_DIR = resolve(ROOT, 'src/content/en');
const OUT = resolve(ROOT, 'src/data/map-markers.geojson');

// place.config is the only source of truth for valid category slugs.
const CATEGORY_SLUGS = new Set(placeConfig.categories.map((c) => c.slug));

/** Parse a `geo: "Name,lat,lng,Area"` value. Area (4th field) is optional. */
function parseGeo(raw) {
  if (typeof raw !== 'string') return null;
  const parts = raw.split(',').map((s) => s.trim());
  if (parts.length < 3) return null;
  const [name, latStr, lngStr, area = ''] = parts;
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { name, lat, lng, area };
}

async function main() {
  await mkdir(resolve(ROOT, 'src/data'), { recursive: true });

  const features = [];
  let entries = [];
  try {
    entries = await readdir(CONTENT_DIR, { withFileTypes: true });
  } catch {
    // No synced content yet — fall through and emit an empty collection.
  }

  for (const entry of entries) {
    // Category dirs only; root-level files carry no category and are skipped.
    if (!entry.isDirectory() || !CATEGORY_SLUGS.has(entry.name)) continue;
    const category = entry.name;
    const dir = join(CONTENT_DIR, category);

    let files;
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.md') || file.startsWith('_')) continue;
      const slug = file.slice(0, -3);

      let fm = {};
      try {
        fm = matter(await readFile(join(dir, file), 'utf-8')).data ?? {};
      } catch {
        continue; // unreadable frontmatter — skip
      }

      const geo = parseGeo(fm.geo);
      if (!geo) continue; // no coordinates → not placed on the map

      features.push({
        type: 'Feature',
        properties: {
          slug,
          title: fm.title || slug,
          category,
          description: fm.description || '',
          area: geo.area,
        },
        geometry: { type: 'Point', coordinates: [geo.lng, geo.lat] },
      });
    }
  }

  // Deterministic order (category, then slug) so the emitted file is stable.
  features.sort(
    (a, b) =>
      a.properties.category.localeCompare(b.properties.category) ||
      a.properties.slug.localeCompare(b.properties.slug),
  );

  await writeFile(OUT, JSON.stringify({ type: 'FeatureCollection', features }));
  console.log(`✓ map-markers.geojson: ${features.length} marker(s)`);
}

main().catch((e) => {
  console.error('build-map-markers.mjs failed (non-fatal):', e.message);
});
