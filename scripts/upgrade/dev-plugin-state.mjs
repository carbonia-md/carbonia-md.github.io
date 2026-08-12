#!/usr/bin/env node
//
// dev-plugin-state.mjs — classify and preserve an instance's dev-plugin state
// across a framework tag merge (ADR 006 addendum, SPEC §Repo topology).
//
//   node scripts/upgrade/dev-plugin-state.mjs classify [--repo <dir>]
//   node scripts/upgrade/dev-plugin-state.mjs reconcile --state <stripped|installed> [--repo <dir>]
//
// Why this exists: `.gitattributes merge=ours` protects the CONTENT of a path
// that exists on both merge sides. It does not preserve an intentionally ABSENT
// path. An instance adopted through `npm run init` has no `.agent-toolkit/` tree,
// so a framework tag that touches `.agent-toolkit/` hits git's modify/delete case
// on shared history, and adds the whole framework tree back as a theirs-only
// addition on an unrelated-history first merge. Either way the adopter silently
// reacquires framework dev-plugin state. `dev:setup` is the only opt-in.
//
// `classify` runs in preflight, BEFORE the merge, on a clean working tree. Its
// answer is passed to `reconcile`, which runs immediately AFTER the merge command
// (whether the merge stopped on conflicts or completed on its own).
//
// Exit codes: 0 = ok, 1 = reconcile failed / postcondition violated,
// 2 = usage error, 3 = inconsistent (mixed) dev-plugin state.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TREE = '.agent-toolkit';
const CONFIG = '.agent-toolkit/dev.md';
const REFERENCE = '@.agent-toolkit/dev.md';
// Agent-instruction entry points an active reference can live on. AGENTS.md is
// the instruction SSOT; CLAUDE.md is normally a one-line `@AGENTS.md` shim, but a
// pre-ADR-006 instance can still carry the reference there.
const ENTRY_FILES = ['AGENTS.md', 'CLAUDE.md'];
const SENTINEL_START = '<!-- dev-plugin:start';
const SENTINEL_END = 'dev-plugin:end -->';

const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const EXIT_MIXED = 3;

class UpgradeStateError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function git(repo, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  } catch (err) {
    if (allowFailure) return null;
    const detail = (err.stderr ?? '').toString().trim() || err.message;
    throw new UpgradeStateError(`git ${args.join(' ')} failed: ${detail}`, EXIT_FAILURE);
  }
}

function gitLines(repo, args, options) {
  const out = git(repo, args, options);
  if (!out) return [];
  return out.split('\n').filter((line) => line !== '');
}

/**
 * Distinct paths from a `git ls-files` listing. `git ls-files -u` prefixes each
 * line with `<mode> <sha> <stage>\t`, and repeats a conflicted path once per
 * stage, so counting raw lines overstates how many paths are involved.
 */
function distinctPaths(lines) {
  return [...new Set(lines.map((line) => (line.includes('\t') ? line.split('\t').pop() : line)))];
}

/**
 * Line indices carrying an ACTIVE dev-plugin reference: the reference string on a
 * line that is not inside an HTML comment. The framework's own AGENTS.md wraps its
 * dev-plugin block in `<!-- dev-plugin:start … -->` sentinels, and a commented-out
 * reference is deliberately inert — neither counts as active.
 */
function activeReferenceLines(text) {
  const lines = text.split('\n');
  const hits = [];
  let inComment = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // A line can open and close a comment; only the text outside comments counts.
    let visible = '';
    let rest = line;
    while (rest.length > 0) {
      if (inComment) {
        const close = rest.indexOf('-->');
        if (close === -1) break;
        rest = rest.slice(close + 3);
        inComment = false;
      } else {
        const open = rest.indexOf('<!--');
        if (open === -1) {
          visible += rest;
          break;
        }
        visible += rest.slice(0, open);
        rest = rest.slice(open + 4);
        inComment = true;
      }
    }
    if (visible.includes(REFERENCE)) hits.push(i);
  }
  return hits;
}

function hasActiveReference(text) {
  return activeReferenceLines(text).length > 0;
}

/**
 * Remove the dev-plugin sentinel block, then any remaining active reference line.
 * Returns null when nothing was active (no write needed).
 */
function stripActiveReference(text) {
  if (!hasActiveReference(text)) return null;
  const lines = text.split('\n');
  const kept = [];
  let inSentinel = false;
  for (const line of lines) {
    if (!inSentinel && line.includes(SENTINEL_START)) {
      inSentinel = true;
      if (line.includes(SENTINEL_END)) inSentinel = false;
      continue;
    }
    if (inSentinel) {
      if (line.includes(SENTINEL_END)) inSentinel = false;
      continue;
    }
    kept.push(line);
  }
  const withoutBlock = kept.join('\n');
  const remaining = activeReferenceLines(withoutBlock);
  const finalLines = withoutBlock
    .split('\n')
    .filter((_, index) => !remaining.includes(index));
  return `${finalLines.join('\n').replace(/\n+$/, '')}\n`;
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Working-tree dev-plugin state: `stripped`, `installed`, or a mixed-state error. */
function classify(repo) {
  const treePresent = isDirectory(join(repo, TREE));
  const configPresent = existsSync(join(repo, CONFIG));
  const referencedIn = ENTRY_FILES.filter((file) => {
    const path = join(repo, file);
    return existsSync(path) && hasActiveReference(readFileSync(path, 'utf8'));
  });
  const referencePresent = referencedIn.length > 0;

  if (!treePresent && !referencePresent) return 'stripped';
  if (configPresent && referencePresent) return 'installed';

  const facts = [
    `${TREE}/: ${treePresent ? 'present' : 'absent'}`,
    `${CONFIG}: ${configPresent ? 'present' : 'absent'}`,
    `active ${REFERENCE} reference: ${
      referencePresent ? `present in ${referencedIn.join(', ')}` : 'absent'
    }`,
  ];
  let remedy;
  if (treePresent && !configPresent) {
    remedy = `${TREE}/ exists without ${CONFIG}. Restore the dev config (or run dev:setup), or delete ${TREE}/ to return to stripped state.`;
  } else if (treePresent && !referencePresent) {
    remedy = `The dev-plugin tree is installed but no entry file activates it. Add the reference line to AGENTS.md (dev:setup writes it), or delete ${TREE}/ to return to stripped state.`;
  } else {
    remedy = `An entry file references ${REFERENCE} but ${TREE}/ does not exist. Run dev:setup to install the tree, or remove the reference line to return to stripped state.`;
  }
  throw new UpgradeStateError(
    [
      'inconsistent dev-plugin state; upgrade stopped before merging.',
      ...facts.map((fact) => `  - ${fact}`),
      `  remedy: ${remedy}`,
    ].join('\n'),
    EXIT_MIXED,
  );
}

/**
 * The instance commit the merge started from. During an in-progress merge that is
 * still `HEAD`; once the merge auto-committed it is `ORIG_HEAD` (git sets it at
 * merge start).
 */
function preMergeRevision(repo, mergeInProgress) {
  if (mergeInProgress) return 'HEAD';
  const origHead = git(repo, ['rev-parse', '--verify', '--quiet', 'ORIG_HEAD'], {
    allowFailure: true,
  });
  if (!origHead) {
    throw new UpgradeStateError(
      'no merge in progress and no ORIG_HEAD: run reconcile immediately after the merge command.',
      EXIT_FAILURE,
    );
  }
  return 'ORIG_HEAD';
}

function mergeIsInProgress(repo) {
  // `--git-path` answers relative to the repo root in a standard clone
  // (`.git/MERGE_HEAD`) but ABSOLUTE in a linked worktree
  // (`<main>/.git/worktrees/<name>/MERGE_HEAD`). `resolve` handles both; `join`
  // would prefix the repo onto the absolute form, miss the file, and take the
  // already-committed branch mid-merge — where `git commit --amend` refuses.
  return existsSync(resolve(repo, git(repo, ['rev-parse', '--git-path', 'MERGE_HEAD'])));
}

function reconcileStripped(repo, mergeInProgress) {
  const notes = [];
  // Both listings repeat a conflicted path once per stage; count distinct paths.
  const tracked = distinctPaths(gitLines(repo, ['ls-files', '--', TREE]));
  const unmerged = distinctPaths(gitLines(repo, ['ls-files', '-u', '--', TREE]));
  let staged = false;

  if (tracked.length > 0 || unmerged.length > 0) {
    // Resolves both cases in one step: a modify/delete conflict (shared history)
    // and a clean theirs-only addition (unrelated-history first merge).
    git(repo, ['rm', '-r', '-f', '-q', '--ignore-unmatch', '--', TREE]);
    staged = true;
    notes.push(
      `removed ${tracked.length} framework path(s) under ${TREE}/ (${unmerged.length} were conflicted)`,
    );
  }
  if (isDirectory(join(repo, TREE))) {
    rmSync(join(repo, TREE), { recursive: true, force: true });
    notes.push(`removed untracked leftovers under ${TREE}/`);
  }

  for (const file of ENTRY_FILES) {
    const path = join(repo, file);
    if (!existsSync(path)) continue;
    const stripped = stripActiveReference(readFileSync(path, 'utf8'));
    if (stripped === null) continue;
    writeFileSync(path, stripped);
    git(repo, ['add', '--', file]);
    staged = true;
    notes.push(`removed the active ${REFERENCE} reference from ${file}`);
  }

  // The merge already committed (no conflicts to stop it), so the framework tree
  // is in the merge commit. Amend it — both parents are preserved, and the
  // finalized merge never carries dev-plugin state.
  if (!mergeInProgress && staged) {
    git(repo, ['commit', '--amend', '--no-edit', '--quiet']);
    notes.push('amended the merge commit so no framework dev-plugin state is committed');
  }

  const failures = [];
  if (gitLines(repo, ['ls-files', '--', TREE]).length > 0) {
    failures.push(`${TREE}/ is still tracked in the index`);
  }
  if (gitLines(repo, ['ls-files', '-u', '--', TREE]).length > 0) {
    failures.push(`${TREE}/ still has unmerged entries`);
  }
  if (isDirectory(join(repo, TREE))) failures.push(`${TREE}/ still exists in the working tree`);
  if (!mergeInProgress && gitLines(repo, ['ls-tree', '-r', '--name-only', 'HEAD', '--', TREE]).length > 0) {
    failures.push(`${TREE}/ is committed in ${git(repo, ['rev-parse', '--short', 'HEAD'])}`);
  }
  for (const file of ENTRY_FILES) {
    const path = join(repo, file);
    if (existsSync(path) && hasActiveReference(readFileSync(path, 'utf8'))) {
      failures.push(`${file} still carries an active ${REFERENCE} reference`);
    }
  }
  if (failures.length > 0) {
    throw new UpgradeStateError(
      ['stripped state was not preserved:', ...failures.map((f) => `  - ${f}`)].join('\n'),
      EXIT_FAILURE,
    );
  }
  return notes;
}

function reconcileInstalled(repo, mergeInProgress) {
  const notes = [];
  const failures = [];

  const unmerged = distinctPaths(gitLines(repo, ['ls-files', '-u', '--', TREE]));
  if (unmerged.length > 0) {
    throw new UpgradeStateError(
      [
        `${TREE}/ conflicted, which means \`merge=ours\` did not apply to your own dev-plugin state:`,
        ...unmerged.map((path) => `  - ${path}`),
        '  remedy: the `ours` merge driver is per-clone and not version-controlled. Run',
        '          `git merge --abort`, then `git config merge.ours.driver true`, then re-run the upgrade.',
      ].join('\n'),
      EXIT_FAILURE,
    );
  }

  // merge=ours must have kept every adopter-owned path byte-for-byte. A framework
  // path the adopter does not have is an ADDITION (git applies no merge driver to
  // it); that is reported for the user to decide, never silently kept or deleted.
  const rev = preMergeRevision(repo, mergeInProgress);
  const added = [];
  for (const line of gitLines(repo, ['diff', '--name-status', rev, '--', TREE])) {
    const [status, ...pathParts] = line.split('\t');
    const path = pathParts.join('\t');
    if (status.startsWith('A')) added.push(path);
    else failures.push(`${path} changed (${status}) against the pre-merge tree`);
  }

  if (!existsSync(join(repo, CONFIG))) failures.push(`${CONFIG} is missing after the merge`);
  const entryFile = ENTRY_FILES.map((file) => join(repo, file)).find(
    (path) => existsSync(path) && hasActiveReference(readFileSync(path, 'utf8')),
  );
  if (!entryFile) failures.push(`no entry file carries an active ${REFERENCE} reference after the merge`);

  if (failures.length > 0) {
    throw new UpgradeStateError(
      [
        'installed dev-plugin state was not preserved:',
        ...failures.map((f) => `  - ${f}`),
        '  remedy: check `git config merge.ours.driver true` in this clone, then re-run the upgrade.',
      ].join('\n'),
      EXIT_FAILURE,
    );
  }

  notes.push(`adopter-owned ${TREE}/ is byte-for-byte unchanged against ${rev}`);
  if (added.length > 0) {
    notes.push(
      `the merge ADDED ${added.length} framework path(s) under ${TREE}/ that you did not have: ${added.join(', ')}.`,
      'These are framework-development state, not adopter content — decide per file: keep it, or',
      `\`git rm -f -- <path>\`${
        mergeInProgress ? ' before finalizing the merge' : ' followed by `git commit --amend --no-edit`'
      }. The upgrade does not decide for you.`,
    );
  }
  return notes;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { repo: process.cwd(), state: null };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (flag === '--repo' || flag === '--state') {
      if (value === undefined) throw new UpgradeStateError(`${flag} needs a value`, EXIT_USAGE);
      options[flag === '--repo' ? 'repo' : 'state'] = value;
      i += 1;
    } else {
      throw new UpgradeStateError(`unknown argument: ${flag}`, EXIT_USAGE);
    }
  }
  return { command, options };
}

function main(argv) {
  const { command, options } = parseArgs(argv);
  const repoRoot = git(options.repo, ['rev-parse', '--show-toplevel']);

  if (command === 'classify') {
    const state = classify(repoRoot);
    process.stdout.write(`${state}\n`);
    return;
  }

  if (command === 'reconcile') {
    if (options.state !== 'stripped' && options.state !== 'installed') {
      throw new UpgradeStateError(
        'reconcile needs --state stripped|installed (the value `classify` printed BEFORE the merge)',
        EXIT_USAGE,
      );
    }
    const mergeInProgress = mergeIsInProgress(repoRoot);
    const notes =
      options.state === 'stripped'
        ? reconcileStripped(repoRoot, mergeInProgress)
        : reconcileInstalled(repoRoot, mergeInProgress);
    for (const note of notes) process.stdout.write(`dev-plugin-state: ${note}\n`);
    process.stdout.write(`dev-plugin-state: ${options.state} state preserved\n`);
    return;
  }

  throw new UpgradeStateError(
    'usage: dev-plugin-state.mjs classify [--repo <dir>]\n' +
      '       dev-plugin-state.mjs reconcile --state <stripped|installed> [--repo <dir>]',
    EXIT_USAGE,
  );
}

try {
  main(process.argv.slice(2));
} catch (err) {
  if (err instanceof UpgradeStateError) {
    process.stderr.write(`dev-plugin-state: ${err.message}\n`);
    process.exit(err.code);
  }
  throw err;
}
