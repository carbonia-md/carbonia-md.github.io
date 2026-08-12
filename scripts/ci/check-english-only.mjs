#!/usr/bin/env node
// check-english-only.mjs — the English-only CJK-codepoint gate.
//
// Fails if any CJK-range codepoint appears in a committed code tree (src/,
// scripts/, tests/, workers/, .agents/skills/). The site ships English-only
// through the current roadmap; a CJK codepoint in code, a test fixture, or a
// framework skill (agent-executed prose is code for doctrine purposes) is dead
// fork content
// (STRATEGIC-DIRECTION 2026-07-11 (b); SPEC §Negative requirements). This is the
// machine complement to check-genericity.sh, which greps a place-name denylist
// over the same trees. Test fixtures are code — the doctrine is whole-project.
//
// Codepoint ranges (CJK symbols/ideographs + fullwidth/halfwidth forms):
//   U+3000–U+9FFF  CJK symbols/punctuation + unified ideographs
//   U+FF00–U+FFEF  fullwidth / halfwidth forms
// (U+2014 em dash and U+201C/U+201D curly quotes are below U+3000 and are
// legitimate English punctuation — deliberately not flagged.)
//
// Node, not bash: BSD grep lacks -P and reliable \u handling.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
// Present and future code trees. src/content and src/data are derived,
// gitignored projections of knowledge/ (place-specific by nature) and are
// skipped by the content/data dir-name rule below, matching check-genericity.sh.
// .agents/skills holds the framework skills (agent-executed prose is code for
// doctrine purposes — task 5.6).
const SCAN_ROOTS = ['src', 'scripts', 'tests', 'workers', '.agents/skills'];
// Vendor/tool caches are skipped by BASENAME in both modes — no legitimate
// framework dir carries these names anywhere. .git is skipped so template mode
// (whole-tree scan) never trips over pre-cut history.
const SKIP_DIRS = new Set([
  'node_modules', '__pycache__', '.git', '.astro', 'dist', '.venv',
]);
// The derived, gitignored projections of knowledge/ (src/content, src/data,
// public/kb) are skipped by ROOT-relative PATH, not basename, so an unrelated
// same-basename directory remains covered by the gate.
const SKIP_PATHS = new Set([
  'src/content', 'src/data', 'public/kb',
]);
// Derived worker artifacts. Both are gitignored and place-specific by design, like the
// projections above, and both are skipped by BASENAME because they sit inside the worker
// directories rather than in a tree of their own:
//   wrangler.generated.toml  deploy config written by `npm run worker-config`
//   vectors.json             corpus embeddings written by `npm run embeddings:build`,
//                            carrying every article's title, url, and body text
// A committed one would evade this skip only by being tracked, which
// scripts/ci/check-worker-config.mjs fails on.
const SKIP_FILES = new Set(['wrangler.generated.toml', 'vectors.json']);
// Audio extensions are listed for the same reason the image ones are: template
// mode walks the whole tree, so public/media/ is in scope, and the NUL-byte
// fallback below is a heuristic no format guarantees. Naming the extension makes
// the skip deterministic rather than dependent on a clip's byte content.
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.pdf', '.zip', '.gz', '.pyc',
  '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.flac',
]);
// Built via new RegExp from an escaped string so this file's own source stays
// pure ASCII (it lives under scripts/, which this gate scans).
const CJK = new RegExp('[\\u3000-\\u9fff\\uff00-\\uffef]');

const hits = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (SKIP_PATHS.has(relative(ROOT, p).split(sep).join('/'))) continue;
      walk(p);
    } else if (entry.isFile()) {
      if (SKIP_FILES.has(entry.name)) continue;
      if (BINARY_EXT.has(extname(entry.name).toLowerCase())) continue;
      let text;
      try {
        const buf = readFileSync(p);
        if (buf.includes(0)) continue; // binary
        text = buf.toString('utf8');
      } catch {
        continue;
      }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const m = CJK.exec(lines[i]);
        if (m) {
          hits.push(`${relative(ROOT, p)}:${i + 1}:${m.index + 1}: ${JSON.stringify(m[0])}`);
        }
      }
    }
  }
}

// Template mode (LB-26): the `.sekai-template` marker means this checkout is the
// sekai-kb template, which ships English-only demo content — so the CJK gate runs
// over the WHOLE tree, not just code trees. `npm run init` removes the marker on
// adoption, reverting to the code trees only (src/, scripts/, tests/, workers/,
// .agents/skills/) -- this gate's own root list. check-genericity.sh derives its
// own; the two agree today but are never merged into one claim.
const scanned = [];
if (existsSync(join(ROOT, '.sekai-template'))) {
  scanned.push('(whole tree — template mode)');
  walk(ROOT);
} else {
  for (const r of SCAN_ROOTS) {
    const abs = join(ROOT, r);
    if (existsSync(abs)) {
      scanned.push(r);
      walk(abs);
    }
  }
}

if (hits.length) {
  console.error('❌ english-only gate FAILED — CJK codepoint(s) in a code tree:');
  for (const h of hits) console.error('  ' + h);
  console.error('\nThe site is English-only; CJK in code or a test fixture is dead fork content.');
  console.error('(STRATEGIC-DIRECTION 2026-07-11 (b); SPEC §Negative requirements.)');
  process.exit(1);
}

console.log(`✓ english-only gate passed — no CJK codepoints in ${scanned.join(', ') || '(no code trees present)'}`);
