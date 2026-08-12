#!/usr/bin/env node
// qr-sheet.mjs -- print the QR codes that deep link into this instance's chat.
//
// Every context declared in `knowledge/chat/_contexts.md` becomes one card: the code
// that opens `https://<domain>/chat?ctx=<slug>`, the place's name, and the URL as
// text for anyone who would rather type it. The result is a single self-contained
// HTML file you open and print -- there is no `/qr` route, because a page would add a
// gated route and an index to maintain for something only the operator printing the
// signs ever opens. (It would buy no privacy: `/chat` necessarily ships the whole
// context list to the client, since a static build has no server to resolve `?ctx=`.)
//
// An instance with no manifest exits 0 saying so. Declaring no context is not a
// failure; it means this place has nothing to put on a wall yet. A manifest whose
// contexts were ALL dropped by validation is the opposite state and exits nonzero:
// somebody wrote those contexts and got no sheet, and the summary line is what they
// read.
//
// Usage:
//   npm run qr:sheet
//   npm run qr:sheet -- --domain example.invalid
//   npm run qr:sheet -- --out reports/codes.html
//   npm run qr:sheet -- --root ../other-instance
//
// This file lives under scripts/, which both genericity gates scan: its source is
// pure ASCII and carries no place-specific string.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { builtRoutes, knowledgeCollectionIds } from '../../src/lib/built-routes.ts';
import { readChatContexts, CONTEXT_MANIFEST_PATH } from '../../src/lib/chat-contexts.ts';
import { renderSheet, SHEET_OUTPUT_PATH } from '../lib/qr-sheet.mjs';

const DEFAULT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Every flag this CLI accepts, each taking a value.
 * `scripts/ci/check-chat-context-schema-docs.mjs` derives the runbook's flag list from
 * this array, so a flag added, removed, or renamed without the documentation following
 * it fails CI (`.agent-toolkit/rules/guard-or-explain-prose-drift.md`).
 */
export const QR_SHEET_FLAGS = ['--domain', '--out', '--root'];

function fail(message) {
  console.error(`qr-sheet: ${message}`);
  process.exit(1);
}

/* -- arguments ------------------------------------------------------------- */

const argv = process.argv.slice(2);
const options = { root: DEFAULT_ROOT, out: SHEET_OUTPUT_PATH };
for (let i = 0; i < argv.length; i += 1) {
  const flag = argv[i];
  const value = argv[i + 1];
  if (QR_SHEET_FLAGS.includes(flag)) {
    if (!value) fail(`${flag} needs a value.`);
    options[flag.slice(2)] = value;
    i += 1;
  } else {
    fail(`unknown argument "${flag}".`);
  }
}
const root = resolve(options.root);

/* -- place config ----------------------------------------------------------- */

const configPath = join(root, 'place.config.ts');
let place = null;
if (existsSync(configPath)) {
  try {
    place = (await import(pathToFileURL(configPath).href)).default;
  } catch (error) {
    fail(
      `place.config.ts could not be imported (${error.message}).\n` +
        '  Run this through `npm run qr:sheet`, which passes the type-stripping flag Node needs.',
    );
  }
}

const domain = (options.domain ?? place?.place?.domain ?? '').trim();
if (!domain) {
  fail('no domain to encode. Set `place.domain` in place.config.ts, or pass --domain <host>.');
}

/* -- the routes a context `article` may resolve to --------------------------- */
//
// The SAME set `/chat` validates against, from the same function: static pages,
// category hubs, and articles. It has to be the same set, because a supplied route
// set is what makes an unresolvable `article` drop its whole context -- so a NARROWER
// set here would drop cards for links the site serves perfectly well, which is the
// exact failure the reader's fallback exists to avoid.
//
// Derived from `knowledge/` and `place.config.ts` rather than from build output, so
// the sheet can be printed before anything is built and cannot disagree with a stale
// artifact. A set that cannot be derived at all is treated as no route set: links are
// omitted with a warning and every card still prints.

let knownRoutes;
try {
  const routes = builtRoutes(place, knowledgeCollectionIds(place, root), join(root, 'src/pages'));
  if (routes.length > 0) knownRoutes = routes;
} catch (error) {
  console.warn(
    `qr-sheet: the built route set could not be derived (${error.message}); ` +
      'every declared `article` link is omitted and every card still prints.',
  );
}

/* -- read, render, write ----------------------------------------------------- */

// The reader emits its own diagnostics to the console, so a dropped context is
// visible here without this file reprinting the list.
const { contexts, declared } = readChatContexts(root, knownRoutes ? { knownRoutes } : {});

// An empty sheet has two causes that look identical in `contexts` and are opposite
// things to tell an operator. Declaring nothing is not a failure; declaring contexts
// and having every one of them rejected is a manifest to go fix, and the summary line
// is what gets read -- the warnings above it scroll past.
if (contexts.length === 0 && declared > 0) {
  fail(
    `all ${declared} context(s) declared in ${CONTEXT_MANIFEST_PATH} were dropped by ` +
      'validation -- see the warnings above. No sheet written.',
  );
}

if (contexts.length === 0) {
  console.log(
    `OK: no contexts declared in ${CONTEXT_MANIFEST_PATH} -- nothing to print. ` +
      'Declare one to put a code on a wall.',
  );
  process.exit(0);
}

const html = renderSheet({
  contexts,
  domain,
  siteName: (place?.place?.name ?? '').trim(),
  generated: new Date().toISOString(),
});

const outPath = resolve(root, options.out);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');

console.log(`qr-sheet: ${contexts.length} context(s) from ${CONTEXT_MANIFEST_PATH}`);
for (const context of contexts) console.log(`qr-sheet:   ${context.slug}  ${context.label}`);
console.log(`OK: sheet written to ${options.out}. Open it and print; it lays out on A4 and US Letter.`);
