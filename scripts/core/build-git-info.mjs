#!/usr/bin/env node
/**
 * build-git-info.mjs — src/data/git-info.json
 *
 * Per-article git provenance (contributors / lastModified / commitHash /
 * revisionCount) computed ONCE in prebuild from a single git pass over
 * knowledge/, so the astro render stage has ZERO git dependency (the fork's
 * EVO-A4 endgame: render stage becomes pure, CI can shallow-clone).
 *
 * Consumed by src/utils/git-info.ts (reads this JSON instead of shelling out).
 * Keyed by repo-relative NFC path. mailmap-aware (%aN/%aE).
 *
 * A repo maintainer (the GitHub origin owner) is stable-demoted to the back of
 * each article's contributor list — their footprint is dominated by merges +
 * routine maintenance, a poor authorship proxy. Fork-friendly: derived from the
 * origin remote, not hardcoded; no demotion when the owner is unresolved.
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const ROOT = process.cwd();
const OUT = resolve(ROOT, 'src/data/git-info.json');

const contributorKey = (v) => v.toLowerCase().replace(/[\s._-]+/g, '');

// GitHub noreply emails carry the login; prefer it over the display name.
function resolveContributor(name, email) {
  const m = email.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i);
  return m?.[1] || name || '';
}

function deriveMaintainerKey() {
  try {
    const url = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
    const owner = url.match(/[/:]([^/]+)\/[^/]+?(?:\.git)?$/)?.[1] || '';
    return owner ? contributorKey(owner) : '';
  } catch {
    return '';
  }
}

const MAINTAINER_KEY = deriveMaintainerKey();

function demoteMaintainer(contributors) {
  if (!MAINTAINER_KEY || contributors.length < 2) return contributors;
  const isMaint = (c) => contributorKey(c) === MAINTAINER_KEY;
  const others = contributors.filter((c) => !isMaint(c));
  if (others.length === 0 || others.length === contributors.length) return contributors;
  return [...others, ...contributors.filter(isMaint)];
}

function main() {
  let log = '';
  try {
    log = execSync(
      'git log --full-history -z --name-only --format="COMMIT|%H|%aI|%aN|%aE" -- knowledge/',
      { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 },
    );
  } catch (e) {
    console.error('[git-info] git log failed:', e.message);
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({ _generated: null, count: 0, files: {} }));
    return;
  }

  const files = {};
  let hash = '';
  let date = '';
  let contributor = '';

  for (let token of log.split('\0')) {
    token = token.replace(/^\n+/, '').trim();
    if (!token) continue;
    if (token.startsWith('COMMIT|')) {
      const parts = token.split('|');
      hash = parts[1] || '';
      date = parts[2] || '';
      contributor = resolveContributor(parts[3] || '', parts[4] || '');
    } else if (token.startsWith('knowledge/') && token.endsWith('.md')) {
      const key = token.normalize('NFC');
      let entry = files[key];
      if (!entry) {
        // first sighting = newest commit (log is newest-first)
        entry = { contributors: [], lastModified: date, commitHash: hash, revisionCount: 0 };
        files[key] = entry;
      }
      entry.revisionCount += 1;
      if (contributor && !entry.contributors.includes(contributor)) {
        entry.contributors.push(contributor);
      }
    }
  }

  for (const key in files) {
    files[key].contributors = demoteMaintainer(files[key].contributors);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify({
      _generated: new Date().toISOString(),
      count: Object.keys(files).length,
      files,
    }),
  );
  console.log(`[git-info] ${Object.keys(files).length} article files → src/data/git-info.json`);
}

main();
