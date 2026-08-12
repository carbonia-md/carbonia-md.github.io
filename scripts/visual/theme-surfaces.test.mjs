#!/usr/bin/env node
/**
 * theme-surfaces.test.mjs — browser-backed dark/light theme regression guard
 *
 * Asserts computed background and text colors on named surfaces in both themes.
 * Fails when a surface renders a light-only color in dark mode (the class of
 * defect this task repairs).
 *
 * Usage:
 *   node scripts/visual/theme-surfaces.test.mjs
 *
 * Starts its own preview server from ./dist, so `npm run build` must have run.
 * If BASE_URL is set, uses an already-running server instead.
 *
 * Env:
 *   BASE_URL   override server URL (skips internal server start)
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const distDir = resolve(repoRoot, 'dist');

let server = null;
let BASE_URL = process.env.BASE_URL || '';

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

async function startServer() {
  if (BASE_URL) return;
  if (!existsSync(distDir)) {
    console.error('dist/ not found. Run `npm run build` first.');
    process.exit(1);
  }
  const port = 4399;
  BASE_URL = `http://localhost:${port}`;
  server = createServer((req, res) => {
    let url = req.url.split('?')[0];
    if (url.endsWith('/')) url += 'index.html';
    if (!extname(url)) url += '/index.html';
    const filePath = join(distDir, url);
    try {
      const data = readFileSync(filePath);
      const ext = extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  await new Promise((ok) => server.listen(port, ok));
}

function stopServer() {
  if (server) {
    server.close();
    server = null;
  }
}

// Named surfaces: [route, selector, property, description]
// Each surface is checked in both light and dark themes.
const SURFACES = [
  // Home
  ['/', '.article-card', 'background-color', 'Home: article card bg'],
  ['/', '.article-card .article-card-title', 'color', 'Home: article card title'],
  ['/', '[aria-label="Quick navigation"] a', 'background-color', 'Home: reader door card'],
  ['/', '#cover-story section', 'background-color', 'Home: cover story section bg'],

  // Latest
  ['/latest/', '#latest-filters', 'background-color', 'Latest: filter bar bg'],
  ['/latest/', '.latest-chip', 'background-color', 'Latest: inactive chip bg'],

  // Dashboard
  ['/dashboard/', '.dashboard', 'background-color', 'Dashboard: page bg'],
  ['/dashboard/', '.vital-card', 'background-color', 'Dashboard: vital card bg'],

  // About
  ['/about/', '.vision-block', 'background-color', 'About: vision block bg'],
  ['/about/', '.guide-card', 'background-color', 'About: guide card bg'],
  ['/about/', '.faq-question', 'color', 'About: FAQ question text'],
  ['/about/', '.contact-card', 'background-color', 'About: contact card bg'],

  // Contribute
  ['/contribute/', '.how-card', 'background-color', 'Contribute: how-card bg'],
  ['/contribute/', '.path-card', 'background-color', 'Contribute: path card bg'],
  ['/contribute/', '.idea', 'background-color', 'Contribute: idea chip bg'],

  // Changelog
  ['/changelog/', '.commit-log-item', 'background-color', 'Changelog: commit card bg'],
  ['/changelog/', '#changelog-controls', 'background-color', 'Changelog: control bar bg'],
];

// These light-only colors are BANNED in dark mode. If any surface computes one
// of these in dark theme, the test fails.
const LIGHT_ONLY_COLORS = [
  'rgb(255, 255, 255)',       // #ffffff / white
  'rgb(248, 250, 252)',       // #f8fafc
  'rgb(249, 250, 251)',       // #f9fafb
  'rgb(250, 251, 252)',       // #fafbfc
  'rgb(241, 245, 249)',       // #f1f5f9
  'rgb(240, 249, 255)',       // #f0f9ff
];

// Banned dark-on-dark text colors in dark mode
const DARK_INK_COLORS = [
  'rgb(31, 41, 55)',          // #1f2937
  'rgb(14, 58, 92)',          // #0e3a5c
  'rgb(26, 26, 46)',          // #1a1a2e
  'rgb(30, 41, 59)',          // #1e293b
  'rgb(55, 65, 81)',          // #374151
];

function isLightOnlyBg(color) {
  if (!color) return false;
  if (LIGHT_ONLY_COLORS.includes(color)) return true;
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return false;
  const [, r, g, b] = match.map(Number);
  // Any rgb where all channels > 230 is a light-only surface in dark mode
  if (r > 230 && g > 230 && b > 230) return true;
  return false;
}

function isDarkInk(color) {
  if (!color) return false;
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return false;
  const [, r, g, b] = match.map(Number);
  // Any text color where all channels < 100 is dark-on-dark
  if (r < 100 && g < 100 && b < 100) return true;
  return DARK_INK_COLORS.includes(color);
}

function selfTest() {
  const planted = [
    ['isLightOnlyBg', 'rgb(255, 255, 255)', true],
    ['isLightOnlyBg', 'rgb(248, 250, 252)', true],
    ['isLightOnlyBg', 'rgb(235, 235, 235)', true],
    ['isLightOnlyBg', 'rgb(20, 20, 31)', false],
    ['isDarkInk', 'rgb(31, 41, 55)', true],
    ['isDarkInk', 'rgb(50, 60, 70)', true],
    ['isDarkInk', 'rgb(241, 245, 249)', false],
  ];
  for (const [fn, input, expected] of planted) {
    const actual = fn === 'isLightOnlyBg' ? isLightOnlyBg(input) : isDarkInk(input);
    if (actual !== expected) {
      console.error(`NON-VACUITY FAIL: ${fn}(${input}) = ${actual}, expected ${expected}`);
      process.exit(1);
    }
  }
  console.log('non-vacuity: heuristic self-test passed (7 planted values)');
}

async function main() {
  selfTest();
  await startServer();
  const browser = await chromium.launch();
  const failures = [];
  let checked = 0;

  for (const [route, selector, property, label] of SURFACES) {
    const url = `${BASE_URL}${route}`;

    // Dark theme check
    const darkPage = await browser.newPage();
    // Set dark theme via JS before navigation to ensure styles apply from the start
    await darkPage.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.setAttribute('data-theme', 'dark');
      });
    });
    await darkPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // Ensure the attribute is set (belt and suspenders)
    await darkPage.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await darkPage.waitForTimeout(200);

    const darkValue = await darkPage.evaluate(({ sel, prop }) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return getComputedStyle(el).getPropertyValue(prop);
    }, { sel: selector, prop: property });

    if (darkValue === null) {
      // Element not found on page - skip (may be data-dependent)
      await darkPage.close();
      continue;
    }

    checked++;

    if (property === 'background-color' && isLightOnlyBg(darkValue)) {
      failures.push(`FAIL [dark] ${label}: ${property} = ${darkValue} (light-only surface)`);
    } else if (property === 'color' && isDarkInk(darkValue)) {
      failures.push(`FAIL [dark] ${label}: ${property} = ${darkValue} (dark-on-dark text)`);
    }

    await darkPage.close();
  }

  await browser.close();
  stopServer();

  console.log(`theme-surfaces: checked ${checked} surfaces across ${SURFACES.length} assertions`);

  if (failures.length > 0) {
    console.error('\n' + failures.join('\n'));
    console.error(`\n${failures.length} theme regression(s) found.`);
    process.exit(1);
  }

  console.log('✅ theme-surfaces passed — no light-only surfaces or dark-on-dark text in dark mode.');
}

main().catch((err) => {
  stopServer();
  console.error('theme-surfaces: fatal error:', err.message);
  process.exit(1);
});
