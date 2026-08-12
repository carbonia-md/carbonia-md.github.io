#!/usr/bin/env node
// check-place-config-interface.mjs -- the PlaceConfig declaration gate.
//
// `place.config.ts` carries the type declaration the framework reads, and
// `npm run init` writes that same file for every adopter. Those are two
// statements of one schema, and until this gate existed nothing compared them:
// the wizard carried its own copy of the declaration inside a template literal,
// and that copy had silently lost five keys. Two of them (`features.og`,
// `workers.og`) are PROMPTED by `scripts/init/prompt-table.mjs`, so the wizard
// wrote them into the config object under a declaration that did not declare
// them -- every place.config.ts the wizard had ever produced was a TypeScript
// excess-property error against its own interface. Nothing caught it because this
// repository runs no typechecker: `npm run build` strips types through esbuild,
// and `scripts/init/check-init.sh` verifies the initialized instance by building
// it.
//
// The copy is gone (`scripts/init/writer.mjs` now re-emits the committed
// declaration, ./scripts/init/place-config-interface.mjs), so this gate's job is
// to keep it gone and to hold the third statement of the schema -- the prompt
// table -- in agreement with it. Five checks, all derived, none restated here:
//
//   1. DECLARATION  -- `place.config.ts` carries exactly one parseable
//                      declaration. Everything below measures against it, so a
//                      file it cannot be read out of must fail rather than let
//                      the remaining checks pass on an empty vocabulary.
//   2. NO COPY      -- `scripts/init/writer.mjs` contains no declaration of its
//                      own. This is the regression itself: a second copy is
//                      byte-identical on the day it is written and drifts later,
//                      which is exactly how the five keys were lost.
//   3. AGREEMENT    -- the declaration extracted from what the wizard actually
//                      RENDERS is byte-identical to the committed one. Check 2
//                      is about the source, this one about the output: a writer
//                      that reads its input and then emits something else fails
//                      here.
//   4. PROMPTS      -- every `PROMPTS` row id in `scripts/init/prompt-table.mjs`
//                      resolves to a key path the declaration declares. This is
//                      the root cause of the `og` class: a prompt was added on
//                      one side only, and the wizard faithfully wrote an answer
//                      into a key no type knew about.
//   5. SELF-CONSISTENT -- the committed `place.config.ts`'s own config object
//                      declares no property its own declaration omits. The same
//                      assertion runs against a wizard-PRODUCED file through
//                      `--generated`, which `scripts/init/check-init.sh` calls on
//                      a real init run: that is what makes "the emitted config
//                      typechecks against the emitted interface" evidence rather
//                      than an argument.
//
// Every failure names the offending key path, prompt id, or file. Success prints
// one summary line and exits 0. Any failure exits 1.
//
// Usage: node --experimental-strip-types scripts/ci/check-place-config-interface.mjs [--root <dir>]
//        node --experimental-strip-types scripts/ci/check-place-config-interface.mjs --generated <file>
//        node --experimental-strip-types scripts/ci/check-place-config-interface.mjs --selftest
//
// The type-stripping flag is what lets checks 5 and `--generated` IMPORT a
// `.ts` config rather than re-parse an object literal by hand (the same idiom
// `npm run worker-config` uses). Stripping is not typechecking -- that is why
// the excess-property error never fired -- so the key-path comparison above is
// the check, not the import.
//
// This file lives under scripts/, which both genericity gates scan: its source is
// pure ASCII and carries no denylisted place term. The place names it plants are
// invented.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  INTERFACE_DECLARATION,
  extractInterfaceBlock,
  interfaceKeyPaths,
  objectKeyPaths,
} from '../init/place-config-interface.mjs';

const GATE = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(GATE), '../..');

const PLACE_CONFIG = 'place.config.ts';
const WIZARD = 'scripts/init/writer.mjs';
const PROMPT_TABLE = 'scripts/init/prompt-table.mjs';
const PARSER = 'scripts/init/place-config-interface.mjs';

// The files a fixture root needs for the gate to run against it: the two sources
// under comparison, the prompt table, and the parser the wizard imports.
const FIXTURE_FILES = [PLACE_CONFIG, WIZARD, PROMPT_TABLE, PARSER];

// Rendering exercises the wizard's real code path; the declaration it emits does
// not depend on the config, so the smallest valid one is enough.
const SAMPLE_CONFIG = { place: { name: 'Selftest Place' } };

/* ── checks ──────────────────────────────────────────────────────────────── */

function symmetricDifference(a, b) {
  const inA = a.filter((p) => !b.includes(p));
  const inB = b.filter((p) => !a.includes(p));
  return { inA, inB };
}

// The first line at which two blocks diverge, for the case where the key paths
// agree but the text does not (a re-indent, a reworded doc comment).
function firstDifferingLine(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) {
      return `    line ${i + 1}:\n      place.config.ts: ${JSON.stringify(la[i] ?? null)}\n      ${WIZARD}:  ${JSON.stringify(lb[i] ?? null)}`;
    }
  }
  return '    (no differing line: one block is a prefix of the other)';
}

async function checkRoot(root) {
  const failures = [];
  const configPath = join(root, PLACE_CONFIG);

  // 1. DECLARATION.
  let block;
  let declared;
  try {
    block = extractInterfaceBlock(readFileSync(configPath, 'utf8'));
    declared = interfaceKeyPaths(block);
  } catch (e) {
    failures.push(
      `FAIL: ${PLACE_CONFIG}: ${e.message}\n` +
        '  This file is where the declaration lives; every other check measures\n' +
        '  against it, so nothing below can be evaluated.',
    );
    return failures;
  }

  // 2. NO COPY.
  const wizardPath = join(root, WIZARD);
  const wizardSrc = readFileSync(wizardPath, 'utf8');
  if (wizardSrc.includes(INTERFACE_DECLARATION)) {
    failures.push(
      `FAIL: ${WIZARD} carries its own "${INTERFACE_DECLARATION}" declaration.\n` +
        `  The wizard must RE-EMIT the one in ${PLACE_CONFIG} (extractInterfaceBlock\n` +
        `  in ${PARSER}), never restate it. A second copy is identical the day it is\n` +
        '  written and drifts afterwards; that is how five keys were lost before this\n' +
        '  gate existed.',
    );
  }

  // 3. AGREEMENT.
  const { renderPlaceConfig } = await import(pathToFileURL(wizardPath).href);
  const rendered = renderPlaceConfig(SAMPLE_CONFIG, block);
  let emitted = null;
  try {
    emitted = extractInterfaceBlock(rendered);
  } catch (e) {
    failures.push(
      `FAIL: the config ${WIZARD} renders carries no usable declaration: ${e.message}\n` +
        '  An adopter would be handed a place.config.ts with no type at all.',
    );
  }
  if (emitted !== null && emitted !== block) {
    let detail;
    try {
      const { inA, inB } = symmetricDifference(declared, interfaceKeyPaths(emitted));
      const lines = [];
      if (inA.length > 0)
        lines.push(`    declared in ${PLACE_CONFIG}, absent from what the wizard emits: ${inA.join(', ')}`);
      if (inB.length > 0)
        lines.push(`    emitted by the wizard, absent from ${PLACE_CONFIG}: ${inB.join(', ')}`);
      detail = lines.length > 0 ? lines.join('\n') : firstDifferingLine(block, emitted);
    } catch (e) {
      detail = `    the emitted declaration does not parse: ${e.message}`;
    }
    failures.push(
      `FAIL: the declaration ${WIZARD} emits is not the one ${PLACE_CONFIG} carries.\n${detail}\n` +
        '  Every adopter is handed the emitted one, so a key missing there is a key\n' +
        '  their config cannot legally set, and a key only there is one the framework\n' +
        '  never reads.',
    );
  }

  // 4. PROMPTS.
  const { PROMPTS } = await import(pathToFileURL(join(root, PROMPT_TABLE)).href);
  const unresolvable = PROMPTS.map((row) => row.id).filter((id) => !declared.includes(id));
  if (unresolvable.length > 0) {
    failures.push(
      `FAIL: ${PROMPT_TABLE} prompts for ${unresolvable.length} key path(s) the\n` +
        `  declaration in ${PLACE_CONFIG} does not declare: ${unresolvable.join(', ')}\n` +
        '  The wizard writes every answer into the config object, so a prompt with no\n' +
        '  declared key emits a property its own interface rejects. Add the key to the\n' +
        '  declaration, or drop the prompt.',
    );
  }

  // 5. SELF-CONSISTENT.
  failures.push(...(await checkGenerated(configPath, PLACE_CONFIG)));

  return failures;
}

/**
 * The config object in `file` uses no key path the declaration in that same file
 * omits. Run against the committed config by check 5, and against a
 * wizard-PRODUCED config by `scripts/init/check-init.sh`.
 */
async function checkGenerated(file, label) {
  const failures = [];
  let declared;
  try {
    declared = interfaceKeyPaths(extractInterfaceBlock(readFileSync(file, 'utf8')));
  } catch (e) {
    return [`FAIL: ${label}: ${e.message}`];
  }
  let config;
  try {
    config = (await import(pathToFileURL(file).href)).default;
  } catch (e) {
    return [`FAIL: ${label} cannot be imported: ${e.message}`];
  }
  let used;
  try {
    used = objectKeyPaths(config);
  } catch (e) {
    return [`FAIL: ${label}: ${e.message}`];
  }
  const undeclared = used.filter((p) => !declared.includes(p));
  if (undeclared.length > 0) {
    failures.push(
      `FAIL: ${label} sets ${undeclared.length} property path(s) its own declaration\n` +
        `  does not declare: ${undeclared.join(', ')}\n` +
        '  A typed object literal with an undeclared property is a TypeScript\n' +
        '  excess-property error. Nothing in this repository typechecks, so this is\n' +
        '  where it is caught.',
    );
  }
  return failures;
}

/* ── self-test ───────────────────────────────────────────────────────────── */

function runGate(args) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', GATE, ...args], {
    encoding: 'utf8',
  });
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function selftestFail(message, output) {
  console.error(`FAIL: place config interface self-test -- ${message}`);
  if (output) console.error(output);
  process.exit(1);
}

function assertGatePasses(args, label) {
  const { status, output } = runGate(args);
  if (status !== 0) {
    selftestFail(`the gate fails on ${label} -- the assertions below cannot be trusted`, output);
  }
  if (!/^OK:/m.test(output)) {
    selftestFail(`the gate passed on ${label} without an OK: summary line`, output);
  }
}

function assertGateCatches(args, what, ...mustName) {
  const { status, output } = runGate(args);
  if (status === 0) {
    selftestFail(`the gate did NOT catch ${what}`, output);
  }
  if (!/^FAIL:/m.test(output)) {
    selftestFail(`the gate exited nonzero on ${what} without a FAIL: line`, output);
  }
  for (const want of mustName) {
    if (!output.includes(want)) {
      selftestFail(`the gate caught ${what} but its output never names "${want}"`, output);
    }
  }
}

/** A fixture root carrying the four files the gate reads, copied from this repo. */
function freshCopy(work, label) {
  const root = join(work, label);
  for (const rel of FIXTURE_FILES) {
    const dest = join(root, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(REPO_ROOT, rel), dest);
  }
  return root;
}

/**
 * Replace the fixture's wizard with one that emits `blockText` verbatim. This is
 * the shape of the regression the gate exists for -- a writer that stopped
 * deriving -- and it is the only way to plant classes (a) and (b) now that the
 * declaration exists once: mutating place.config.ts alone moves both sides at
 * once, which would make this suite vacuous.
 */
function plantStubWizard(root, blockText) {
  writeFileSync(join(root, 'scripts/init/selftest-block.txt'), blockText);
  writeFileSync(
    join(root, WIZARD),
    [
      "import { readFileSync } from 'node:fs';",
      'export function renderPlaceConfig() {',
      "  return readFileSync(new URL('./selftest-block.txt', import.meta.url), 'utf8');",
      '}',
      '',
    ].join('\n'),
  );
}

/** The committed declaration, for the self-test to mutate. */
function committedBlock() {
  return extractInterfaceBlock(readFileSync(join(REPO_ROOT, PLACE_CONFIG), 'utf8'));
}

function dropLine(text, line, what) {
  const lines = text.split('\n');
  const i = lines.indexOf(line);
  if (i < 0) {
    selftestFail(
      `planting [${what}] found no line ${JSON.stringify(line)} in the committed ` +
        'declaration -- the text this test plants against has moved; re-point the self-test.',
    );
  }
  lines.splice(i, 1);
  return lines.join('\n');
}

function insertAfter(text, after, line, what) {
  const lines = text.split('\n');
  const i = lines.indexOf(after);
  if (i < 0) {
    selftestFail(
      `planting [${what}] found no line ${JSON.stringify(after)} in the committed ` +
        'declaration -- the text this test plants against has moved; re-point the self-test.',
    );
  }
  lines.splice(i + 1, 0, line);
  return lines.join('\n');
}

function selftest() {
  const work = mkdtempSync(join(tmpdir(), 'place-config-interface-selftest-'));
  try {
    assertGatePasses([], 'the shipped tree');

    // (a) A key the declaration carries that the wizard's emission drops. This is
    // the defect that shipped: `features.og` was declared and prompted, and the
    // wizard's copy omitted it.
    let root = freshCopy(work, 'missing-key');
    assertGatePasses(['--root', root], 'an unmutated copy of the shipped files');
    plantStubWizard(root, dropLine(committedBlock(), '    og: boolean;', 'missing key'));
    assertGateCatches(['--root', root], 'a key the wizard stopped emitting', 'features.og');

    // (b) The mirror: a key only the wizard emits. The framework never reads it,
    // so an adopter setting it gets no behavior and no error.
    root = freshCopy(work, 'extra-key');
    assertGatePasses(['--root', root], 'an unmutated copy of the shipped files');
    plantStubWizard(
      root,
      insertAfter(committedBlock(), `${INTERFACE_DECLARATION} {`, '  plantedKey: string;', 'extra key'),
    );
    assertGateCatches(['--root', root], 'a key only the wizard emits', 'plantedKey');

    // (c) A prompt id naming a key no declaration carries -- the root cause of the
    // `og` class, where a row was added on one side only.
    root = freshCopy(work, 'unresolvable-prompt');
    assertGatePasses(['--root', root], 'an unmutated copy of the shipped files');
    writeFileSync(
      join(root, PROMPT_TABLE),
      `${readFileSync(join(root, PROMPT_TABLE), 'utf8')}\nPROMPTS.push({ id: 'features.selftestPlanted', question: 'Planted?', kind: 'boolean', default: false });\n`,
    );
    assertGateCatches(
      ['--root', root],
      'a prompt id naming an undeclared key',
      'features.selftestPlanted',
    );

    // (d) The wizard carrying a declaration of its own again. Byte-identical on
    // the day it lands and drifting afterwards, so the copy itself is the defect,
    // not the difference.
    root = freshCopy(work, 'second-copy');
    assertGatePasses(['--root', root], 'an unmutated copy of the shipped files');
    writeFileSync(
      join(root, WIZARD),
      `${readFileSync(join(root, WIZARD), 'utf8')}\nconst REGRESSED = \`\n${INTERFACE_DECLARATION} {\n  place: { name: string };\n}\n\`;\n`,
    );
    assertGateCatches(['--root', root], 'a second declaration in the wizard', WIZARD);

    // (e) A config object setting a property its own declaration omits -- the
    // generated-file defect itself, asserted through the mode check-init.sh runs
    // against a real wizard run.
    const generatedDir = join(work, 'generated');
    mkdirSync(generatedDir, { recursive: true });
    const clean = join(generatedDir, 'clean.config.ts');
    const planted = join(generatedDir, 'planted.config.ts');
    const declaration = [
      `${INTERFACE_DECLARATION} {`,
      '  place: {',
      '    name: string;',
      '  };',
      '}',
      '',
    ].join('\n');
    writeFileSync(
      clean,
      `${declaration}\nconst config: PlaceConfig = {\n  place: {\n    name: 'Selftest Place',\n  },\n};\n\nexport default config;\n`,
    );
    writeFileSync(
      planted,
      `${declaration}\nconst config: PlaceConfig = {\n  place: {\n    name: 'Selftest Place',\n    plantedKey: 'undeclared',\n  },\n};\n\nexport default config;\n`,
    );
    assertGatePasses(['--generated', clean], 'a generated config that declares every key it sets');
    assertGateCatches(
      ['--generated', planted],
      'a generated config setting an undeclared property',
      'place.plantedKey',
    );

    // (f) A place.config.ts with no declaration at all. Without this class the
    // gate could pass vacuously on an empty vocabulary: every comparison above
    // holds when there is nothing to compare.
    root = freshCopy(work, 'no-declaration');
    assertGatePasses(['--root', root], 'an unmutated copy of the shipped files');
    writeFileSync(join(root, PLACE_CONFIG), 'const config = {};\nexport default config;\n');
    assertGateCatches(['--root', root], 'a config file carrying no declaration', PLACE_CONFIG);

    console.log(
      'OK: place config interface self-test passed -- the gate catches a key the wizard ' +
        'stopped emitting, a key only the wizard emits, a prompt id naming an undeclared key, ' +
        'a second declaration re-introduced into the wizard, a generated config setting an ' +
        'undeclared property, and a config file with no declaration at all',
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/* ── main ────────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const args = { root: REPO_ROOT, generated: null, selftest: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') args.root = resolve(argv[++i] ?? '');
    else if (argv[i] === '--generated') args.generated = resolve(argv[++i] ?? '');
    else if (argv[i] === '--selftest') args.selftest = true;
    else {
      console.error(`check-place-config-interface: unknown argument "${argv[i]}"`);
      process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.selftest) {
  selftest();
} else if (args.generated !== null) {
  const failures = await checkGenerated(args.generated, args.generated);
  for (const f of failures) console.error(f);
  if (failures.length > 0) process.exit(1);
  console.log(
    `OK: ${args.generated} sets no property its own ${INTERFACE_DECLARATION} declaration omits`,
  );
} else {
  const failures = await checkRoot(args.root);
  for (const f of failures) console.error(f);
  if (failures.length > 0) process.exit(1);
  console.log(
    `OK: the ${INTERFACE_DECLARATION} declaration is stated once in ${PLACE_CONFIG}, ` +
      `re-emitted unchanged by ${WIZARD}, and declares every key ${PROMPT_TABLE} prompts for ` +
      'and every property the committed config sets',
  );
}
