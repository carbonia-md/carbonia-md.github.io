/**
 * check-map-markers.mjs — contract test for src/data/map-markers.geojson.
 *
 * The map page (src/templates/map.template.astro) and downstream consumers rely on
 * the marker file being a valid GeoJSON FeatureCollection whose every feature is a
 * Point with the exact property set {slug, title, category, description, area} and
 * an in-range [lng, lat] coordinate. This asserts that shape and exits 1 on any
 * violation, so a regression in build-map-markers.mjs fails the build instead of
 * silently shipping a broken map. Runs in the postbuild chain (npm run build) and
 * standalone. Categories are validated against place.config.ts (genericity gate).
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const placeConfig = (await import(resolve(ROOT, 'place.config.ts'))).default;
const CATEGORY_SLUGS = new Set(placeConfig.categories.map((c) => c.slug));
const FILE = resolve(ROOT, 'src/data/map-markers.geojson');
const REQUIRED_PROPS = ['slug', 'title', 'category', 'description', 'area'];

const errors = [];

let data;
try {
  data = JSON.parse(await readFile(FILE, 'utf-8'));
} catch (e) {
  console.error(`❌ map-markers check FAILED: cannot read/parse ${FILE}: ${e.message}`);
  process.exit(1);
}

if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
  errors.push('root is not a FeatureCollection with a features array');
}

for (const [i, f] of (data.features ?? []).entries()) {
  const where = `feature[${i}]${f?.properties?.slug ? ` (${f.properties.slug})` : ''}`;
  if (f?.type !== 'Feature') errors.push(`${where}: type is not "Feature"`);

  const g = f?.geometry;
  if (g?.type !== 'Point' || !Array.isArray(g.coordinates) || g.coordinates.length !== 2) {
    errors.push(`${where}: geometry is not a 2-element Point`);
  } else {
    const [lng, lat] = g.coordinates;
    if (!Number.isFinite(lng) || lng < -180 || lng > 180)
      errors.push(`${where}: longitude out of range (${lng})`);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90)
      errors.push(`${where}: latitude out of range (${lat})`);
  }

  const props = f?.properties ?? {};
  for (const key of REQUIRED_PROPS) {
    if (!(key in props)) errors.push(`${where}: missing property "${key}"`);
  }
  if (props.category && !CATEGORY_SLUGS.has(props.category)) {
    errors.push(`${where}: category "${props.category}" is not a configured slug`);
  }
}

if (errors.length) {
  console.log(`\n🔴 ${errors.length} error(s) in map-markers.geojson:`);
  errors.forEach((e) => console.log(`   - ${e}`));
  console.log('\n❌ map-markers check FAILED. Build blocked.');
  process.exit(1);
}

const n = data.features.length;
const colors = new Set(data.features.map((f) => f.properties.category)).size;
console.log(`✅ map-markers check passed: ${n} valid Point feature(s), ${colors} categor(ies).`);
