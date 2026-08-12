#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';

const fail = (message) => {
  console.error(`version-contract FAILED: ${message}`);
  process.exit(1);
};

const readVersion = (path) => {
  if (!existsSync(path)) fail(`${path} is missing`);
  const value = readFileSync(path, 'utf8').trim();
  if (!/^v\d+\.\d+\.\d+$/.test(value)) {
    fail(`${path} must contain one v-prefixed semantic version, got ${JSON.stringify(value)}`);
  }
  return value;
};

const frameworkVersion = readVersion('FRAMEWORK-VERSION');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const isTemplate = existsSync('.sekai-template');
const releaseVersion = isTemplate ? frameworkVersion : readVersion('VERSION');
const npmVersion = releaseVersion.slice(1);

if (pkg.private !== true) fail('package.json must set "private": true');
if (isTemplate && existsSync('VERSION')) {
  fail('VERSION must not exist in the framework template; use FRAMEWORK-VERSION');
}
if (pkg.version !== npmVersion) {
  fail(`package.json.version must match ${isTemplate ? 'FRAMEWORK-VERSION' : 'VERSION'} without the leading v`);
}
if (lock.version !== npmVersion || lock.packages?.['']?.version !== npmVersion) {
  fail('package-lock.json root versions must match package.json.version');
}
if (lock.name !== pkg.name || lock.packages?.['']?.name !== pkg.name) {
  fail('package.json and package-lock.json root package names must match');
}

if (isTemplate && process.env.GITHUB_REF_TYPE === 'tag') {
  const expectedTag = `sekai-kb-${frameworkVersion}`;
  if (process.env.GITHUB_REF_NAME !== expectedTag) {
    fail(`framework tag must match FRAMEWORK-VERSION: expected ${expectedTag}, got ${process.env.GITHUB_REF_NAME}`);
  }
}

/* -- Documented Node floor: derived from engines, never restated by hand -- */
//
// `package.json` `engines.node` is the operative floor, and a dozen adopter-facing
// and maintainer-facing statements repeat it: the README, the runbook table, the
// wizard-emitted instance README, the adopt skill, the engineering SSOT. Nothing
// checked them, so raising the floor for `node:sqlite` left four of them promising
// a version that no longer runs the test suite. A wrong floor is worse than an
// absent one: an adopter installs on it, sees only an npm engine warning, and
// fails at a gate the statement told them they satisfied.
//
// This guard DERIVES the floor from `engines.node` and asserts every registered
// statement names it. Raising the floor therefore changes what this guard demands
// with no second edit here: the registry holds anchors (prose), never versions.
//
// Failure modes, all exit 1:
//   - a registered statement names a version that is not the `engines.node` floor;
//   - a registered anchor is NOT FOUND (someone reworded, moved, or deleted the
//     statement). A statement that cannot be found is exactly how a stale one
//     hides, so this fails rather than silently passing. Re-point the registry
//     entry in the same commit that rewords the statement;
//   - `engines.node` is absent or is not a plain `>=X.Y.Z` floor.
//
// Scopes match the scan-root docs guard: `framework` files are present in every
// checkout and always required; `instance` files are adopter-owned (`merge=ours`)
// or removed at adoption (`dev_docs/`, ADR 008), so they are required in template
// mode and reported as skipped once an adopter owns or drops the prose.
//
// CHANGELOG.md is deliberately NOT registered: it is a historical release log
// whose Upgrade notes must keep naming the floor each release moved from.

const NODE_FLOOR_STATEMENTS = [
  {
    file: 'README.md',
    label: 'Prerequisites list',
    scope: 'instance',
    anchor: /\*\*Node\.js\s+(?:>=|≥)\s*([\d.]+)\*\*/,
  },
  {
    file: 'docs/runbook/DEPLOY.md',
    label: 'Prerequisites table',
    scope: 'framework',
    anchor: /\|\s*Node\.js\s*\|\s*(?:>=|≥)\s*([\d.]+)\s*\|/,
  },
  {
    file: 'dev_docs/SPEC.md',
    label: 'Stack, operative floor',
    scope: 'instance',
    anchor: /Node\s+(?:>=|≥)\s*([\d.]+)\s*\(`package\.json`\s+`engines`\s+is\s+the\s+operative\s+floor\)/,
  },
  {
    file: 'scripts/init/writer.mjs',
    label: 'wizard-emitted instance README, Quick start',
    scope: 'framework',
    anchor: /Requires\s+Node\.js\s+(?:>=|≥)\s*([\d.]+)\s+and\s+\[uv\]/,
  },
  {
    file: '.agents/skills/sekai-adopt/SKILL.md',
    label: 'preflight, version floor pointer',
    scope: 'framework',
    anchor: /prerequisites\s+and\s+version\s+floor\s+are\s+in[^(]*\(Node\s+(?:>=|≥)\s*([\d.]+),/,
  },
  {
    file: '.agents/skills/sekai-adopt/SKILL.md',
    label: 'deploy walkthrough, Prerequisites bullet',
    scope: 'framework',
    anchor: /\*\*Prerequisites\*\*\s*\+\s*\*\*Install\*\*\s*—\s*Node\s+(?:>=|≥)\s*([\d.]+),/,
  },
];

const enginesNode = pkg.engines?.node;
if (typeof enginesNode !== 'string' || !/^>=\d+\.\d+\.\d+$/.test(enginesNode)) {
  fail(
    'package.json engines.node must be a plain ">=X.Y.Z" floor so the documented ' +
      `Node version can be derived from it, got ${JSON.stringify(enginesNode)}`,
  );
}
const floor = enginesNode.slice(2);
const [floorMajor, floorMinor, floorPatch] = floor.split('.');

// A statement may name the floor as X.Y or X.Y.Z; both are the same floor as long
// as an omitted patch is the floor's own. `22.13` states `>=22.13.0`; `22.12` does
// not, whatever the patch.
const statesFloor = (stated) => {
  const parts = stated.split('.');
  if (parts.length === 2) return parts[0] === floorMajor && parts[1] === floorMinor && floorPatch === '0';
  if (parts.length === 3) return stated === floor;
  return false;
};

const floorFailures = [];
const floorSkipped = [];
let floorChecked = 0;

for (const site of NODE_FLOOR_STATEMENTS) {
  const required = site.scope === 'framework' || isTemplate;

  if (!existsSync(site.file)) {
    if (required) {
      floorFailures.push(
        `${site.file}: registered file is missing (${site.label}). A registered ` +
          'Node floor statement cannot be checked, which is a failure, not a pass.',
      );
    } else {
      floorSkipped.push(`${site.file} (absent)`);
    }
    continue;
  }

  const text = readFileSync(site.file, 'utf8');
  const match = site.anchor.exec(text);
  if (!match) {
    if (required) {
      floorFailures.push(
        `${site.file}: anchor NOT FOUND for "${site.label}". The statement was ` +
          "reworded, moved, or deleted -- re-point this guard's registry entry in " +
          'the same commit.',
      );
    } else {
      floorSkipped.push(`${site.file} (${site.label}: adopter-reworded)`);
    }
    continue;
  }

  if (!statesFloor(match[1])) {
    const line = text.slice(0, match.index).split('\n').length;
    floorFailures.push(
      `${site.file}:${line}: ${site.label}\n` +
        `      found:    Node ${match[1]}\n` +
        `      expected: Node ${floor} (package.json engines.node ${enginesNode})`,
    );
    continue;
  }

  floorChecked += 1;
}

if (floorFailures.length) {
  console.error('version-contract FAILED: documented Node floor does not match package.json engines.node:');
  for (const f of floorFailures) console.error(`  ${f}`);
  console.error('');
  console.error(`  engines.node: ${enginesNode}`);
  console.error('  Fix the statement, or re-point this guard if the statement moved.');
  process.exit(1);
}

const floorSkips = floorSkipped.length
  ? `; ${floorSkipped.length} instance-owned skipped: ${floorSkipped.join(', ')}`
  : '';

console.log(
  `OK: ${isTemplate ? 'framework' : 'adopter'} package ${pkg.name} ${pkg.version}; FRAMEWORK-VERSION ${frameworkVersion}; ` +
    `${floorChecked} Node floor statements match engines.node ${enginesNode}${floorSkips}`,
);
