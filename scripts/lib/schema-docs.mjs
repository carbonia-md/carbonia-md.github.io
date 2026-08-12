// schema-docs.mjs -- the engine behind every manifest schema documentation gate.
//
// A `knowledge/` manifest's schema is implemented in exactly one reader under
// `src/lib/`, and several documents restate that schema in prose: the maintainer
// SPEC, the manifest's own body (which is what an adopter reads before editing the
// file), and the adopter runbook. Prose that drifts from the reader is worse than
// absent prose, because it gets believed rather than looked up -- and this repository
// is a template, so a wrong field list propagates to every adopter on the next tag
// merge (`.agent-toolkit/rules/guard-or-explain-prose-drift.md`).
//
// A gate built on this engine DERIVES its values from the reader's own exported
// consts -- a field list from an array, a bound from a number -- and asserts that every
// registered statement carries exactly the value of the group it describes. Adding,
// removing, or renaming a field in the reader therefore changes what the gate demands,
// with no second edit in the gate: a registry holds anchors (prose), never field names
// or numbers.
//
// A registered statement is usually prose, but it need not be: a bound that a SECOND
// IMPLEMENTATION restates in its own source drifts the same way documentation does, so
// that source is registered as one more statement and the two cannot disagree silently.
//
// Failure modes, all exit 1:
//   - a registered statement enumerates a field set that is not its group's set;
//   - a registered anchor is NOT FOUND (someone reworded, moved, or deleted the
//     statement). This is a FAILURE, never a silent pass: an unfindable statement is
//     exactly how a stale one hides. Re-point the registry entry in the same commit
//     that rewords the statement;
//   - a registered statement carries a value that is not its group's value;
//   - a reader no longer exports one of its consts, or can no longer be parsed, which
//     would otherwise silently weaken the whole gate.
//
// Registry scopes, matching scripts/ci/check-scan-root-docs.mjs:
//   - `framework` -- framework-owned file, present in every checkout. A missing file
//     or anchor fails in both modes.
//   - `instance`  -- a file the adopter owns or that adoption removes (the maintainer
//     docs are stripped at adoption, ADR 008; a demo manifest is content the init
//     wizard deletes and the adopter rewrites). Required in TEMPLATE mode, where this
//     repository authors the text. In an adopted instance an absent file or a
//     reworded anchor is reported as skipped, because the adopter owns that prose --
//     but a statement that IS found must still match the reader.
//
// This file lives under scripts/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A fields group's reader declaration, one exported const array literal:
 *   export const RECORDING_REQUIRED_FIELDS = ['title', 'location', ...] as const;
 */
function deriveFields(source, name) {
  const match = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(source);
  if (!match) return null;
  const fields = match[1]
    .split(',')
    .map((token) => token.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  return fields.length > 0 ? fields : null;
}

/**
 * A captured enumeration may wrap across lines and carry markdown backticks and an
 * "and"/"or" conjunction before the last item. Strip all of that, then split on commas.
 */
function parseFields(span) {
  return span
    .split('\n')
    .join(' ')
    .split(',')
    .map((token) => token.trim().replace(/^(?:and|or)\s+/i, ''))
    .map((token) => token.replace(/[`'"]/g, '').trim())
    .filter(Boolean);
}

/**
 * A numeric group's reader declaration:
 *   export const CONTEXT_HINT_MAX_CHARS = 200;
 */
function deriveNumber(source, name) {
  const match = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*(\\d+)`).exec(source);
  return match ? [match[1]] : null;
}

/**
 * A captured numeric statement carries prose and markdown around one integer -- "at
 * most `200` characters", or a `const MAX_HINT_CHARS = 200;` line in another
 * implementation. Every digit run in the span is returned, so an anchor that captured
 * two numbers fails loudly instead of silently checking the wrong one.
 */
function parseNumbers(span) {
  return span.match(/\d+/g) ?? [];
}

/**
 * A group is one of two kinds, and the kind decides how the reader's value is derived
 * and how a registered statement is parsed back before the two are compared:
 *
 *   - `fields` (the default) -- a list of field names, from an exported array literal.
 *   - `number` -- one bound, from an exported numeric const.
 */
const KINDS = {
  fields: { derive: deriveFields, parse: parseFields },
  number: { derive: deriveNumber, parse: parseNumbers },
};

const asSet = (fields) => [...new Set(fields)].sort().join(', ');
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/**
 * Runs one schema documentation gate and exits the process.
 *
 * @param {object} gate
 * @param {string} gate.name     what this gate is called in its output.
 * @param {string} gate.root     repository root.
 * @param {Record<string, {reader: string, constName: string, kind?: 'fields'|'number'}>} gate.groups
 *        group label -> the reader file, the exported const to derive it from, and its
 *        kind ('fields', the default, or 'number').
 * @param {Array<{file: string, label: string, group: string, scope: 'framework'|'instance', anchor: RegExp}>} gate.registry
 *        every prose statement that restates one of those groups. Each `anchor` has
 *        exactly one capture group, capturing ONLY the enumeration.
 */
export function runSchemaDocsGate({ name, root, groups, registry }) {
  const failures = [];
  const skipped = [];
  let checked = 0;

  const readerSources = new Map();
  for (const { reader } of Object.values(groups)) {
    if (readerSources.has(reader)) continue;
    try {
      readerSources.set(reader, readFileSync(join(root, reader), 'utf8'));
    } catch (err) {
      console.error(`FAIL: ${name} cannot read ${reader}: ${err.message}`);
      process.exit(1);
    }
  }

  const expected = {};
  for (const [group, { reader, constName, kind = 'fields' }] of Object.entries(groups)) {
    if (!KINDS[kind]) {
      failures.push(
        `${reader}: group "${group}" declares the unknown kind "${kind}". ` +
          `Use one of: ${Object.keys(KINDS).join(', ')}.`,
      );
      continue;
    }
    const values = KINDS[kind].derive(readerSources.get(reader), constName);
    if (!values) {
      failures.push(
        `${reader}: no parseable \`export const ${constName}\` (${kind}) -- the gate cannot ` +
          `derive the ${group} value. Re-point the derivation in this gate.`,
      );
      continue;
    }
    expected[group] = asSet(values);
  }

  if (failures.length) {
    console.error(`FAIL: ${name} could not derive the reader's values:`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }

  const templateMode = existsSync(join(root, '.sekai-template'));

  for (const site of registry) {
    const abs = join(root, site.file);
    const required = site.scope === 'framework' || templateMode;

    if (!existsSync(abs)) {
      if (required) {
        failures.push(
          `${site.file}: registered file is missing (${site.label}). A registered schema ` +
            'statement cannot be checked, which is a failure, not a pass.',
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
          `${site.file}: anchor NOT FOUND for "${site.label}". The statement was reworded, ` +
            "moved, or deleted -- re-point this gate's registry entry in the same commit.",
        );
      } else {
        skipped.push(`${site.file} (${site.label}: adopter-reworded)`);
      }
      continue;
    }

    const found = KINDS[groups[site.group].kind ?? 'fields'].parse(match[1]);
    if (asSet(found) !== expected[site.group]) {
      failures.push(
        `${site.file}:${lineOf(text, match.index)}: ${site.label} (${site.group})\n` +
          `      found:    ${asSet(found) || '(none)'}\n` +
          `      expected: ${expected[site.group]}`,
      );
      continue;
    }

    checked += 1;
  }

  if (failures.length) {
    console.error(`FAIL: ${name} statements do not match the reader's values:`);
    for (const failure of failures) console.error(`  ${failure}`);
    console.error('');
    for (const [group, fields] of Object.entries(expected)) {
      console.error(`  ${group} (${groups[group].reader}): ${fields}`);
    }
    console.error('  Fix the statement, or re-point this gate if the statement moved.');
    process.exit(1);
  }

  const mode = templateMode ? 'template mode' : 'instance mode';
  const skips = skipped.length
    ? `; ${skipped.length} instance-owned skipped: ${skipped.join(', ')}`
    : '';
  console.log(
    `OK: ${name} passed [${mode}] -- ${checked} statements match their readers ` +
      `(${Object.entries(expected)
        .map(([group, fields]) => `${group}: ${fields}`)
        .join('; ')})${skips}`,
  );
}
