#!/usr/bin/env node
/**
 * capture-baseline.mjs — visual baseline capture
 *
 * Captures configured pages x viewports as PNGs from a running preview server.
 * Used as the "before" snapshot for refactor PRs; regressions caught by diff.mjs.
 *
 * Usage:
 *   node scripts/visual/capture-baseline.mjs                # capture into reports/visual/current/
 *   node scripts/visual/capture-baseline.mjs --baseline     # capture into reports/visual/baseline/
 *   node scripts/visual/capture-baseline.mjs --url=http://localhost:4322
 *   node scripts/visual/capture-baseline.mjs --only=/latest/
 *   node scripts/visual/capture-baseline.mjs --pages=home,hub
 *
 * Env:
 *   BASE_URL          override server URL (default http://localhost:4321)
 *   HEADED=1          run browsers in headed mode
 *
 * Prereqs:
 *   - `npm run build && npm run preview` must be running in another shell
 *   - `npx playwright install chromium` has been run once
 */

import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..', '..');

// --- config ---

const placeConfig = (await import(resolve(repoRoot, 'place.config.ts'))).default;

// Nine of the pages below are fixed routes. The two that need a CONTENT url — one
// article, one category hub — are derived, because this file is framework-owned and
// a literal slug is correct for exactly one place. The article is the
// lexicographically FIRST href, never the newest: latest.json is date-ordered, so
// "newest" moves the moment an article ships and the diff would compare a baseline
// against a different page.
const lang = placeConfig.place.languages?.[0] || 'en';
const latestPath = join(repoRoot, 'src', 'data', 'latest.json');
let latest;
try {
  latest = JSON.parse(readFileSync(latestPath, 'utf-8'));
} catch (err) {
  throw new Error(`Cannot read ${latestPath} (${err.message}) — run \`npm run build\` first.`);
}
const articleHref = (latest.byLang?.[lang] ?? []).map((e) => e.href).sort()[0];
if (!articleHref) throw new Error(`latest.json has no articles for lang "${lang}".`);

const PAGES = [
  { name: 'home', url: '/' },
  { name: 'article', url: `${articleHref.replace(/\/$/, '')}/` },
  { name: 'hub', url: `/${placeConfig.categories[0].slug}/` },
  { name: 'explore', url: '/explore/' },
  { name: 'latest', url: '/latest/' },
  { name: 'graph', url: '/graph/' },
  { name: 'map', url: '/map/' },
  { name: 'dashboard', url: '/dashboard/' },
  { name: 'about', url: '/about/' },
  { name: 'contribute', url: '/contribute/' },
  { name: 'changelog', url: '/changelog/' },
];

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812, deviceScaleFactor: 1 },
  { name: 'tablet', width: 768, height: 1024, deviceScaleFactor: 1 },
  { name: 'desktop', width: 1280, height: 800, deviceScaleFactor: 1 },
];

// --- CLI parsing ---

const args = process.argv.slice(2);
const getFlag = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
};
const hasFlag = (name) => args.includes(`--${name}`);

const isBaseline = hasFlag('baseline');
const baseUrl =
  getFlag('url') || process.env.BASE_URL || 'http://localhost:4321';
const onlyFilter = getFlag('only');
const pagesFilter = getFlag('pages');
const headed = process.env.HEADED === '1' || hasFlag('headed');

const outDir = isBaseline
  ? join(repoRoot, 'reports', 'visual', 'baseline')
  : join(repoRoot, 'reports', 'visual', 'current');

mkdirSync(outDir, { recursive: true });

// --- helpers ---

function getCommitHash() {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim();
  } catch {
    return 'unknown';
  }
}

function getBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

async function checkServer() {
  try {
    const res = await fetch(baseUrl);
    if (!res.ok) throw new Error(`status ${res.status}`);
    return true;
  } catch (err) {
    console.error(`\nCannot reach ${baseUrl}`);
    console.error(`   ${err.message}`);
    console.error(`\n   Run \`npm run preview\` in another shell first.\n`);
    return false;
  }
}

// --- main ---

async function main() {
  console.log(`\nVisual ${isBaseline ? 'BASELINE' : 'current'} capture`);
  console.log(`   target:   ${baseUrl}`);
  console.log(`   branch:   ${getBranch()}`);
  console.log(`   commit:   ${getCommitHash().slice(0, 7)}`);
  console.log(`   output:   ${outDir.replace(repoRoot + '/', '')}`);
  console.log(`   mode:     ${headed ? 'headed (visible)' : 'headless'}`);
  // A baseline and its current capture must agree on the two derived urls.
  console.log(`   samples:  ${articleHref}  ${PAGES[2].url}\n`);

  const serverOk = await checkServer();
  if (!serverOk) process.exit(1);

  let pages = PAGES;
  if (onlyFilter) {
    pages = pages.filter(
      (p) => p.url.includes(onlyFilter) || p.name.includes(onlyFilter),
    );
  }
  if (pagesFilter) {
    const names = pagesFilter.split(',');
    pages = pages.filter((p) => names.includes(p.name));
  }

  if (pages.length === 0) {
    console.error(`No pages matched filter: ${onlyFilter || pagesFilter}`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: !headed });
  const results = [];
  let succeeded = 0;
  let failed = 0;

  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.deviceScaleFactor,
        reducedMotion: 'reduce',
      });

      for (const pageDef of pages) {
        const page = await context.newPage();
        const fullUrl = baseUrl + pageDef.url;
        const fileName = `${pageDef.name}-${viewport.name}.png`;
        const filePath = join(outDir, fileName);

        try {
          await page.goto(fullUrl, {
            waitUntil: 'networkidle',
            timeout: 30_000,
          });
          await page.addStyleTag({
            content: `*, *::before, *::after {
              animation-duration: 0s !important;
              animation-delay: 0s !important;
              transition-duration: 0s !important;
              transition-delay: 0s !important;
              caret-color: transparent !important;
            }
            html { scroll-behavior: auto !important; }`,
          });
          await page.evaluate(() => document.fonts?.ready);
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(800);
          await page.screenshot({
            path: filePath,
            fullPage: true,
            animations: 'disabled',
          });
          results.push({
            page: pageDef.name,
            viewport: viewport.name,
            file: fileName,
            ok: true,
          });
          console.log(`  + ${pageDef.name.padEnd(24)} ${viewport.name}`);
          succeeded++;
        } catch (err) {
          results.push({
            page: pageDef.name,
            viewport: viewport.name,
            file: fileName,
            ok: false,
            error: err.message,
          });
          console.log(
            `  x ${pageDef.name.padEnd(24)} ${viewport.name}  ${err.message}`,
          );
          failed++;
        } finally {
          await page.close();
        }
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  if (isBaseline) {
    const manifest = {
      capturedAt: new Date().toISOString(),
      commit: getCommitHash(),
      branch: getBranch(),
      baseUrl,
      viewports: VIEWPORTS,
      pages: PAGES,
      results,
      summary: {
        total: results.length,
        succeeded,
        failed,
      },
    };
    writeFileSync(
      join(outDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
    console.log(`\nmanifest.json written`);
  }

  console.log(
    `\n${failed === 0 ? 'OK' : 'WARN'}  ${succeeded}/${results.length} screenshots captured${
      failed ? `, ${failed} failed` : ''
    }\n`,
  );

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
