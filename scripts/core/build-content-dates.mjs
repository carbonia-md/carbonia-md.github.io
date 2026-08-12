#!/usr/bin/env node
/**
 * build-content-dates.mjs — src/data/content-dates.json
 *
 * Accurate per-URL "last meaningful content change" date, from one git pass over
 * knowledge/ (the SSOT). For each article the newest NON-cosmetic author-date
 * wins (a lint/format/chore sweep never fakes freshness — Google's "artificially
 * refreshing" anti-pattern). Author-date (%aI) is wall-clock ISO-8601 with tz.
 *
 * Consumed by build-latest.mjs for "shipped" ordering. Categories + languages
 * flow from place.config.ts (genericity gate); the cosmetic filter is a small
 * generic set (the fork's place-specific commit-subject regexes are not ported).
 *
 * A file whose every commit is cosmetic is omitted → consumers fall back to
 * frontmatter.date (conservative: stale-but-true, never fake-fresh).
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const ROOT = process.cwd();
const OUT = resolve(ROOT, 'src/data/content-dates.json');
const placeConfig = (await import(resolve(ROOT, 'place.config.ts'))).default;

// knowledge/ folder title → URL slug.
const TITLE_TO_SLUG = Object.fromEntries(
  placeConfig.categories.map((c) => [c.title, c.slug]),
);
const LANGS = placeConfig.place.languages?.length
  ? placeConfig.place.languages
  : ['en'];
const DEFAULT_LANG = LANGS[0];
const NON_DEFAULT_LANGS = new Set(LANGS.filter((l) => l !== DEFAULT_LANG));

// Generic cosmetic commit subjects (no meaningful content change).
const COSMETIC = /(\bprettier\b|\blint\b|\bformat\b|\bchore\b|\btypo\b)/i;

function knowledgePathToUrl(p) {
  const parts = p.split('/');
  if (parts[0] !== 'knowledge') return null;
  let i = 1;
  let lang = DEFAULT_LANG;
  if (NON_DEFAULT_LANGS.has(parts[1])) {
    lang = parts[1];
    i = 2;
  }
  const title = parts[i];
  const file = parts[i + 1];
  if (parts.length !== i + 2) return null; // exactly knowledge/[lang/]Title/file.md
  if (!title || !file || !file.endsWith('.md') || file.startsWith('_')) return null;
  const catSlug = TITLE_TO_SLUG[title];
  if (!catSlug) return null;
  const slug = file.replace(/\.md$/, '').normalize('NFC');
  const prefix = lang === DEFAULT_LANG ? '' : `/${lang}`;
  return `${prefix}/${catSlug}/${slug}/`;
}

function main() {
  let log = '';
  try {
    log = execSync(
      'git -c core.quotepath=false log --full-history -z --name-only --format="COMMIT|%H|%aI|%s" -- knowledge/',
      { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 },
    );
  } catch (e) {
    console.error('[content-dates] git log failed:', e.message);
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({ _generated: null, count: 0, dates: {} }));
    return;
  }

  // Files present in the current tree (ignore ghosts from deleted history).
  const currentTree = new Set(
    execSync('git -c core.quotepath=false ls-tree -r --name-only HEAD -- knowledge/', {
      encoding: 'utf-8',
    })
      .split('\n')
      .filter((p) => p.endsWith('.md')),
  );

  const dates = {}; // url -> newest non-cosmetic ISO date (log is newest-first)
  let skipped = 0;
  let cur = null;
  for (let token of log.split('\0')) {
    token = token.replace(/^\n+/, '').trim();
    if (!token) continue;
    if (token.startsWith('COMMIT|')) {
      const parts = token.split('|');
      const subject = parts.slice(3).join('|');
      cur = { date: parts[2] || '', cosmetic: COSMETIC.test(subject) };
    } else if (cur && token.startsWith('knowledge/') && token.endsWith('.md')) {
      if (!currentTree.has(token)) continue;
      if (cur.cosmetic) {
        skipped++;
        continue;
      }
      const url = knowledgePathToUrl(token);
      if (url && !dates[url]) dates[url] = cur.date;
    }
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify({
      _generated: new Date().toISOString(),
      count: Object.keys(dates).length,
      dates,
    }),
  );
  console.log(
    `[content-dates] ${Object.keys(dates).length} URL dates (skipped ${skipped} cosmetic) → src/data/content-dates.json`,
  );
}

main();
