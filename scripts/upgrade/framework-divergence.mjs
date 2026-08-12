#!/usr/bin/env node
//
// framework-divergence.mjs -- enumerate the framework-owned files this instance has
// diverged on, and print the incoming framework value beside the instance's, BEFORE
// the merge (ADR 010 (e), SPEC "Risk controls" 4).
//
//   node scripts/upgrade/framework-divergence.mjs report --target <tag> [--repo <dir>]
//   node scripts/upgrade/framework-divergence.mjs roots [--repo <dir>]
//
// Why this exists: framework-owned states where a file comes from and that every
// release replaces it wholesale. It is not a permission boundary -- an instance may
// edit any file in its own repository, and what that costs is a conflict at the next
// upgrade. ADR 010 (e) requires the framework to say so twice: once continuously, as
// the `::warning` scripts/ci/check-worker-config.mjs emits in an adopter's CI, and
// once here, at the moment the cost is actually paid, with both values in front of
// the person deciding. Neither message alone is enough.
//
// This runs BEFORE the merge, so the list comes from the merge base rather than from
// `--diff-filter=U` afterwards. Those two sets are not the same one read at different
// times: the conflict list holds only what git could not resolve on its own, so an
// edit git merged silently -- yours kept because the framework did not touch that
// file, or two changes in different hunks of one file -- never appears in it at all.
// Reading the divergence from the merge base is what makes those visible, and it is
// available before anything in the tree has moved.
//
// It WRITES NOTHING: no state file, no staged path, no resolution. Auto-resolving in
// either direction is the defect ADR 010 (f) removed from docs/runbook/UPGRADE.md,
// and a helper that took a side would put it back. The report names the decision and
// the two commands that carry it out; the person upgrading makes it.
//
// Exit codes: 0 = a report was produced, which includes "nothing diverged" and "these
// histories have no merge base"; 1 = the report could not be produced; 2 = usage.
//
// `scripts/upgrade/check-upgrade-state.sh` is the regression gate (cases 15a-15f).

import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The framework-owned trees, as AGENTS.md iron rule 3 and docs/runbook/UPGRADE.md
 * state them. This literal is the machine source for both: `roots` prints it, and
 * `check-upgrade-state.sh` derives the runbook's list from it rather than trusting
 * the prose, so a root added here without a document update fails CI.
 */
export const FRAMEWORK_OWNED_ROOTS = ['src', 'scripts', 'workers', '.agents/skills'];

/** Diff lines shown per path before the report points at the full command. */
const MAX_DIFF_LINES = 30;

const PREFIX = 'framework-divergence';

const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

class DivergenceError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function git(repo, args, { allowFailure = false, raw = false } = {}) {
  try {
    const out = execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return raw ? out : out.trim();
  } catch (err) {
    if (allowFailure) return null;
    const detail = (err.stderr ?? '').toString().trim() || err.message;
    throw new DivergenceError(`git ${args.join(' ')} failed: ${detail}`, EXIT_FAILURE);
  }
}

/**
 * Records from a NUL-separated (`-z`) git listing. Line-based output is not a path:
 * `core.quotePath` defaults to true, so a name carrying a byte above 0x7f comes back
 * C-quoted, and the quoted literal is neither a pathspec git accepts nor a path this
 * report could read a blob at. Same reason maintainer-docs-state.mjs reads `-z`.
 */
function gitRecords(repo, args) {
  const out = git(repo, args, { raw: true });
  if (!out) return [];
  return out.split('\0').filter((record) => record !== '');
}

/** The object id of `<rev>:<path>`, or null when that revision has no such path. */
function blobId(repo, rev, path) {
  return git(repo, ['rev-parse', '--quiet', '--verify', `${rev}:${path}`], { allowFailure: true });
}

/** The bytes at `<rev>:<path>`, or null when the read fails. */
function blobText(repo, rev, path) {
  return git(repo, ['show', `${rev}:${path}`], { allowFailure: true, raw: true });
}

/* -- TOML key view --------------------------------------------------------- */

const TOML_HEADER_RE = /^\s*(\[\[?)([A-Za-z0-9_.-]+)(\]\]?)\s*$/;
const TOML_ASSIGN_RE = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*)$/;

/**
 * Strip an unquoted trailing comment from a raw TOML value, leaving the value text
 * exactly as written. A `#` inside a quoted string is part of the value, so the scan
 * is quote-aware rather than a `split('#')`.
 */
function stripTrailingComment(raw) {
  let quote = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#') {
      return raw.slice(0, i).trim();
    }
  }
  return raw.trim();
}

/**
 * Every assignment in a TOML text, as a Map from a human label to the value text as
 * written: `key`, `[table] key`, or `[[array]][i] key`. The label carries the table
 * scoping, which is what makes the report name the key an operator recognizes -- a
 * bare `RELEVANCE_FLOOR` would not say it lives in `[vars]`.
 *
 * Throws on a line it cannot read, and `report` then falls back to the diff view. A
 * silent partial parse would print a key-level report missing exactly the divergence
 * the reader is looking for.
 *
 * This is a reader, not a second copy of the deploy-time config contract: it holds no
 * expected values and no override registry (ADR 010 (c) -- the classification lives in
 * WORKER_VAR_OVERRIDES and is not duplicated). It cannot import
 * scripts/deploy/wrangler-config.mjs, because every upgrade helper runs as a lone file
 * extracted from a release tag into the git directory. Case 15e holds the two readers
 * to the same key view over every committed worker template.
 */
export function tomlEntries(text) {
  const entries = new Map();
  let table = '';
  let isArray = false;
  let index = 0;
  const counts = new Map();
  text.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;
    const header = TOML_HEADER_RE.exec(line);
    if (header) {
      const [, open, name, close] = header;
      if (open.length !== close.length) throw new Error(`line ${i + 1}: malformed table header`);
      table = name;
      isArray = open === '[[';
      index = isArray ? (counts.get(name) ?? -1) + 1 : 0;
      if (isArray) counts.set(name, index);
      return;
    }
    const assign = TOML_ASSIGN_RE.exec(line);
    if (!assign) throw new Error(`line ${i + 1}: cannot read "${trimmed}" as a header or an assignment`);
    const [, key, rawValue] = assign;
    let label;
    if (table === '') label = key;
    else if (isArray) label = `[[${table}]][${index}] ${key}`;
    else label = `[${table}] ${key}`;
    entries.set(label, stripTrailingComment(rawValue));
  });
  return entries;
}

/**
 * The differing keys between two TOML texts, instance side first. Returns null when
 * either side is unreadable, so the caller falls back to the diff view.
 */
function tomlDifferences(instanceText, frameworkText) {
  let mine;
  let theirs;
  try {
    mine = tomlEntries(instanceText);
    theirs = tomlEntries(frameworkText);
  } catch {
    return null;
  }
  const labels = [...new Set([...mine.keys(), ...theirs.keys()])];
  const differences = [];
  for (const label of labels) {
    const yours = mine.get(label);
    const framework = theirs.get(label);
    if (yours === framework) continue;
    differences.push({
      label,
      yours: yours === undefined ? '(key absent)' : yours,
      framework: framework === undefined ? '(key absent)' : framework,
    });
  }
  return differences;
}

/* -- Rendering ------------------------------------------------------------- */

/** Is this blob binary? Read from git rather than guessed from the extension. */
function isBinary(text) {
  return text !== null && text.includes('\0');
}

/**
 * The differing region of two blobs: the hunks of `git diff`, without the file
 * headers, capped so a large file does not bury the rest of the report. `-` is the
 * instance's side and `+` is the framework's, because that is the argument order.
 */
function diffHunks(repo, path, target) {
  const raw = git(
    repo,
    ['diff', '--no-color', '--unified=2', `HEAD:${path}`, `${target}:${path}`],
    { allowFailure: true, raw: true },
  );
  if (raw === null) return ['(git could not diff the two sides of this path)'];
  // Drop only the empty element the trailing newline leaves behind, never every
  // empty line: git prints a blank context line as a bare prefix space by default,
  // but `diff.suppressBlankEmpty` -- a setting in the reader's own git config, which
  // this report has no say over -- prints it as a truly empty line. Filtering those
  // would delete blank lines out of the middle of a hunk and render text as adjacent
  // that is not adjacent in the file.
  const lines = raw.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const start = lines.findIndex((line) => line.startsWith('@@'));
  const hunks = start === -1 ? lines : lines.slice(start);
  if (hunks.length <= MAX_DIFF_LINES) return hunks;
  return [
    ...hunks.slice(0, MAX_DIFF_LINES),
    `... ${hunks.length - MAX_DIFF_LINES} more diff line(s)`,
  ];
}

/**
 * How this path will meet the merge, from the three-way inputs. Stated as what git
 * has to work with rather than as a prediction of the conflict text: git merges two
 * changed sides cleanly when their hunks do not overlap, and claiming a conflict that
 * does not happen would teach a reader to discount the whole report.
 *
 * `converged` -- the two sides are the same blob, or the path is absent from both --
 * is the first branch because it is the success state of the route the framework
 * recommends: an instance whose edit was upstreamed meets it in the very release that
 * ships the edit back. Reporting that as a place a conflict can land, with an empty
 * differing region under it, is the "claiming a conflict that does not happen" the
 * paragraph above rules out.
 */
function mergeOutlook({ frameworkChanged, atBase, atHead, atTarget, converged }) {
  let mine = 'changed here';
  if (!atBase) mine = 'added here';
  else if (!atHead) mine = 'deleted here';
  if (converged) {
    if (!atHead) {
      return `${mine}, and the framework has deleted this path too: the two sides already agree, so the merge settles this with no conflict and nothing to decide`;
    }
    return `${mine}, and the framework's incoming content is now identical to yours: the merge settles this with no conflict and nothing to decide`;
  }
  if (!frameworkChanged) {
    return `${mine}; the framework has not touched this path since the merge base, so the merge keeps your side`;
  }
  if (!atHead) return `${mine} and changed in the framework: a modify/delete conflict`;
  if (!atTarget) return `${mine} and deleted in the framework: a modify/delete conflict`;
  return `${mine} and changed in the framework: this is where a content conflict can land`;
}

/* -- Report ---------------------------------------------------------------- */

function assertInstance(repo) {
  if (existsSync(resolve(repo, '.sekai-template'))) {
    throw new DivergenceError(
      [
        'this checkout carries .sekai-template, so it is the framework itself, not an instance.',
        '  There is no adopter divergence to report here; every file is the framework\'s own.',
      ].join('\n'),
      EXIT_USAGE,
    );
  }
}

function report(repo, target) {
  assertInstance(repo);
  if (!target) {
    throw new DivergenceError('report needs --target <tag>: the release being merged', EXIT_USAGE);
  }
  const targetCommit = git(repo, ['rev-parse', '--quiet', '--verify', `${target}^{commit}`], {
    allowFailure: true,
  });
  if (!targetCommit) {
    throw new DivergenceError(
      [
        `unknown merge target: ${target} does not resolve to a commit in this repository.`,
        '  remedy: fetch the framework tags first (`git fetch framework --tags`), then name a',
        '          tag `git tag -l \'sekai-kb-v*\'` lists.',
      ].join('\n'),
      EXIT_FAILURE,
    );
  }

  const base = git(repo, ['merge-base', 'HEAD', targetCommit], { allowFailure: true });
  const roots = FRAMEWORK_OWNED_ROOTS.join(', ');
  if (!base) {
    // The first merge of an instance whose history is unrelated to the framework's.
    // There is no common ancestor, so "changed since the merge base" has no meaning
    // for any path -- and answering with every framework-owned file the instance
    // carries would be a report that is technically true of nothing and useless in
    // practice. Say what is missing instead.
    return [
      `${PREFIX}: no merge base between HEAD and ${target}: these histories are unrelated, which is`,
      `${PREFIX}: the first-merge case (docs/runbook/UPGRADE.md, "Establishing the merge base").`,
      `${PREFIX}: divergence is measured against a common ancestor, so with none there is nothing to`,
      `${PREFIX}: measure: no claim is made about ${roots}.`,
      `${PREFIX}: this merge creates the base, and every upgrade after it gets the full report.`,
    ];
  }

  const records = gitRecords(repo, [
    'diff', '--name-status', '--no-renames', '-z', base, 'HEAD', '--', ...FRAMEWORK_OWNED_ROOTS,
  ]);
  const paths = [];
  for (let i = 0; i + 1 < records.length; i += 2) paths.push(records[i + 1]);
  paths.sort();

  const shortBase = git(repo, ['rev-parse', '--short', base]);
  if (paths.length === 0) {
    return [
      `${PREFIX}: no framework-owned file in this instance differs from the merge base with ${target}.`,
      `${PREFIX}: merge base ${shortBase}; roots checked: ${roots}.`,
      `${PREFIX}: nothing to decide before the merge.`,
    ];
  }

  const lines = [
    `${PREFIX}: ${paths.length} framework-owned path(s) in this instance differ from the merge base with ${target}.`,
    `${PREFIX}: merge base ${shortBase}; roots checked: ${roots}.`,
    `${PREFIX}: framework-owned means the framework ships these files and every release replaces`,
    `${PREFIX}: them wholesale. It does not mean you may not edit them -- an edit costs the review`,
    `${PREFIX}: below on every release until the two sides agree again (ADR 010).`,
    '',
  ];

  for (const path of paths) {
    const headBlob = blobId(repo, 'HEAD', path);
    const baseBlob = blobId(repo, base, path);
    const targetBlob = blobId(repo, targetCommit, path);
    const frameworkChanged = targetBlob !== baseBlob;
    const atHead = headBlob !== null;
    const atTarget = targetBlob !== null;
    // Same object id on both sides, or absent from both. The path diverged from the
    // merge base -- that is how it got into this list -- but it does not diverge from
    // the release being merged, so there is no value pair to print and no decision
    // under it.
    const converged = headBlob === targetBlob;
    lines.push(`  ${path}`);
    lines.push(`      ${mergeOutlook({ frameworkChanged, atBase: baseBlob !== null, atHead, atTarget, converged })}`);

    if (converged) {
      // No differing region exists, so no "differing region" header goes over it.
    } else if (!atHead) {
      lines.push(`      yours:     (deleted in this instance)`);
      lines.push(`      framework: ${target}:${path}`);
    } else if (!atTarget) {
      lines.push(`      yours:     HEAD:${path}`);
      lines.push(`      framework: (no file at this path in ${target})`);
    } else {
      const instanceText = blobText(repo, 'HEAD', path);
      const frameworkText = blobText(repo, targetCommit, path);
      if (isBinary(instanceText) || isBinary(frameworkText)) {
        lines.push('      both sides are binary; compare them with the command below');
      } else {
        const differences = path.endsWith('.toml')
          ? tomlDifferences(instanceText, frameworkText)
          : null;
        if (differences && differences.length > 0) {
          // A key view rather than two files: for a wrangler.toml the answer an
          // operator needs is which key moved and to what, not 30 unchanged lines
          // around it.
          for (const { label, yours, framework } of differences) {
            lines.push(`      ${label}`);
            lines.push(`        yours:     ${yours}`);
            lines.push(`        framework: ${framework}`);
          }
        } else {
          lines.push('      differing region (- yours, + the framework\'s incoming):');
          for (const hunk of diffHunks(repo, path, target)) lines.push(`      ${hunk}`);
        }
      }
    }
    lines.push('');
  }

  lines.push(
    `${PREFIX}: nothing above is resolved for you. Read the target's CHANGELOG entry for why the`,
    `${PREFIX}: framework's side changed, then decide per file. Full text of any path:`,
    `${PREFIX}:     git diff HEAD:<path> ${target}:<path>`,
    `${PREFIX}: after the merge, a path that really conflicted is settled with one of:`,
    `${PREFIX}:     git checkout --theirs -- <path> && git add <path>   # take the framework's`,
    `${PREFIX}:     git checkout --ours   -- <path> && git add <path>   # keep yours, knowingly`,
    `${PREFIX}: keeping yours is supported; upstreaming the change to sekai-kb is what makes the`,
    `${PREFIX}: file stop conflicting on every release.`,
  );
  return lines;
}

/* -- CLI ------------------------------------------------------------------- */

// Options are declared PER COMMAND, and this table is the single source both the
// parser and `check-upgrade-state.sh` read: the harness derives the accepted set from
// this literal and asserts the upgrade documents pass only options it really contains,
// so a renamed flag fails CI rather than leaving a runbook that exits 2 at runtime.
const COMMAND_OPTIONS = {
  report: { '--repo': 'repo', '--target': 'target' },
  roots: { '--repo': 'repo' },
};

const USAGE = 'usage: framework-divergence.mjs report --target <tag> [--repo <dir>]\n'
  + '       framework-divergence.mjs roots [--repo <dir>]\n'
  + '  report runs BEFORE the merge and writes nothing: it names the framework-owned\n'
  + '  paths this instance changed since its merge base with <tag>, with the incoming\n'
  + '  framework value beside yours.';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const accepted = COMMAND_OPTIONS[command];
  if (!accepted) return { command, options: null };
  const options = { repo: process.cwd(), target: null };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = rest[i + 1];
    const key = accepted[flag];
    if (!key) {
      const known = Object.values(COMMAND_OPTIONS).some((table) => flag in table);
      throw new DivergenceError(
        known
          ? `${flag} is not an option of \`${command}\`.\n`
            + `  run \`${command}\` with the options its usage line lists.`
          : `unknown argument: ${flag}`,
        EXIT_USAGE,
      );
    }
    if (value === undefined) throw new DivergenceError(`${flag} needs a value`, EXIT_USAGE);
    options[key] = value;
    i += 1;
  }
  return { command, options };
}

function main(argv) {
  const { command, options } = parseArgs(argv);
  if (options === null) throw new DivergenceError(USAGE, EXIT_USAGE);
  const repoRoot = git(options.repo, ['rev-parse', '--show-toplevel']);

  if (command === 'roots') {
    for (const root of FRAMEWORK_OWNED_ROOTS) process.stdout.write(`${root}\n`);
    return;
  }

  if (command === 'report') {
    for (const line of report(repoRoot, options.target)) process.stdout.write(`${line}\n`);
    return;
  }

  throw new DivergenceError(USAGE, EXIT_USAGE);
}

// Run only when executed directly. `realpathSync` is load-bearing, exactly as in the
// sibling helpers: `import.meta.url` is the resolved real path while `process.argv[1]`
// keeps the symlinks it was invoked through (a temp directory under `/var` on macOS is
// really `/private/var`), and comparing the two unresolved makes this file a silent
// no-op when it is run from the copy the upgrade extracts out of a release tag --
// which is the documented way to run it.
const entryPoint = (() => {
  if (!process.argv[1]) return null;
  try {
    return pathToFileURL(realpathSync(resolve(process.argv[1]))).href;
  } catch {
    return null;
  }
})();
const invokedDirectly = entryPoint !== null && import.meta.url === entryPoint;
if (invokedDirectly) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    if (err instanceof DivergenceError) {
      process.stderr.write(`${PREFIX}: ${err.message}\n`);
      process.exit(err.code);
    }
    throw err;
  }
}
