#!/usr/bin/env node
/**
 * build-dashboard-lite.mjs — Prebuild: article-health rollup + immune score.
 *
 * Consumes: src/data/article-health.json (produced by article-health:json)
 * Emits:    src/data/dashboard-lite.json
 *
 * Graceful degradation: if the input JSON is absent (ENOENT), emits a
 * minimal {available: false} fallback so the Astro build stays green.
 * Parse errors are NOT degradation — they exit 1 loudly.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../..');
const INPUT_PATH = join(PROJECT_ROOT, 'src/data/article-health.json');
const OUTPUT_DIR = join(PROJECT_ROOT, 'src/data');
const OUTPUT_PATH = join(OUTPUT_DIR, 'dashboard-lite.json');
const KNOWLEDGE_DIR = join(PROJECT_ROOT, 'knowledge');
const CONFIG_TOML = join(PROJECT_ROOT, 'scripts/tools/article-health.config.toml');
const CHECKS_DIR = join(PROJECT_ROOT, 'scripts/tools/lib/article_health/checks');

const DIMENSION_WEIGHTS = {
  review_coverage: 0.30,
  plugin_pass_rate: 0.25,
  plugin_health: 0.15,
  citation_density: 0.15,
  tool_freshness: 0.10,
  drift_velocity: 0.05,
};

function gitLastModifiedDays(relPath) {
  try {
    const out = execSync(`git log -1 --format=%ai -- "${relPath}"`, {
      cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (!out) return null;
    const dateStr = out.split(' ')[0];
    const commitDate = new Date(dateStr);
    const now = new Date();
    return Math.floor((now - commitDate) / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

function loadKnowledgeArticles() {
  const articles = [];
  let dirs;
  try { dirs = readdirSync(KNOWLEDGE_DIR, { withFileTypes: true }); } catch { return articles; }
  for (const ent of dirs) {
    if (!ent.isDirectory()) continue;
    const catDir = join(KNOWLEDGE_DIR, ent.name);
    let files;
    try { files = readdirSync(catDir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.md') || f.startsWith('_')) continue;
      articles.push({ category: ent.name, slug: f.replace(/\.md$/, ''), path: join(catDir, f) });
    }
  }
  return articles;
}

function computeReviewCoverage(articles) {
  if (!articles.length) return 0;
  let reviewed = 0;
  for (const a of articles) {
    try {
      const text = readFileSync(a.path, 'utf8');
      if (/^lastHumanReview\s*:\s*true/m.test(text)) reviewed++;
    } catch { /* skip */ }
  }
  return Math.round((reviewed / articles.length) * 1000) / 10;
}

function computeCitationDensity(articles) {
  const gradeScore = { A: 100, B: 80, C: 60, D: 40, F: 0 };
  const grades = [];
  const defRe = /^\[\^[0-9a-zA-Z_-]+\]:/gm;

  for (const a of articles) {
    let text;
    try { text = readFileSync(a.path, 'utf8'); } catch { continue; }
    let body = text;
    if (body.startsWith('---')) {
      const end = body.indexOf('---', 3);
      if (end > 0) body = body.slice(end + 3);
    }
    const fnCount = (body.match(defRe) || []).length;
    const urlCount = (body.match(/https?:\/\//g) || []).length;
    const words = body.split(/\s+/).length;
    const density = fnCount > 0 ? Math.floor(words / fnCount) : null;

    let g;
    if (fnCount >= 3 && density !== null && density <= 300) g = 'A';
    else if (fnCount >= 1) g = 'B';
    else if (urlCount >= 3) g = 'C';
    else if (urlCount >= 1) g = 'D';
    else g = 'F';
    grades.push(gradeScore[g]);
  }
  if (!grades.length) return 0;
  return Math.round((grades.reduce((s, v) => s + v, 0) / grades.length) * 10) / 10;
}

function computeToolFreshness() {
  const configDays = gitLastModifiedDays(
    'scripts/tools/article-health.config.toml'
  ) ?? 999;

  const pluginFiles = [];
  try {
    for (const f of readdirSync(CHECKS_DIR)) {
      if (f.endsWith('.py') && f !== '__init__.py') pluginFiles.push(f);
    }
  } catch { /* empty */ }

  const pluginDays = pluginFiles
    .map(f => gitLastModifiedDays(`scripts/tools/lib/article_health/checks/${f}`))
    .filter(d => d !== null);
  const avgPluginDays = pluginDays.length ? pluginDays.reduce((s, d) => s + d, 0) / pluginDays.length : 999;

  if (configDays < 7 && avgPluginDays < 14) return 100;
  if (configDays < 30 && avgPluginDays < 30) return 80;
  if (configDays < 90) return 60;
  return 40;
}

function computePluginHealth() {
  const configDays = gitLastModifiedDays(
    'scripts/tools/article-health.config.toml'
  ) ?? 999;

  const pluginFiles = [];
  try {
    for (const f of readdirSync(CHECKS_DIR)) {
      if (f.endsWith('.py') && f !== '__init__.py') pluginFiles.push(f);
    }
  } catch { /* empty */ }

  if (!pluginFiles.length) return 0;

  const DRIFT_CONFIG_RECENT = 14;
  const DRIFT_PLUGIN_STALE = 30;
  let drifted = 0;

  for (const f of pluginFiles) {
    const days = gitLastModifiedDays(`scripts/tools/lib/article_health/checks/${f}`) ?? 999;
    if (configDays < DRIFT_CONFIG_RECENT && days > DRIFT_PLUGIN_STALE) drifted++;
  }

  return Math.round(((pluginFiles.length - drifted) / pluginFiles.length) * 1000) / 10;
}

function computeDriftVelocity(reports) {
  let newArticlePaths;
  try {
    const out = execSync(
      'git log --since="7 days ago" --name-only --pretty=format: --diff-filter=A',
      { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    newArticlePaths = out.split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('knowledge/') && l.endsWith('.md') && !l.includes('/_'));
  } catch {
    newArticlePaths = [];
  }

  if (!newArticlePaths.length) return 100;

  const newSlugs = new Set(newArticlePaths.map(p => p.split('/').pop().replace(/\.md$/, '')));
  const newReports = reports.filter(r => newSlugs.has(r.slug));
  if (!newReports.length) return 100;

  const totalViolations = newReports.reduce((s, r) => s + r.summary.hard + r.summary.warn, 0);
  const rate = totalViolations / newReports.length;
  return Math.round(Math.max(0, Math.min(100, 100 - rate * 10)) * 10) / 10;
}

function computePluginPassRate(reports) {
  if (!reports.length) return { score: 0, detail: { total: 0 } };
  const hardPass = reports.filter(r => r.summary.hard === 0).length;
  const warnPass = reports.filter(r => r.summary.warn === 0).length;
  const total = reports.length;
  const hardPct = (hardPass / total) * 100;
  const warnPct = (warnPass / total) * 100;
  const score = hardPct * 0.7 + warnPct * 0.3;
  return {
    score: Math.round(score * 10) / 10,
    detail: { total, hardPass, warnPass, hardPct: Math.round(hardPct * 10) / 10, warnPct: Math.round(warnPct * 10) / 10 },
  };
}

function computeRollup(reports) {
  const total = reports.length;
  const totalHard = reports.reduce((s, r) => s + r.summary.hard, 0);
  const totalWarn = reports.reduce((s, r) => s + r.summary.warn, 0);
  const totalInfo = reports.reduce((s, r) => s + r.summary.info, 0);
  const allPass = reports.filter(r => r.summary.hard === 0).length;
  return { total, totalHard, totalWarn, totalInfo, allPass, passRate: total ? Math.round((allPass / total) * 1000) / 10 : 0 };
}

function computeImmuneScore(reports) {
  const articles = loadKnowledgeArticles();
  const pluginPass = computePluginPassRate(reports);

  const components = {
    review_coverage: computeReviewCoverage(articles),
    plugin_pass_rate: pluginPass.score,
    plugin_health: computePluginHealth(),
    citation_density: computeCitationDensity(articles),
    tool_freshness: computeToolFreshness(),
    drift_velocity: computeDriftVelocity(reports),
  };

  const score = Math.round(
    Object.entries(DIMENSION_WEIGHTS).reduce(
      (sum, [dim, weight]) => sum + (components[dim] ?? 0) * weight, 0
    )
  );

  const status = score >= 80
    ? 'Healthy'
    : score >= 60
      ? 'Attention needed'
      : score >= 40
        ? 'Drift'
        : 'Critical';

  return { score, status, components, weights: DIMENSION_WEIGHTS, pluginPassDetail: pluginPass.detail };
}

function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  let reports;
  try {
    const raw = readFileSync(INPUT_PATH, 'utf8');
    reports = JSON.parse(raw).reports || [];
  } catch (err) {
    if (err.code === 'ENOENT') {
      const fallback = { generated: new Date().toISOString(), available: false, rollup: null, immune: null };
      writeFileSync(OUTPUT_PATH, JSON.stringify(fallback, null, 2) + '\n');
      console.warn('build-dashboard-lite: input absent (ENOENT), wrote fallback JSON');
      return;
    }
    console.error(`build-dashboard-lite: fatal error reading input: ${err.message}`);
    process.exit(1);
  }

  const rollup = computeRollup(reports);
  const immune = computeImmuneScore(reports);

  const output = {
    generated: new Date().toISOString(),
    available: true,
    rollup,
    immune,
    perArticle: reports.map(r => ({
      file: r.file,
      category: r.category,
      slug: r.slug,
      hard: r.summary.hard,
      warn: r.summary.warn,
      info: r.summary.info,
      passed: r.summary.hard === 0,
    })),
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`build-dashboard-lite: ${reports.length} articles, immune=${immune.score} (${immune.status})`);
}

main();
