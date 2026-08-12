#!/usr/bin/env node
// check-scan-root-docs.mjs -- the scan-root documentation gate.
//
// The two machine gates (check-genericity.sh and check-english-only.mjs) each carry
// their OWN instance-mode scan roots -- the two lists agree today, but they are
// derived and stated separately, so either gate can gain a root without the other.
// A dozen places in this
// repository restate those root sets in prose: script headers, CI step names,
// the runbook, AGENTS.md, README.md, the template marker, the wizard-emitted
// instance AGENTS.md. Nothing used to check them, so they drifted -- and wrong
// scope text is worse than absent scope text, because it gets believed rather
// than looked up (LB-51, LB-53).
//
// This guard DERIVES both root sets from the two scripts and asserts that every
// registered statement enumerates exactly the roots of the gate it describes.
// Changing a script's roots therefore changes what this guard demands, with no
// second edit here: the registry holds anchors (prose), never roots.
//
// Failure modes, all exit 1:
//   - a registered statement enumerates a root set that is not its gate's set;
//   - a registered anchor is NOT FOUND (someone reworded, moved, or deleted the
//     statement). This is a FAILURE, never a silent pass: an unfindable
//     statement is exactly how a stale one hides. Re-point the registry entry
//     in the same commit that rewords the statement;
//   - a registered "N roots" count word disagrees with the list it introduces;
//   - either script no longer implements template mode as a whole-tree scan,
//     which would make every documented template-mode claim stale;
//   - either script's SCAN_ROOTS can no longer be parsed (the derivation, and
//     therefore this whole guard, would otherwise silently weaken).
//
// Registry scopes:
//   - `framework`  -- framework-owned file, present in every checkout. Missing
//     file or missing anchor is a failure in both modes.
//   - `instance`   -- a file the adopter owns (`merge=ours`: AGENTS.md,
//     README.md, .agent-toolkit/**) or that adoption removes (.sekai-template,
//     the framework maintainer docs under docs/ -- ADR 008).
//     Required in TEMPLATE mode, where this repository authors the text. In an
//     adopted instance an absent file or a reworded anchor is reported as
//     skipped, because the adopter owns that prose -- but a statement that IS
//     found must still enumerate its gate's roots.
//
// Success prints one summary line and exits 0.
//
// Usage: node scripts/ci/check-scan-root-docs.mjs   (run from anywhere)
//
// This file lives under scripts/, which both gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GENERICITY_SCRIPT = 'scripts/ci/check-genericity.sh';
const ENGLISH_ONLY_SCRIPT = 'scripts/ci/check-english-only.mjs';

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/* -- Derivation: the two root sets come from the scripts, never from here -- */

// check-genericity.sh builds its instance roots one guarded append per root:
//   [ -d "$ROOT/src" ] && SCAN_ROOTS+=("$ROOT/src")
function deriveGenericityRoots(src) {
  const roots = [];
  const re = /SCAN_ROOTS\+=\("\$ROOT\/([^"]+)"\)/g;
  let m;
  while ((m = re.exec(src)) !== null) roots.push(m[1]);
  return roots;
}

// check-english-only.mjs declares its instance roots as one array literal:
//   const SCAN_ROOTS = ['src', 'scripts', ...];
function deriveEnglishOnlyRoots(src) {
  const m = /const\s+SCAN_ROOTS\s*=\s*\[([^\]]*)\]/.exec(src);
  if (!m) return null;
  return m[1]
    .split(',')
    .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

// Both gates must still treat the `.sekai-template` marker as a whole-tree scan;
// every registered site states that, so a change here invalidates all of them.
function genericityScansWholeTreeInTemplateMode(src) {
  return /\.sekai-template"\s*\]\s*;\s*then[\s\S]{0,200}?SCAN_ROOTS=\("\$ROOT"\)/.test(src);
}

function englishOnlyScansWholeTreeInTemplateMode(src) {
  return /existsSync\(join\(ROOT,\s*'\.sekai-template'\)\)\)[\s\S]{0,200}?walk\(ROOT\)/.test(src);
}

const normalize = (root) => root.replace(/\/+$/, '');
const asSet = (roots) => [...new Set(roots.map(normalize))].sort().join(', ');

/* -- The registry: which statement describes which gate's root set -- */
//
// Each entry's `anchor` has exactly one capture group, and that group captures
// ONLY the enumeration -- comma-separated roots terminated by `;`, `)`, or the
// end of the line. Anchors carry prose, never roots, so they stay valid when the
// scripts change and fail loudly when the prose changes.

const REGISTRY = [
  {
    file: 'scripts/ci/genericity-denylist.txt',
    label: 'denylist header, instance-mode scope note',
    gate: 'genericity',
    scope: 'framework',
    anchor: /Instance\s+mode:\s+this\s+gate\s+scans\s+([^;]+);/,
  },
  {
    file: GENERICITY_SCRIPT,
    label: 'script header, failure description',
    gate: 'genericity',
    scope: 'framework',
    anchor: /leaks\s+into\s+framework-owned\s+code\s+\(([^)]+)\)/,
  },
  {
    file: GENERICITY_SCRIPT,
    label: 'script header, "Scan scope" note',
    gate: 'genericity',
    scope: 'framework',
    anchor: /Scan\s+scope,\s+instance\s+mode:\s+([^;]+);/,
  },
  {
    file: GENERICITY_SCRIPT,
    label: 'MODE label printed with every result',
    gate: 'genericity',
    scope: 'framework',
    anchor: /MODE="instance\s+\(([^)]+)\)"/,
  },
  {
    file: GENERICITY_SCRIPT,
    label: 'no-scan-roots-present message',
    gate: 'genericity',
    scope: 'framework',
    anchor: /passed[^"\n]*no\s+([^"\n]+)\s+to\s+scan"/,
  },
  {
    file: ENGLISH_ONLY_SCRIPT,
    label: 'script header, failure description',
    gate: 'english-only',
    scope: 'framework',
    anchor: /codepoint\s+appears\s+in\s+a\s+committed\s+code\s+tree\s+\(([^)]+)\)/,
  },
  {
    file: ENGLISH_ONLY_SCRIPT,
    label: 'template-mode comment, instance-mode fallback',
    gate: 'english-only',
    scope: 'framework',
    anchor: /reverting\s+to\s+the\s+code\s+trees\s+only\s+\(([^)]+)\)/,
  },
  {
    file: '.github/workflows/deploy.yml',
    label: 'CI step name, genericity gate',
    gate: 'genericity',
    scope: 'framework',
    anchor: /Check\s+for\s+place-specific\s+strings\s+in\s+([^\n]+)\n/,
  },
  {
    file: '.github/workflows/deploy.yml',
    label: 'CI step name, English-only gate',
    gate: 'english-only',
    scope: 'framework',
    anchor: /Check\s+for\s+CJK\s+codepoints\s+\(English-only\)\s+in\s+([^\n]+)\n/,
  },
  {
    file: 'docs/runbook/DEPLOY.md',
    label: 'Quality gates section, denylist gate roots',
    gate: 'genericity',
    scope: 'framework',
    anchor: /the\s+place-name\s+denylist\s+gate\s+scans\s+([^;]+);/,
  },
  {
    file: 'docs/runbook/DEPLOY.md',
    label: 'Quality gates section, English-only gate roots',
    gate: 'english-only',
    scope: 'framework',
    anchor: /the\s+English-only\s+gate\s+scans\s+([^;]+);/,
  },
  {
    // Framework maintainer doc (ADR 008): authored here, removed at adoption, so it
    // is required in template mode and skipped once the wizard has run.
    file: 'dev_docs/SPEC.md',
    label: 'Negative requirements, denylist gate roots',
    gate: 'genericity',
    scope: 'instance',
    anchor: /the\s+place-name\s+denylist\s+gate\s+scans\s+([^;]+);/,
  },
  {
    file: 'dev_docs/SPEC.md',
    label: 'Negative requirements, English-only gate roots',
    gate: 'english-only',
    scope: 'instance',
    anchor: /the\s+English-only\s+gate\s+scans\s+([^;]+);/,
  },
  {
    file: 'scripts/init/writer.mjs',
    label: 'wizard-emitted instance AGENTS.md, iron rule 2 (denylist gate)',
    gate: 'genericity',
    scope: 'framework',
    anchor: /\(place-name\s+denylist\)\s+scans\s+([^;]+);/,
  },
  {
    file: 'scripts/init/writer.mjs',
    label: 'wizard-emitted instance AGENTS.md, iron rule 2 (English-only gate)',
    gate: 'english-only',
    scope: 'framework',
    anchor: /\(CJK\s+codepoints\)\s+scans\s+([^;]+);/,
  },
  {
    file: 'AGENTS.md',
    label: 'iron rule 2, denylist gate roots',
    gate: 'genericity',
    scope: 'instance',
    anchor: /\(place-name\s+denylist\)\s+scans\s+([^;]+);/,
  },
  {
    file: 'AGENTS.md',
    label: 'iron rule 2, English-only gate roots',
    gate: 'english-only',
    scope: 'instance',
    anchor: /\(CJK\s+codepoints\)\s+scans\s+([^;]+);/,
  },
  {
    file: 'README.md',
    label: 'Genericity section, denylist gate roots',
    gate: 'genericity',
    scope: 'instance',
    anchor: /the\s+place-name\s+denylist\s+gate\s+scans\s+([^;]+);/,
  },
  {
    file: 'README.md',
    label: 'Genericity section, English-only gate roots',
    gate: 'english-only',
    scope: 'instance',
    anchor: /the\s+English-only\s+CJK\s+gate\s+scans\s+([^;]+);/,
  },
  {
    file: '.sekai-template',
    label: 'template marker, instance-mode denylist gate roots',
    gate: 'genericity',
    scope: 'instance',
    anchor: /check-genericity\.sh\s+scans\s+([^;]+);/,
  },
  {
    file: '.sekai-template',
    label: 'template marker, instance-mode English-only gate roots',
    gate: 'english-only',
    scope: 'instance',
    anchor: /check-english-only\.mjs\s+scans\s+([^;]+);/,
  },
  {
    // LB-51 fixed this one; LB-53 only proves the guard agrees with it.
    file: '.agent-toolkit/rules/genericity-gate-scope.md',
    label: 'doctrine rule, denylist gate roots',
    gate: 'genericity',
    scope: 'instance',
    anchor: /check-genericity\.sh[\s\S]{0,20}?five\s+roots:\s+([\s\S]*?`)\.\n/,
  },
  {
    file: '.agent-toolkit/rules/genericity-gate-scope.md',
    label: 'doctrine rule, English-only gate roots',
    gate: 'english-only',
    scope: 'instance',
    anchor: /check-english-only\.mjs[\s\S]{0,20}?five\s+roots:\s+([\s\S]*?`)\.\s/,
  },
];

/* -- Statement parsing -- */

const COUNT_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

// A captured enumeration may span lines and carry the host file's comment
// markers (`#`, `//`), markdown list indentation, backticks, and a template
// literal's escaped backticks. Strip all of that, then split on commas.
function parseRoots(span) {
  return span
    .split('\n')
    .map((line) => line.replace(/^\s*(?:#|\/\/|\*)\s?/, ''))
    .join(' ')
    .split(',')
    .map((token) => token.trim().replace(/^(?:and|or)\s+/i, ''))
    .map((token) => token.replace(/[`'"\\]/g, '').trim())
    .map(normalize)
    .filter(Boolean);
}

function firstGroup(match) {
  for (let i = 1; i < match.length; i++) {
    if (match[i] !== undefined) return match[i];
  }
  return undefined;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/* -- Run -- */

const failures = [];
const skipped = [];
let checked = 0;

let genericitySource;
let englishOnlySource;
try {
  genericitySource = read(GENERICITY_SCRIPT);
  englishOnlySource = read(ENGLISH_ONLY_SCRIPT);
} catch (err) {
  console.error(`FAIL: scan-root docs guard cannot read a gate script: ${err.message}`);
  process.exit(1);
}

const genericityRoots = deriveGenericityRoots(genericitySource);
const englishOnlyRoots = deriveEnglishOnlyRoots(englishOnlySource);

if (genericityRoots.length === 0) {
  failures.push(
    `${GENERICITY_SCRIPT}: no instance-mode SCAN_ROOTS+= lines found -- the guard ` +
      'cannot derive the genericity gate roots. Re-point the derivation in this guard.',
  );
}
if (!englishOnlyRoots || englishOnlyRoots.length === 0) {
  failures.push(
    `${ENGLISH_ONLY_SCRIPT}: no SCAN_ROOTS array literal found -- the guard cannot ` +
      'derive the English-only gate roots. Re-point the derivation in this guard.',
  );
}
if (!genericityScansWholeTreeInTemplateMode(genericitySource)) {
  failures.push(
    `${GENERICITY_SCRIPT}: template mode no longer scans the whole tree; every ` +
      'documented template-mode claim is now stale.',
  );
}
if (!englishOnlyScansWholeTreeInTemplateMode(englishOnlySource)) {
  failures.push(
    `${ENGLISH_ONLY_SCRIPT}: template mode no longer scans the whole tree; every ` +
      'documented template-mode claim is now stale.',
  );
}

if (failures.length) {
  console.error('FAIL: scan-root docs guard could not derive the gate root sets:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

const EXPECTED = {
  genericity: asSet(genericityRoots),
  'english-only': asSet(englishOnlyRoots),
};

const templateMode = existsSync(join(ROOT, '.sekai-template'));

for (const site of REGISTRY) {
  const abs = join(ROOT, site.file);
  const required = site.scope === 'framework' || templateMode;

  if (!existsSync(abs)) {
    if (required) {
      failures.push(
        `${site.file}: registered file is missing (${site.label}). A registered ` +
          'scope statement cannot be checked, which is a failure, not a pass.',
      );
    } else {
      skipped.push(`${site.file} (absent)`);
    }
    continue;
  }

  const text = readFileSync(abs, 'utf8');
  const match = site.anchor.exec(text);
  if (!match) {
    if (required) {
      failures.push(
        `${site.file}: anchor NOT FOUND for "${site.label}". The statement was ` +
          'reworded, moved, or deleted -- re-point this guard\'s registry entry in ' +
          'the same commit.',
      );
    } else {
      skipped.push(`${site.file} (${site.label}: adopter-reworded)`);
    }
    continue;
  }

  const span = firstGroup(match);
  const found = parseRoots(span);
  const line = lineOf(text, match.index);
  const expected = EXPECTED[site.gate];

  if (asSet(found) !== expected) {
    failures.push(
      `${site.file}:${line}: ${site.label} (${site.gate} gate)\n` +
        `      found:    ${asSet(found) || '(none)'}\n` +
        `      expected: ${expected}`,
    );
    continue;
  }

  const context = text.slice(Math.max(0, match.index - 60), match.index + match[0].length);
  const countWord = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+roots\b/i.exec(context);
  if (countWord && COUNT_WORDS[countWord[1].toLowerCase()] !== found.length) {
    failures.push(
      `${site.file}:${line}: ${site.label} (${site.gate} gate)\n` +
        `      found:    ${found.length} roots (${asSet(found)}), introduced as "${countWord[1]} roots"\n` +
        `      expected: the count word to match the ${found.length}-root list`,
    );
    continue;
  }

  checked += 1;
}

if (failures.length) {
  console.error('FAIL: scan-root scope statements do not match the gates\' SCAN_ROOTS:');
  for (const f of failures) console.error(`  ${f}`);
  console.error('');
  console.error(`  genericity gate roots (${GENERICITY_SCRIPT}):   ${EXPECTED.genericity}`);
  console.error(`  english-only gate roots (${ENGLISH_ONLY_SCRIPT}): ${EXPECTED['english-only']}`);
  console.error('  Fix the statement, or re-point this guard if the statement moved.');
  process.exit(1);
}

const mode = templateMode ? 'template mode' : 'instance mode';
const skips = skipped.length ? `; ${skipped.length} instance-owned skipped: ${skipped.join(', ')}` : '';
console.log(
  `OK: scan-root docs guard passed [${mode}] -- ${checked} statements match ` +
    `(genericity: ${EXPECTED.genericity}; english-only: ${EXPECTED['english-only']})${skips}`,
);
