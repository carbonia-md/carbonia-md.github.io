#!/usr/bin/env node
// gen-worker-config.mjs -- write each worker's effective deploy config from
// place.config.ts. Run it with `npm run worker-config`.
//
// A Worker script name and a D1 database_name are ACCOUNT-scoped: two instances that
// deploy under the same names collide in one Cloudflare account, the second
// overwriting the first's script and rebinding it to the second's database. The
// allowed origin is likewise this instance's own. All three are place identity, and
// workers/ is scanned by both machine gates (AGENTS.md iron rule 2), so none of them
// may be committed there. They are derived here instead, at deploy time, into a
// gitignored wrangler.generated.toml beside each committed template.
//
// DERIVATION RULE (implemented in scripts/deploy/wrangler-config.mjs, restated in
// docs/runbook/DEPLOY.md):
//
//   name = database_name = "<place-slug>-<worker-directory-name>"
//
// where <place-slug> is `place.name` lowercased, every run of characters outside
// [a-z0-9] collapsed to a single "-", leading and trailing "-" removed, truncated to
// 40 characters, then any trailing "-" the cut exposed removed again -- so a name the
// truncation lands mid-separator on yields "<slug>-feedback", never "<slug>--feedback".
// workers/feedback/ therefore deploys as "<place-slug>-feedback".
//
//   ALLOWED_ORIGIN = `place.domain`, with https:// added when it carries no scheme.
//   database_id    = `workers.<worker>DatabaseId` in place.config.ts, when set.
//
// A second, smaller class of value is derived here too: the deploy-time tuning vars
// registered in WORKER_VAR_OVERRIDES (scripts/deploy/wrangler-config.mjs). Those are
// not place identity -- the framework ships a real default for each -- but the
// framework asks an instance to retune them against its own corpus and its own
// readers, and the committed template is framework-owned, so the answer has to land
// somewhere else. Each carries a `workers.<key>` in place.config.ts and is written
// into the generated config ONLY when that key is set.
//
// Everything else in the template -- main, compatibility_date, the D1 binding, and
// migrations_dir -- is carried through byte for byte, as is every registered tuning
// var whose place.config.ts key is unset.
//
// place.config.ts is optional in one direction only: an absent `workers` block, or an
// unset database id, generates a config with an empty database_id and says so. That
// is the state right after `wrangler d1 create`, before its id has been recorded, and
// it is absent-safe by design (SPEC: new place.config keys must be absent-safe).
//
// Usage: node --experimental-strip-types scripts/deploy/gen-worker-config.mjs
//        (run from anywhere; --root <dir> targets another checkout)
//
// This file lives under scripts/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import {
  GENERATED_BASENAME,
  TEMPLATE_BASENAME,
  WORKER_VAR_OVERRIDES,
  applyOverrides,
  originFromDomain,
  overrideVarValue,
  parseWranglerToml,
  stripLeadingComments,
  workerName,
} from './wrangler-config.mjs';

const DEFAULT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function parseArgs(argv) {
  let root = DEFAULT_ROOT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      root = argv[i + 1];
      i += 1;
      if (!root) fail('--root needs a directory');
    } else {
      fail(`unknown argument "${argv[i]}"`);
    }
  }
  return { root };
}

function fail(message) {
  console.error(`FAIL: worker config generation -- ${message}`);
  process.exit(1);
}

const { root } = parseArgs(process.argv.slice(2));
const workersDir = join(root, 'workers');
const configPath = join(root, 'place.config.ts');

if (!existsSync(workersDir)) {
  console.log('OK: no workers/ tree in this checkout -- nothing to generate.');
  process.exit(0);
}
if (!existsSync(configPath)) {
  fail(`place.config.ts not found at ${configPath}. Worker names and the allowed origin are derived from it.`);
}

let place;
try {
  place = (await import(pathToFileURL(configPath).href)).default;
} catch (err) {
  fail(
    `place.config.ts could not be imported (${err.message}).\n` +
      '  Run this through `npm run worker-config`, which passes the type-stripping flag Node needs.',
  );
}

const placeName = place?.place?.name;
const domain = place?.place?.domain;
if (!placeName) fail('place.config.ts has no place.name; the derivation rule has nothing to work from.');
if (!domain) fail('place.config.ts has no place.domain; ALLOWED_ORIGIN would be empty and every request would 403.');

const origin = originFromDomain(domain);
const workerDirs = readdirSync(workersDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(workersDir, e.name, TEMPLATE_BASENAME)))
  .map((e) => e.name)
  .sort();

if (workerDirs.length === 0) {
  fail(`workers/ contains no directory with a ${TEMPLATE_BASENAME}; there is nothing to generate from.`);
}

const notes = [];
const warnings = [];
let written = 0;

for (const dir of workerDirs) {
  const templatePath = join(workersDir, dir, TEMPLATE_BASENAME);
  const outPath = join(workersDir, dir, GENERATED_BASENAME);
  const template = readFileSync(templatePath, 'utf8');

  let parsed;
  try {
    parsed = parseWranglerToml(template);
  } catch (err) {
    fail(`workers/${dir}/${TEMPLATE_BASENAME}: ${err.message}`);
  }

  const name = workerName(placeName, dir);
  const overrides = [{ table: '', key: 'name', value: name, required: true }];

  if (parsed.tables.vars && 'ALLOWED_ORIGIN' in parsed.tables.vars) {
    overrides.push({ table: 'vars', key: 'ALLOWED_ORIGIN', value: origin, required: true });
  }

  if (parsed.tables.vars && 'SITE_ORIGIN' in parsed.tables.vars) {
    overrides.push({ table: 'vars', key: 'SITE_ORIGIN', value: origin, required: true });
  }

  if (parsed.tables.vars && 'SITE_NAME' in parsed.tables.vars) {
    overrides.push({ table: 'vars', key: 'SITE_NAME', value: placeName, required: true });
  }

  if (parsed.tables.vars && 'CATEGORY_COLORS' in parsed.tables.vars) {
    const colorMap = {};
    for (const cat of place?.categories ?? []) {
      if (cat.slug && cat.color) colorMap[cat.slug] = cat.color;
    }
    overrides.push({ table: 'vars', key: 'CATEGORY_COLORS', value: JSON.stringify(colorMap), required: true });
  }

  // Deploy-time tuning vars an instance may retune from place.config.ts. Unset is
  // the absent-safe default: no override is pushed and the template constant is
  // carried through, which is what keeps a config that sets none byte-identical to
  // one generated before these keys existed.
  for (const [varName, spec] of Object.entries(WORKER_VAR_OVERRIDES[dir] ?? {})) {
    const configured = place?.workers?.[spec.configKey];
    if (configured === undefined) continue;
    if (!(parsed.tables.vars && varName in parsed.tables.vars)) {
      // Same guard as the five overrides above, opposite branch: those keys are
      // framework-derived and skipping a template that dropped one is harmless, but
      // this one was typed by a person who expects it to take effect, so it is said
      // out loud. Not fatal, though -- an instance reaching this reached it by
      // upgrading, and refusing to generate would leave them unable to deploy the
      // other five workers over one stale key. The framework side of the same
      // contract is fatal at CI time instead: check-worker-config.mjs fails when an
      // override is registered for a var the committed template does not carry.
      warnings.push(
        `WARNING: place.config.ts sets \`workers.${spec.configKey}\` (${configured}), but\n` +
          `workers/${dir}/${TEMPLATE_BASENAME} no longer carries a [vars] ${varName}.\n` +
          '\n' +
          'A framework release removed it, which usually means the worker no longer\n' +
          'reads it -- your value would have no effect, so it was not written.\n' +
          '\n' +
          '  - If you no longer need it: remove the key from place.config.ts.\n' +
          '  - If you still need the behavior: the worker source changed too, so\n' +
          "    review that release's CHANGELOG before upgrading further.\n" +
          '\n' +
          'Generated without it.',
      );
      continue;
    }
    let value;
    try {
      value = overrideVarValue(spec.configKey, configured, spec.kind);
    } catch (err) {
      fail(err.message);
    }
    overrides.push({ table: 'vars', key: varName, value, required: true });
  }

  if (parsed.arrays.d1_databases?.length) {
    // `workers.<worker>DatabaseId` in place.config.ts: instance-owned, outside every
    // gate scan root, and absent-safe -- an unset id generates an empty value and a
    // note rather than blocking the `d1 create` step that produces it.
    const idKey = `${dir}DatabaseId`;
    const databaseId = place?.workers?.[idKey] ?? '';
    overrides.push(
      { table: 'd1_databases', key: 'database_name', value: name, required: true },
      { table: 'd1_databases', key: 'database_id', value: databaseId, required: true },
    );
    if (!databaseId) {
      notes.push(
        `workers/${dir}: database_id is empty. Run \`npx wrangler d1 create ${name}\`, put the ` +
          `id it prints in place.config.ts as \`workers.${idKey}\`, then regenerate.`,
      );
    }
  }

  let body;
  try {
    body = applyOverrides(stripLeadingComments(template), overrides);
  } catch (err) {
    fail(`workers/${dir}/${TEMPLATE_BASENAME}: ${err.message}`);
  }

  const header = [
    `# ${GENERATED_BASENAME} -- GENERATED. Do not edit, do not commit.`,
    '#',
    `# Written by scripts/deploy/gen-worker-config.mjs (npm run worker-config) from`,
    `# place.config.ts and workers/${dir}/${TEMPLATE_BASENAME}. Regenerate after either`,
    "# changes; edits here are overwritten. This file carries this instance's own",
    '# account-scoped deployment identity, which is why it is gitignored: workers/ is',
    '# scanned by both machine gates (AGENTS.md iron rule 2).',
    '#',
    `# Derived name: "${name}" (<place-slug>-${dir}, from place.name).`,
    '',
    '',
  ].join('\n');

  writeFileSync(outPath, header + body, 'utf8');
  written += 1;
  console.log(`  workers/${dir}/${GENERATED_BASENAME}  name=${name}`);
}

// Warnings go to stderr, ahead of the OK summary: generation succeeded, but a value
// the operator recorded on purpose did not make it into the config, and that must not
// scroll past inside a list of per-worker success lines.
for (const warning of warnings) console.error(`\n${warning}\n`);
for (const note of notes) console.log(`  note: ${note}`);
console.log(
  `OK: generated ${written} worker config(s). Deploy with ` +
    `\`npx wrangler deploy --config workers/<worker>/${GENERATED_BASENAME}\`.`,
);
