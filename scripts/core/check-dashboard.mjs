/**
 * check-dashboard.mjs — postbuild contract test for /dashboard.
 *
 * Asserts:
 *   - dist/dashboard/index.html exists and is non-empty
 *   - When src/data/dashboard-lite.json has available:true, the rendered page
 *     contains the rollup totals and immune score from that JSON.
 *   - When available:false (or JSON absent), the page contains the degraded marker.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const PAGE = resolve(ROOT, 'dist/dashboard/index.html');
const DATA = resolve(ROOT, 'src/data/dashboard-lite.json');

const errors = [];

if (!existsSync(PAGE)) {
  console.error('❌ dashboard check FAILED: dist/dashboard/index.html does not exist');
  process.exit(1);
}

const html = readFileSync(PAGE, 'utf8');
if (html.length < 100) {
  console.error('❌ dashboard check FAILED: dist/dashboard/index.html is effectively empty');
  process.exit(1);
}

let dashData = null;
if (existsSync(DATA)) {
  try {
    dashData = JSON.parse(readFileSync(DATA, 'utf8'));
  } catch (e) {
    errors.push(`cannot parse ${DATA}: ${e.message}`);
  }
}

if (dashData?.available === true) {
  const { rollup, immune } = dashData;
  if (rollup) {
    if (!html.includes(String(rollup.total))) {
      errors.push(`rollup.total (${rollup.total}) not found in rendered page`);
    }
    if (!html.includes(`${rollup.passRate}%`)) {
      errors.push(`rollup.passRate (${rollup.passRate}%) not found in rendered page`);
    }
  } else {
    errors.push('dashData.available=true but rollup is null');
  }
  if (immune) {
    if (!html.includes(String(immune.score))) {
      errors.push(`immune.score (${immune.score}) not found in rendered page`);
    }
  } else {
    errors.push('dashData.available=true but immune is null');
  }
} else {
  if (!html.includes('data-degraded')) {
    errors.push('dashboard JSON unavailable but degraded marker not found in page');
  }
}

if (errors.length) {
  console.error(`❌ dashboard check FAILED:\n${errors.map(e => `   - ${e}`).join('\n')}`);
  process.exit(1);
}

console.log('✅ dashboard check passed: page renders expected data.');
