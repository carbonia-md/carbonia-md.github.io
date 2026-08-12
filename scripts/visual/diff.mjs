#!/usr/bin/env node
/**
 * diff.mjs — visual regression diff
 *
 * Compares reports/visual/current/*.png against reports/visual/baseline/*.png
 * using pixelmatch. Emits:
 *   1. Per-file diff PNG into reports/visual/diff/
 *   2. HTML visual report at reports/visual/diff-report.html
 *   3. Summary JSON at reports/visual/diff-summary.json
 *   4. Exit code: 0 if all diffs below threshold, 1 if any regression
 *
 * Usage:
 *   node scripts/visual/diff.mjs                    # compare current to baseline
 *   node scripts/visual/diff.mjs --threshold=0.5    # diff ratio in percent (default 0.5)
 *   node scripts/visual/diff.mjs --tolerance=0.1    # per-pixel tolerance (default 0.1, 0-1)
 *
 * Typical flow:
 *   1. Capture baseline once: node scripts/visual/capture-baseline.mjs --baseline
 *   2. Do work, rebuild, restart preview
 *   3. Capture current:      node scripts/visual/capture-baseline.mjs
 *   4. Diff:                 node scripts/visual/diff.mjs
 */

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..', '..');

const baselineDir = join(repoRoot, 'reports', 'visual', 'baseline');
const currentDir = join(repoRoot, 'reports', 'visual', 'current');
const diffDir = join(repoRoot, 'reports', 'visual', 'diff');
const reportPath = join(repoRoot, 'reports', 'visual', 'diff-report.html');
const summaryPath = join(repoRoot, 'reports', 'visual', 'diff-summary.json');

// --- CLI ---

const args = process.argv.slice(2);
const getFlag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
};

const threshold = parseFloat(getFlag('threshold', '0.5'));
const tolerance = parseFloat(getFlag('tolerance', '0.1'));

// --- sanity checks ---

if (!existsSync(baselineDir)) {
  console.error(`\nBaseline directory missing: ${baselineDir}`);
  console.error(`   Run this first:`);
  console.error(`     node scripts/visual/capture-baseline.mjs --baseline\n`);
  process.exit(2);
}

if (!existsSync(currentDir)) {
  console.error(`\nCurrent directory missing: ${currentDir}`);
  console.error(`   Run this first:`);
  console.error(`     node scripts/visual/capture-baseline.mjs\n`);
  process.exit(2);
}

mkdirSync(diffDir, { recursive: true });

// --- core diff ---

function loadPng(path) {
  return PNG.sync.read(readFileSync(path));
}

function cropTopLeft(png, width, height) {
  const cropped = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * png.width + x) * 4;
      const dstIdx = (y * width + x) * 4;
      cropped.data[dstIdx] = png.data[srcIdx];
      cropped.data[dstIdx + 1] = png.data[srcIdx + 1];
      cropped.data[dstIdx + 2] = png.data[srcIdx + 2];
      cropped.data[dstIdx + 3] = png.data[srcIdx + 3];
    }
  }
  return cropped;
}

function diffPair(baselinePath, currentPath, diffPath) {
  const baseline = loadPng(baselinePath);
  const current = loadPng(currentPath);

  const widthDrift =
    Math.abs(baseline.width - current.width) /
    Math.max(baseline.width, current.width);
  const heightDrift =
    Math.abs(baseline.height - current.height) /
    Math.max(baseline.height, current.height);
  const STRUCTURAL_DRIFT_THRESHOLD = 0.1;

  if (
    widthDrift > STRUCTURAL_DRIFT_THRESHOLD ||
    heightDrift > STRUCTURAL_DRIFT_THRESHOLD
  ) {
    return {
      dimensionMismatch: true,
      baselineSize: `${baseline.width}x${baseline.height}`,
      currentSize: `${current.width}x${current.height}`,
      pixelsDifferent: baseline.width * baseline.height,
      totalPixels: baseline.width * baseline.height,
      ratio: 100,
    };
  }

  const width = Math.min(baseline.width, current.width);
  const height = Math.min(baseline.height, current.height);
  const baselineCropped =
    baseline.width !== width || baseline.height !== height
      ? cropTopLeft(baseline, width, height)
      : baseline;
  const currentCropped =
    current.width !== width || current.height !== height
      ? cropTopLeft(current, width, height)
      : current;

  const diff = new PNG({ width, height });

  const pixelsDifferent = pixelmatch(
    baselineCropped.data,
    currentCropped.data,
    diff.data,
    width,
    height,
    {
      threshold: tolerance,
      alpha: 0.2,
      includeAA: false,
    },
  );

  writeFileSync(diffPath, PNG.sync.write(diff));

  return {
    dimensionMismatch: false,
    baselineSize: `${baseline.width}x${baseline.height}`,
    currentSize: `${current.width}x${current.height}`,
    sizeDrift:
      baseline.width === current.width && baseline.height === current.height
        ? null
        : `${baseline.width}x${baseline.height} -> ${current.width}x${current.height}`,
    pixelsDifferent,
    totalPixels: width * height,
    ratio: (pixelsDifferent / (width * height)) * 100,
  };
}

// --- enumerate files ---

const baselineFiles = readdirSync(baselineDir).filter((f) =>
  f.endsWith('.png'),
);
const currentFiles = new Set(
  readdirSync(currentDir).filter((f) => f.endsWith('.png')),
);

if (baselineFiles.length === 0) {
  console.error(`\nNo baseline PNGs found in ${baselineDir}\n`);
  process.exit(2);
}

console.log(`\nVisual diff`);
console.log(`   baseline:   ${baselineFiles.length} PNGs`);
console.log(`   current:    ${currentFiles.size} PNGs`);
console.log(`   threshold:  ${threshold}% (>${threshold}% = regression)`);
console.log(`   tolerance:  ${tolerance} per-pixel\n`);

// --- compare each ---

const results = [];
let missingFromCurrent = 0;
let regressions = 0;

for (const file of baselineFiles.sort()) {
  const baselinePath = join(baselineDir, file);

  if (!currentFiles.has(file)) {
    results.push({
      file,
      status: 'missing',
      message: 'present in baseline but not in current',
    });
    console.log(`  ? ${file.padEnd(40)}  missing from current`);
    missingFromCurrent++;
    continue;
  }

  const currentPath = join(currentDir, file);
  const diffPath = join(diffDir, file);
  const result = diffPair(baselinePath, currentPath, diffPath);

  const status = result.dimensionMismatch
    ? 'dimension-mismatch'
    : result.ratio > threshold
      ? 'regression'
      : 'ok';

  results.push({
    file,
    status,
    ...result,
  });

  if (result.dimensionMismatch) {
    console.log(
      `  x ${file.padEnd(40)}  dimension mismatch ${result.baselineSize} -> ${result.currentSize}`,
    );
    regressions++;
  } else {
    const icon = status === 'ok' ? '+' : 'x';
    console.log(
      `  ${icon} ${file.padEnd(40)}  ${result.ratio.toFixed(3)}% (${result.pixelsDifferent} px)`,
    );
    if (status === 'regression') regressions++;
  }
}

// --- summary ---

const ratioStats = results
  .filter((r) => r.ratio !== undefined)
  .map((r) => r.ratio);
const maxRatio = ratioStats.length ? Math.max(...ratioStats) : 0;
const meanRatio = ratioStats.length
  ? ratioStats.reduce((a, b) => a + b, 0) / ratioStats.length
  : 0;

const summary = {
  generatedAt: new Date().toISOString(),
  threshold,
  tolerance,
  total: baselineFiles.length,
  okCount: results.filter((r) => r.status === 'ok').length,
  regressionCount: regressions,
  missingCount: missingFromCurrent,
  maxRatio,
  meanRatio,
  results,
};

writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

// --- HTML report ---

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Visual diff report</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 1200px; margin: 2rem auto; padding: 0 1rem; color: #1a1a2e; }
  h1 { font-size: 1.5rem; }
  .summary { background: #f8fafc; padding: 1rem 1.5rem; border-radius: 12px; margin-bottom: 2rem; }
  .summary p { margin: 0.3rem 0; }
  .ok { color: #16a34a; }
  .regression { color: #dc2626; font-weight: 600; }
  .warn { color: #d97706; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.6rem; border-bottom: 1px solid #e5e7eb; font-size: 0.9rem; }
  th { background: #f8fafc; }
  .triad { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin: 1rem 0 2rem; }
  .triad figure { margin: 0; }
  .triad img { width: 100%; border: 1px solid #e5e7eb; border-radius: 8px; }
  .triad figcaption { font-size: 0.8rem; color: #64748b; margin-top: 4px; }
  details { margin: 1rem 0; border: 1px solid #e5e7eb; border-radius: 8px; padding: 0.5rem 1rem; }
  details summary { cursor: pointer; font-weight: 600; padding: 0.3rem 0; }
  details summary.regression { color: #dc2626; }
  details summary.ok { color: #16a34a; }
</style>
</head>
<body>
<h1>Visual diff report</h1>
<div class="summary">
  <p><strong>Generated:</strong> ${summary.generatedAt}</p>
  <p><strong>Threshold:</strong> ${threshold}% (regression) / <strong>tolerance:</strong> ${tolerance}</p>
  <p><strong>Total:</strong> ${summary.total} /
     <span class="ok">${summary.okCount} OK</span> /
     <span class="regression">${summary.regressionCount} regression</span> /
     <span class="warn">${summary.missingCount} missing</span>
  </p>
  <p><strong>Max diff:</strong> ${maxRatio.toFixed(3)}% / <strong>Mean diff:</strong> ${meanRatio.toFixed(3)}%</p>
</div>

<table>
<thead>
<tr><th>File</th><th>Status</th><th>Diff</th></tr>
</thead>
<tbody>
${results
  .map(
    (r) => `<tr>
      <td>${r.file}</td>
      <td class="${r.status === 'ok' ? 'ok' : r.status === 'regression' || r.status === 'dimension-mismatch' ? 'regression' : 'warn'}">${r.status}</td>
      <td>${
        r.dimensionMismatch
          ? `dim ${r.baselineSize} -> ${r.currentSize}`
          : r.ratio !== undefined
            ? r.ratio.toFixed(3) + '%'
            : '-'
      }</td>
    </tr>`,
  )
  .join('\n')}
</tbody>
</table>

${results
  .filter((r) => r.status !== 'ok')
  .map(
    (r) => `
<details open>
  <summary class="${r.status === 'regression' || r.status === 'dimension-mismatch' ? 'regression' : 'ok'}">
    ${r.file} - ${r.status}${r.ratio !== undefined ? ` (${r.ratio.toFixed(3)}%)` : ''}
  </summary>
  ${
    r.status !== 'missing'
      ? `<div class="triad">
    <figure><img src="baseline/${r.file}" alt="baseline"><figcaption>baseline</figcaption></figure>
    <figure><img src="current/${r.file}" alt="current"><figcaption>current</figcaption></figure>
    <figure><img src="diff/${r.file}" alt="diff"><figcaption>diff</figcaption></figure>
  </div>`
      : `<p>Missing from current. Was the page removed?</p>`
  }
</details>`,
  )
  .join('\n')}
</body>
</html>
`;

writeFileSync(reportPath, html);

// --- final output ---

console.log(`\nSummary`);
console.log(`   ok:          ${summary.okCount}`);
console.log(`   regression:  ${summary.regressionCount}`);
console.log(`   missing:     ${summary.missingCount}`);
console.log(`   max diff:    ${maxRatio.toFixed(3)}%`);
console.log(`   mean diff:   ${meanRatio.toFixed(3)}%`);
console.log(`\n   HTML report:   ${reportPath.replace(repoRoot + '/', '')}`);
console.log(`   Summary JSON:  ${summaryPath.replace(repoRoot + '/', '')}\n`);

if (regressions > 0 || missingFromCurrent > 0) {
  console.log(
    `FAIL ${regressions} regression(s), ${missingFromCurrent} missing\n`,
  );
  process.exit(1);
}

console.log(`PASS All diffs below threshold.\n`);
process.exit(0);
