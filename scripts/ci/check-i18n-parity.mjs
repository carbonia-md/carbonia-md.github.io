#!/usr/bin/env node
// check-i18n-parity.mjs — every enabled UI language carries every UI string.
//
// `src/i18n/ui.ts` holds one string table per language; `en` is the reference.
// For every enabled language (LANGUAGES_REGISTRY, `src/config/languages.ts`)
// other than the default, this fails when its table:
//   - is missing entirely,
//   - lacks a key that `en` has (it would silently fall back to English),
//   - has a key `en` lacks (dead string, usually a typo'd key),
//   - has an empty value,
//   - drops or invents a `{placeholder}` token (`{n}`, `{field}`), which the
//     call site substitutes and would otherwise render literally or not at all.
//
// Instance-local multi-language experiment (see /PROGRESS.md M3). Runs with
// `node --experimental-strip-types` so it imports the TypeScript tables as-is.

import { ui, defaultLang } from '../../src/i18n/ui.ts';
import { ENABLED_LANGUAGE_CODES } from '../../src/config/languages.ts';

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

const reference = ui[defaultLang];
const refKeys = Object.keys(reference);
const problems = [];

for (const lang of ENABLED_LANGUAGE_CODES) {
  if (lang === defaultLang) continue;
  const table = ui[lang];
  if (!table) {
    problems.push(`${lang}: no string table in src/i18n/ui.ts`);
    continue;
  }
  for (const key of refKeys) {
    if (!(key in table)) {
      problems.push(`${lang}: missing key '${key}'`);
      continue;
    }
    const value = table[key];
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`${lang}: empty value for '${key}'`);
      continue;
    }
    if (placeholders(value) !== placeholders(reference[key])) {
      problems.push(
        `${lang}: placeholder mismatch in '${key}' (${defaultLang}: {${placeholders(reference[key])}}, ${lang}: {${placeholders(value)}})`,
      );
    }
  }
  for (const key of Object.keys(table)) {
    if (!(key in reference)) problems.push(`${lang}: extra key '${key}' not in ${defaultLang}`);
  }
}

if (problems.length) {
  console.error(`i18n parity: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const others = ENABLED_LANGUAGE_CODES.filter((l) => l !== defaultLang);
console.log(
  `i18n parity: OK (${refKeys.length} keys; ${others.length ? others.join(', ') : 'no other languages'} complete)`,
);
