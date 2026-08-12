#!/usr/bin/env node
// check-worker-config.mjs -- the committed-worker-config gate.
//
// Every deploy value a Cloudflare Worker carries is place identity: the Worker script
// name and the D1 database_name are ACCOUNT-scoped (two instances sharing them
// collide in one account), and ALLOWED_ORIGIN names this instance's site. workers/ is
// a code tree under iron rule 2, so none of them may be committed there; they are
// generated at deploy time into a gitignored wrangler.generated.toml instead
// (scripts/deploy/gen-worker-config.mjs).
//
// The denylist gate cannot catch this class on its own. It fires on a place NAME, so
// `ALLOWED_ORIGIN = "https://example.com"` or `name = "coastal-feedback"` passes it
// cleanly while being exactly the value that must not be committed. This gate asserts
// the committed template still carries the framework placeholders, which is a
// statement about the file rather than about any particular place.
//
// TWO MODES (ADR 010) -------------------------------------------------------
//
// This gate runs in the framework's own repository AND in every adopter's, because
// adoption copies .github/workflows/deploy.yml along with everything else. Those are
// not the same situation, and the mode is read from the `.sekai-template` marker at
// the --root this gate was pointed at:
//
//   TEMPLATE MODE (marker present) -- the framework's own tree. Every check below is
//   fatal. A changed default has to be a deliberate edit to EXPECTED as well as to
//   the template, which is what keeps this a contract rather than a restatement of
//   whatever the file happens to say today.
//
//   INSTANCE MODE (marker absent) -- an adopter's tree, where workers/ is their file
//   in their repository. A framework gate may fail their build only for something
//   that harms a party other than the person editing (ADR 010 (a)): account-scoped
//   collisions, committed credentials, security boundaries. Every other divergence
//   warns, names both values, and names the upgrade cost. An adopter retuning a
//   number that is theirs to tune is not a build error; the cost of that edit is a
//   merge conflict at the next /sekai-upgrade, and saying so is this gate's whole job
//   there.
//
// Fatal in BOTH modes -- deployment identity, plus the two structural checks without
// which the identity checks cannot run at all:
//   - a committed workers/<w>/wrangler.toml this reader cannot parse (an unparsed
//     config is one nothing is checking, including nothing checking its identity);
//   - a worker directory with no expectation registered below (a new worker must
//     declare what it ships with, rather than being exempt by omission -- an
//     unregistered worker is one whose `name` and `database_name` go unchecked);
//   - `name`, or any `[[d1_databases]]` `database_name` or `database_id`, that is not
//     the framework placeholder, or missing outright. Both are ACCOUNT-scoped: two
//     instances sharing one is a collision inside someone else's account;
//   - `[vars] ALLOWED_ORIGIN` changed or deleted. It is the chat and feedback workers'
//     CORS boundary -- a security boundary, not a tuning constant -- and the generator
//     only rewrites keys the template already carries, so deleting it is not a way to
//     pass either;
//   - a `[[d1_databases]]` block set that does not match the bindings registered
//     below, including a deleted one (removing the whole block is not a way to pass
//     either: the generator only rewrites keys the template already has, so a
//     template with no D1 block generates a deploy config with no `env.DB`);
//   - a derived worker artifact tracked by git. Two exist: wrangler.generated.toml
//     (`npm run worker-config`) and workers/chat/vectors.json (`npm run
//     embeddings:build`). Both are gitignored and both are skipped by name in the two
//     machine gates, so committing one would smuggle place identity past them -- the
//     deploy config through its origin and worker names, the vector index through every
//     article title, url, and body chunk it carries.
//
// Fatal in template mode, a WARNING in instance mode -- divergence from a
// framework-owned file whose only cost lands on the person who made it:
//   - any other [vars] value that is not the constant the framework ships, and any
//     other registered [vars] key deleted from the template. The classification is
//     derived, never duplicated (ADR 010 (c)): WORKER_VAR_OVERRIDES in
//     scripts/deploy/wrangler-config.mjs already names the keys an instance is invited
//     to retune, and the warning points at the place.config.ts key that records the
//     same value without a conflict;
//   - a [vars] key the template does not register. In an adopter's tree that is a var
//     they added, which is the edit right ADR 010 (d) grants them; in the framework's
//     it is still a worker nothing is checking;
//   - an override registered for a [vars] key the committed template does not carry.
//     The generator's half of that contract already warns and drops the value, because
//     an instance that hits it hit it by upgrading and still has to be able to deploy;
//     failing in template mode is what keeps the framework from shipping the mismatch
//     in the first place;
//   - an [ai] binding that is missing, renamed, or unregistered. A chat worker without
//     it cannot call env.AI.run -- which breaks that instance's own deployment and
//     nobody else's;
//   - a documented default in docs/runbook/DEPLOY.md that disagrees with the constant
//     the template ships, a registered default the runbook documents nowhere, and a
//     runbook table whose `<!-- worker-vars: <name> -->` anchor is gone. The runbook is
//     the only place an operator reads these values, and it ships to every adopter on
//     the next tag merge, so a retuned constant with a stale table is a wrong number
//     with no way for its reader to know;
//   - a runbook row whose Source cell disagrees with WORKER_VAR_OVERRIDES about where
//     an instance records a retuned value: an overridable var whose row names no
//     `workers.<key>`, a row naming a key no override is registered for, or a row
//     naming the wrong one. Telling an operator to measure a value and not telling them
//     where to put the answer is the defect this whole override path exists to fix, and
//     it comes back the moment the two drift.
//
// Warnings exit 0. They are printed for a human and, under GitHub Actions, emitted as
// `::warning file=<path>::<message>` so the divergence reaches the run summary and the
// pull request rather than only a log nobody opens. /sekai-upgrade reports the same
// files again at merge time, with the framework's incoming value beside the instance's
// (ADR 010 (e)); neither message alone is enough.
//
// Success prints one summary line naming the mode, plus any warnings, and exits 0.
//
// Usage: node scripts/ci/check-worker-config.mjs [--root <dir>]
//
// This file lives under scripts/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  GENERATED_BASENAME,
  PLACEHOLDER,
  TEMPLATE_BASENAME,
  WORKER_VAR_OVERRIDES,
  parseWranglerToml,
} from '../deploy/wrangler-config.mjs';

/* -- What each worker ships with -------------------------------------------
 *
 * One entry per directory under workers/. `vars` lists EVERY key the template's
 * [vars] block carries and the exact framework constant for each: an empty
 * ALLOWED_ORIGIN (the worker fail-closes on it -- see workers/feedback/test/
 * cors.test.mjs) plus the rate-limit defaults. `name`, `database_name`, and
 * `database_id` are always the placeholder, so they are not repeated per worker.
 *
 * `d1Bindings` lists the `binding` of every [[d1_databases]] block the template
 * ships, in order, and is what makes a deleted block a failure rather than a pass.
 * The generator rewrites keys the template already carries; it never adds a block.
 * So a template whose D1 block went missing still generates cleanly, and the
 * deployed worker reaches `env.DB.prepare` with `env.DB` undefined -- a checkable
 * count here is the only place that stays wrong loudly.
 *
 * A framework change to a default is a deliberate edit here as well as in the
 * template; that second edit is what keeps this gate a contract rather than a
 * restatement of whatever the file happens to say today.
 */
const EXPECTED = {
  chat: {
    vars: {
      ALLOWED_ORIGIN: '',
      SITE_NAME: '',
      RATE_LIMIT_MAX: '20',
      RATE_LIMIT_WINDOW_SECONDS: '3600',
      RELEVANCE_FLOOR: '0.46',
    },
    aiBinding: 'AI',
    d1Bindings: ['DB'],
  },
  feedback: {
    vars: {
      ALLOWED_ORIGIN: '',
      RATE_LIMIT_MAX: '5',
      RATE_LIMIT_WINDOW_SECONDS: '3600',
    },
    d1Bindings: ['DB'],
  },
  og: {
    vars: {
      SITE_ORIGIN: '',
      SITE_NAME: '',
      CATEGORY_COLORS: '',
    },
    d1Bindings: [],
  },
};

const DEFAULT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

let root = DEFAULT_ROOT;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root') {
    root = argv[i + 1];
    i += 1;
    if (!root) {
      console.error('FAIL: --root needs a directory');
      process.exit(1);
    }
  } else {
    console.error(`FAIL: unknown argument "${argv[i]}"`);
    process.exit(1);
  }
}

/* -- Mode ------------------------------------------------------------------
 *
 * Resolved against `root`, never against this file's own location: the self-test
 * points the gate at temp-tree copies with --root, and a probe relative to the
 * script would report the framework's own mode for every one of them -- so every
 * instance-mode assertion would silently exercise template mode and prove nothing.
 */
const TEMPLATE_MARKER = '.sekai-template';
const templateMode = existsSync(join(root, TEMPLATE_MARKER));
const mode = templateMode ? 'template' : 'instance';

/**
 * [vars] keys that stay fatal in instance mode. ALLOWED_ORIGIN is the workers' CORS
 * boundary: a committed one is a security boundary decided in a framework-owned file
 * and shipped to whoever clones next, which is harm beyond the person editing.
 * Everything else in [vars] is a tuning constant or place-derived copy, and belongs
 * to the instance under ADR 010.
 */
const IDENTITY_VARS = new Set(['ALLOWED_ORIGIN']);

/** Exit 1 in every mode. */
const failures = [];
/** Exit 1 in template mode, exit 0 with an annotation in instance mode. */
const warnings = [];

/**
 * The cost sentence every instance-mode warning carries. A warning that names a
 * divergence without naming what it will cost is one an adopter has no way to price.
 */
const DIVERGENCE_COST =
  'a merge conflict on this file at the next /sekai-upgrade, where the framework value ' +
  'arrives beside yours';

/**
 * Record a defect whose only cost lands on the person who made the edit: fatal where
 * the framework owns the tree, a warning where the adopter does.
 *
 * `instanceTail` is appended in instance mode only. A framework maintainer reading a
 * template-mode failure is not upgrading anything, so the diagnostic they see is the
 * one this gate has always printed; the adopter is the one who needs the price.
 */
const owned = (file, message, instanceTail = '') => {
  if (templateMode) failures.push(message);
  else warnings.push({ file, message: message + instanceTail });
};

/** The instance-mode tail every warning carries: what keeping this divergence costs. */
const costTail = (extra = '') => `\n      cost: ${DIVERGENCE_COST}.${extra}`;

const workersDir = join(root, 'workers');

if (!existsSync(workersDir)) {
  console.log('OK: worker config gate -- no workers/ tree in this checkout.');
  process.exit(0);
}

const workerDirs = readdirSync(workersDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

let checked = 0;
const checkedWorkers = [];

for (const dir of workerDirs) {
  const rel = `workers/${dir}/${TEMPLATE_BASENAME}`;
  const abs = join(workersDir, dir, TEMPLATE_BASENAME);
  if (!existsSync(abs)) continue;

  const expected = EXPECTED[dir];
  if (!expected) {
    failures.push(
      `${rel}: no expectation registered for worker "${dir}". Add its shipped [vars] ` +
        'constants to EXPECTED in scripts/ci/check-worker-config.mjs; a worker that is ' +
        'not registered is a worker nothing is checking.',
    );
    continue;
  }

  let config;
  try {
    config = parseWranglerToml(readFileSync(abs, 'utf8'));
  } catch (err) {
    failures.push(`${rel}: ${err.message}`);
    continue;
  }

  const report = (key, found, want) =>
    failures.push(
      `${rel}: ${key}\n` +
        `      found:    ${JSON.stringify(found)}\n` +
        `      expected: ${JSON.stringify(want)} (the framework placeholder/constant)`,
    );

  const overrides = WORKER_VAR_OVERRIDES[dir] ?? {};

  /**
   * The same comparison `report` makes, for a value the instance owns. In template
   * mode it fails with exactly the text `report` would have printed; in instance mode
   * it warns and adds the cost, plus -- when the framework registered an override for
   * that key -- the place.config.ts key that records the same value without ever
   * conflicting.
   */
  const ownedReport = (label, varName, found, want) => {
    const configKey = overrides[varName]?.configKey;
    owned(
      rel,
      `${rel}: ${label}\n` +
        `      found:    ${JSON.stringify(found)}\n` +
        `      expected: ${JSON.stringify(want)} (the framework placeholder/constant)`,
      costTail(
        configKey
          ? `\n      no-conflict alternative: set \`workers.${configKey}\` in place.config.ts; ` +
              'it is instance-owned, survives every upgrade, and reaches the same deployed ' +
              'value (docs/runbook/DEPLOY.md).'
          : '',
      ),
    );
  };

  if (!('name' in config.top)) {
    failures.push(`${rel}: no top-level "name" key. The template must ship one, as the placeholder.`);
  } else if (config.top.name !== PLACEHOLDER) {
    report('name', config.top.name, PLACEHOLDER);
  }

  const vars = config.tables.vars ?? {};
  for (const [key, want] of Object.entries(expected.vars)) {
    if (!(key in vars)) {
      const missing =
        `${rel}: [vars] has no "${key}" key; the generator overrides it and needs it present.`;
      if (IDENTITY_VARS.has(key)) failures.push(missing);
      else {
        owned(
          rel,
          missing,
          `\n      the framework ships it as ${JSON.stringify(want)}; with the key gone the ` +
            'generator writes no value and the deployed worker falls back to its compiled-in ' +
            `default.${costTail()}`,
        );
      }
    } else if (vars[key] !== want) {
      if (IDENTITY_VARS.has(key)) report(`[vars] ${key}`, vars[key], want);
      else ownedReport(`[vars] ${key}`, key, vars[key], want);
    }
  }
  for (const key of Object.keys(vars)) {
    if (!(key in expected.vars)) {
      owned(
        rel,
        `${rel}: [vars] carries an unregistered key "${key}" = ${JSON.stringify(vars[key])}. ` +
          'Register its framework constant in scripts/ci/check-worker-config.mjs, or remove it.',
        `\n      the framework ships no such key, so there is no constant to compare it ` +
          `against; keeping it is your call.${costTail()}`,
      );
    }
  }

  // An override is a promise that setting `workers.<key>` changes a real deploy var.
  // If the template drops the var, that promise breaks only for the instance that set
  // the key, at generation time, long after the change that broke it -- and there it
  // is a warning, not a stop. This is where it is caught while it is still cheap.
  for (const [key, spec] of Object.entries(overrides)) {
    if (!(key in vars)) {
      owned(
        rel,
        `${rel}: scripts/deploy/wrangler-config.mjs registers \`workers.${spec.configKey}\` as an ` +
          `override for [vars] ${key}, but the template carries no such key. Restore it, or drop ` +
          'the registration.',
        `\n      \`npm run worker-config\` names the key and generates without it, so ` +
          `\`workers.${spec.configKey}\` in place.config.ts now does nothing.${costTail()}`,
      );
    }
  }

  const ai = config.tables.ai;
  if (expected.aiBinding) {
    if (!ai || ai.binding !== expected.aiBinding) {
      owned(
        rel,
        `${rel}: [ai] binding\n` +
          `      found:    ${JSON.stringify(ai?.binding)}\n` +
          `      expected: ${JSON.stringify(expected.aiBinding)} (the framework placeholder/constant)`,
        '\n      the worker calls env.AI.run through this binding, so a renamed or missing ' +
          `one fails at request time -- in this instance's deployment.${costTail()}`,
      );
    }
  } else if (ai) {
    owned(
      rel,
      `${rel}: carries an unregistered [ai] binding.`,
      costTail(),
    );
  }

  const databases = config.arrays.d1_databases ?? [];
  const wantBindings = expected.d1Bindings ?? [];
  if (databases.length !== wantBindings.length) {
    failures.push(
      `${rel}: ships ${databases.length} [[d1_databases]] block(s), but ` +
        `${wantBindings.length} are registered (${JSON.stringify(wantBindings)}). The generator ` +
        'rewrites keys the template already has and never adds a block, so a missing one ' +
        'generates a deploy config with no database binding. Restore the block, or update ' +
        'd1Bindings in scripts/ci/check-worker-config.mjs if the worker genuinely dropped it.',
    );
  }
  databases.forEach((db, i) => {
    const wantBinding = wantBindings[i];
    if (wantBinding !== undefined) {
      if (!('binding' in db)) {
        failures.push(`${rel}: [[d1_databases]][${i}] has no "binding" key; the worker code resolves the database through it.`);
      } else if (db.binding !== wantBinding) {
        report(`[[d1_databases]][${i}] binding`, db.binding, wantBinding);
      }
    }
    for (const key of ['database_name', 'database_id']) {
      if (!(key in db)) {
        failures.push(`${rel}: [[d1_databases]][${i}] has no "${key}" key; the generator overrides it and needs it present.`);
      } else if (db[key] !== PLACEHOLDER) {
        report(`[[d1_databases]][${i}] ${key}`, db[key], PLACEHOLDER);
      }
    }
  });

  checked += 1;
  checkedWorkers.push(dir);
}

/* -- The runbook's documented defaults --------------------------------------
 *
 * EXPECTED above pins what the template ships. docs/runbook/DEPLOY.md is where an
 * operator reads those same values, and nothing but this check connects the two: a
 * retuned constant leaves a table stating the old number, which ships to every adopter
 * on the next tag merge and reads exactly like a correct one.
 *
 * Each worker's table is anchored by an `<!-- worker-vars: <name> -->` comment, so the
 * association is declared rather than inferred from heading order, and deleting the
 * anchor fails instead of silently exempting the table. A row whose Source cell reads
 * "template (`X`)" is a claim about a shipped constant; every other row (place-derived,
 * secret, binding) is outside this contract. The two sets must match exactly in both
 * directions: a documented value that has drifted, and a shipped default the runbook
 * never mentions, are the same defect seen from either end.
 *
 * A shipped constant an instance may retune carries a second clause,
 * "template (`X`), override `workers.<key>`", and that clause is checked against
 * WORKER_VAR_OVERRIDES the same way in both directions. The runbook is where an
 * operator is told to measure a value; a table that states the default without stating
 * where the answer goes sends them back to editing a framework-owned file, which is the
 * state this override path was added to end.
 *
 * What this cannot cover: the measured scores in the "Tuning the relevance floor"
 * section (0.435, 0.484, 0.512, 0.595). Those are experimental results produced by
 * running an embedding model over the demo corpus, not values any source in this
 * repository carries, so no guard can derive them. They carry the date they were
 * measured and the procedure that reproduces them, which is what a reader needs in
 * order to distrust them once the corpus has moved.
 */
const RUNBOOK_REL = 'docs/runbook/DEPLOY.md';

/**
 * A Source cell claiming a shipped constant, optionally naming the place.config.ts
 * key that overrides it: "template (`0.46`), override `workers.chatRelevanceFloor`".
 * A cell in any other shape is a row about something else and is not checked here.
 */
const SOURCE_RE = /^template \(`([^`]*)`\)(?:, override `workers\.([A-Za-z0-9_]+)`)?$/;

/**
 * A runbook that has drifted from the shipped constants. Fatal in template mode: the
 * framework is what ships this table to every adopter, so it may not ship a wrong
 * number. In instance mode both the runbook and the template are the adopter's own
 * files, and disagreeing with the framework there costs them an upgrade conflict and
 * nobody else anything.
 */
const runbookOwned = (message) => owned(RUNBOOK_REL, message, costTail());

const runbookAbs = join(root, RUNBOOK_REL);
const runbookPresent = existsSync(runbookAbs);

if (runbookPresent) {
  const lines = readFileSync(runbookAbs, 'utf8').split('\n');
  const documented = new Map();

  for (let i = 0; i < lines.length; i++) {
    const anchor = lines[i].match(/^<!--\s*worker-vars:\s*([a-z0-9-]+)\s*-->\s*$/);
    if (!anchor) continue;
    const worker = anchor[1];

    if (documented.has(worker)) {
      runbookOwned(`${RUNBOOK_REL}: two "worker-vars: ${worker}" anchors; one table per worker.`);
      continue;
    }

    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j += 1;
    const rows = [];
    while (j < lines.length && lines[j].startsWith('|')) {
      rows.push(lines[j]);
      j += 1;
    }
    if (rows.length === 0) {
      runbookOwned(
        `${RUNBOOK_REL}: the "worker-vars: ${worker}" anchor is followed by no table. ` +
          'The anchor marks the table that documents that worker\'s shipped constants.',
      );
      continue;
    }

    const defaults = new Map();
    for (const row of rows) {
      const cells = row.split('|').slice(1, -1).map((cell) => cell.trim());
      const name = cells[0]?.match(/^`([A-Za-z0-9_]+)`$/);
      const source = cells[2]?.match(SOURCE_RE);
      if (name && source) defaults.set(name[1], { value: source[1], overrideKey: source[2] });
    }
    documented.set(worker, defaults);
  }

  for (const [worker, defaults] of documented) {
    const expected = EXPECTED[worker];
    if (!expected) {
      runbookOwned(
        `${RUNBOOK_REL}: documents a worker "${worker}" that has no expectation registered ` +
          'in scripts/ci/check-worker-config.mjs.',
      );
      continue;
    }
    const overridable = WORKER_VAR_OVERRIDES[worker] ?? {};
    for (const [key, { value, overrideKey }] of defaults) {
      if (!(key in expected.vars)) {
        runbookOwned(
          `${RUNBOOK_REL}: documents ${worker} [vars] ${key} as a shipped default, but the ` +
            'template carries no such key.',
        );
      } else if (expected.vars[key] === '') {
        runbookOwned(
          `${RUNBOOK_REL}: documents ${worker} [vars] ${key} as "template (\`${value}\`)", but ` +
            'the template ships it empty; it is generated per place, not a framework default.',
        );
      } else if (expected.vars[key] !== value) {
        runbookOwned(
          `${RUNBOOK_REL}: ${worker} [vars] ${key}\n` +
            `      documented: ${JSON.stringify(value)}\n` +
            `      shipped:    ${JSON.stringify(expected.vars[key])} (workers/${worker}/${TEMPLATE_BASENAME})`,
        );
      }

      const wantKey = overridable[key]?.configKey;
      if (wantKey !== overrideKey) {
        runbookOwned(
          `${RUNBOOK_REL}: ${worker} [vars] ${key} Source cell\n` +
            `      documents override: ${overrideKey ? `\`workers.${overrideKey}\`` : 'none'}\n` +
            `      registered:         ${wantKey ? `\`workers.${wantKey}\`` : 'none'} ` +
            '(WORKER_VAR_OVERRIDES in scripts/deploy/wrangler-config.mjs)\n' +
            '      The Source cell is where an operator reads whether a value can be retuned ' +
            'and where the answer goes.',
        );
      }
    }
    for (const [key, value] of Object.entries(expected.vars)) {
      if (value !== '' && !defaults.has(key)) {
        runbookOwned(
          `${RUNBOOK_REL}: the ${worker} table documents no default for [vars] ${key} ` +
            `(the template ships ${JSON.stringify(value)}). An operator tuning it has nowhere ` +
            'to read what it started as.',
        );
      }
    }
  }

  for (const worker of checkedWorkers) {
    if (!documented.has(worker)) {
      runbookOwned(
        `${RUNBOOK_REL}: no "<!-- worker-vars: ${worker} -->" anchor. Every worker with a ` +
          'committed template documents its shipped constants there, and the anchor is what ' +
          'ties the table to this gate.',
      );
    }
  }
}

/* -- Derived artifacts that must never be tracked ---------------------------
 *
 * Each is written into workers/ by a script, gitignored, and skipped BY NAME in both
 * machine gates. That skip is what makes a committed one dangerous: the gates would
 * walk straight past it. `what` is what a reader needs in order to understand why the
 * file is forbidden rather than merely untidy.
 */
const DERIVED_ARTIFACTS = [
  {
    basename: GENERATED_BASENAME,
    what: 'a generated worker config',
    identity: 'deployment identity (this instance\'s origin, worker name, and database ids)',
  },
  {
    basename: 'vectors.json',
    what: 'a generated corpus embedding index',
    identity: 'place identity (every article title, url, and body chunk it embeds)',
  },
];

for (const artifact of DERIVED_ARTIFACTS) {
  const tracked = spawnSync(
    'git',
    ['-C', root, 'ls-files', `*/${artifact.basename}`, artifact.basename],
    { encoding: 'utf8' },
  );
  if (tracked.status !== 0) continue;
  for (const path of tracked.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
    failures.push(
      `${path}: ${artifact.what} is tracked by git. It is derived, gitignored, and ` +
        `skipped by both machine gates by name -- committing one puts ${artifact.identity} ` +
        `in the repository. Run \`git rm --cached ${path}\`.`,
    );
  }
}

if (failures.length) {
  const runbookFailures = failures.filter((f) => f.startsWith(`${RUNBOOK_REL}:`));
  console.error(`FAIL: the committed worker contract does not hold (${mode} mode):`);
  for (const f of failures) console.error(`  ${f}`);
  if (runbookFailures.length < failures.length) {
    console.error('');
    console.error('  A committed wrangler.toml is a template, never a deploy config. Real names,');
    console.error(`  ids, and origins belong in the generated ${GENERATED_BASENAME} that`);
    console.error('  `npm run worker-config` writes from place.config.ts (docs/runbook/DEPLOY.md).');
  }
  if (runbookFailures.length) {
    console.error('');
    console.error(`  ${RUNBOOK_REL} is where an operator reads a shipped default before tuning`);
    console.error('  it. Changing a template constant means changing that table in the same pass,');
    console.error('  or the number every adopter reads is the one it used to be.');
  }
  process.exit(1);
}

/* -- Instance-mode warnings -------------------------------------------------
 *
 * Two audiences, one list. The human block is what a local `npm run
 * worker-config:check` prints, where GitHub's annotation syntax is noise. The
 * annotation is what makes the divergence visible on the run and in the pull request
 * instead of only in a log; GitHub sets GITHUB_ACTIONS on every runner, and it is the
 * only place the syntax means anything.
 *
 * A workflow command must be one line, so newlines are percent-encoded per GitHub's
 * escaping rules; the annotation body renders with them restored.
 */
const encodeAnnotation = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

if (warnings.length) {
  console.log(
    `WARN: ${warnings.length} divergence(s) from the framework's committed worker contract. ` +
      'This build is not failing on them: they are yours to keep (ADR 010).',
  );
  for (const { message } of warnings) console.log(`  ${message}`);
  if (process.env.GITHUB_ACTIONS) {
    for (const { file, message } of warnings) {
      console.log(`::warning file=${file}::${encodeAnnotation(message)}`);
    }
  }
}

const runbookNote = runbookPresent
  ? `every shipped default matches the one ${RUNBOOK_REL} documents.`
  : `${RUNBOOK_REL} is absent from this root, so no documented default was checked.`;

console.log(
  warnings.length
    ? `OK: worker config gate passed (${mode} mode) -- ${checked} committed ${TEMPLATE_BASENAME} ` +
        'file(s) carry no deployment identity and no derived worker artifact is tracked. ' +
        `${warnings.length} divergence(s) from the framework contract are reported above, and ` +
        'are this instance\'s to keep.'
    : `OK: worker config gate passed (${mode} mode) -- ${checked} committed ${TEMPLATE_BASENAME} file(s) carry ` +
        'framework placeholders only, no derived worker artifact is tracked, and ' +
        runbookNote,
);
