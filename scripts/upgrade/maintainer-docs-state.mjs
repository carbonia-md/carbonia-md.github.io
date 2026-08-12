#!/usr/bin/env node
//
// maintainer-docs-state.mjs — classify and preserve an instance's maintainer-doc
// state across a framework tag merge (ADR 008 addendum, SPEC "Repo topology").
//
//   node scripts/upgrade/maintainer-docs-state.mjs classify  [--repo <dir>] [--from-tag <tag>] [--state <file>]
//   node scripts/upgrade/maintainer-docs-state.mjs reconcile [--repo <dir>] [--state <file>]
//   node scripts/upgrade/maintainer-docs-state.mjs paths     [--repo <dir>] [--from-tag <tag>]
//
// Why this exists: `.gitattributes merge=ours` protects the CONTENT of a path that
// exists on both merge sides. It does not preserve an intentionally ABSENT path.
// The framework's own maintainer documents are removed by `npm run init`, so an
// adopted instance has none of them — git therefore applies no merge driver there
// and re-adds the framework's copies on every tag merge that touched them (a
// modify/delete conflict on shared history, a theirs-only addition on an
// unrelated-history first merge). This is the dev-plugin failure of ADR 006's
// addendum in a second location, and `dev-plugin-state.mjs` is its sibling.
//
// The path set is NEVER hardcoded here. It is derived at runtime from the init
// wizard's exported MAINTAINER_DOCS — the same single source the CI gate
// `scripts/ci/check-framework-docs.mjs` derives from, which imports the parser
// below and asserts both agree. A hardcoded copy in the upgrade path would drift
// from the strip it exists to preserve.
//
// `--from-tag <tag>` moves only the DERIVATION to that tag, reading the wizard with
// `git show <tag>:scripts/init/writer.mjs`; path PRESENCE is still read from the
// pre-merge working tree, which is the only place that records what the instance
// owns. It exists for the first upgrade to a release that introduces the strip
// list: the helper is bootstrapped out of that tag, but the working tree's wizard
// still predates the export, so deriving from the working tree exits 3 and the
// classification the whole pass depends on cannot be produced at all. Later
// upgrades may pass it or not — after the first merge both sources agree, because
// the wizard is framework-owned.
//
// Classification is PER PATH, not whole-set (ADR 008 addendum (a)): these paths
// carry no activation signal and are mutually independent, so an instance may
// legitimately own some and not others. A partial set is a normal state, never a
// stop.
//
//   owned    = present before the merge -> never deleted; a change the merge made is
//              RESTORED where the instance marked the path `merge=ours`, and stops
//              the upgrade where it did not
//   stripped = absent  before the merge -> whatever the merge introduced is removed
//
// The restore exists because `merge=ours` names a driver git runs only on a
// three-way CONTENT merge: an instance whose copy still equals the merge base has
// `ours == base`, so git resolves to theirs and the attribute never fires. That is
// a property of every `merge=ours` path, not of one file — `package-state.mjs`
// applies the same capture-and-restore to `FRAMEWORK-VERSION`, and this helper
// applies it to the maintainer-doc tree.
//
// `classify` runs in preflight, BEFORE the merge, on a clean working tree, and
// writes its answer into the git directory (never the working tree). `reconcile`
// reads that answer immediately AFTER the merge command, whether the merge stopped
// on conflicts or completed on its own — after the merge the tree no longer shows
// what the instance owned.
//
// Exit codes: 0 = ok, 1 = reconcile failed / postcondition violated,
// 2 = usage error, 3 = the maintainer-doc contract could not be derived.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const WIZARD = 'scripts/init/writer.mjs';
const STATE_FILE = 'sekai-maintainer-docs-state.json';

const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const EXIT_UNDERIVABLE = 3;

class UpgradeStateError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/**
 * The init wizard declares the strip list as one array literal:
 *   export const MAINTAINER_DOCS = ['docs/...', ...];
 * Returns null when the literal is absent or empty — never a silent empty list,
 * which would classify every path as absent and delete nothing while reporting
 * success. It lives here, rather than in the CI gate that also needs it, because
 * this helper must run standalone when it is extracted from a release tag into the
 * git directory and so cannot import it; `scripts/ci/check-framework-docs.mjs`
 * imports THIS function, so there is one derivation rather than two.
 */
export function deriveMaintainerDocs(src) {
  const m = /export\s+const\s+MAINTAINER_DOCS\s*=\s*\[([^\]]*)\]/.exec(src);
  if (!m) return null;
  const docs = m[1]
    .split(',')
    .map((token) => token.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  return docs.length > 0 ? docs : null;
}

function git(repo, args, { allowFailure = false, raw = false } = {}) {
  try {
    const out = execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    return raw ? out : out.trim();
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
 * Records from a NUL-separated (`-z`) git listing. Every path this helper hands
 * back to git — as a `check-attr` argument or a `checkout` pathspec — is read this
 * way, because git's LINE-based output is not a path: `core.quotePath` defaults to
 * true, so any path carrying a byte above 0x7f comes back C-quoted
 * (`"caf\303\251.md"` for a file named `café.md`). That is neither a pathspec git accepts nor
 * a path `check-attr` resolves, so a maintainer doc whose name is not pure ASCII
 * would be read as unclaimed and stop the upgrade with the one remedy that cannot
 * fix it — the exact defect this helper exists to remove. `-z` writes every path
 * verbatim, whatever bytes it holds.
 *
 * The trailing NUL terminates the last record rather than separating another, so
 * the empty tail is dropped. Read raw: `trim()` would be harmless on NUL-delimited
 * output (NUL is not JavaScript whitespace) but the guarantee this needs is that
 * nothing between the delimiters is touched.
 */
function gitRecords(repo, args, options) {
  const out = git(repo, args, { ...options, raw: true });
  if (!out) return [];
  return out.split('\0').filter((record) => record !== '');
}

/**
 * Distinct paths from a `git ls-files -z` listing. `git ls-files -u` prefixes each
 * record with `<mode> <sha> <stage>\t` and repeats a conflicted path once per stage,
 * so counting raw records overstates how many paths are involved. Split on the FIRST
 * tab: the prefix contains none, and a path may contain one.
 */
function distinctPaths(records) {
  return [...new Set(records.map((record) => {
    const cut = record.indexOf('\t');
    return cut === -1 ? record : record.slice(cut + 1);
  }))];
}

/**
 * The wizard source the path set is derived from: the working tree by default, or
 * the tag named by `--from-tag`. Returns null when that source has no wizard.
 */
function wizardSource(repo, fromTag) {
  if (fromTag) {
    return git(repo, ['show', `${fromTag}:${WIZARD}`], { allowFailure: true });
  }
  const wizard = join(repo, WIZARD);
  return existsSync(wizard) ? readFileSync(wizard, 'utf8') : null;
}

/** Maintainer-doc paths, derived from the wizard in the working tree or in `--from-tag`. */
function maintainerDocs(repo, fromTag) {
  const where = fromTag ? `${fromTag}:${WIZARD}` : WIZARD;
  const src = wizardSource(repo, fromTag);
  if (src === null) {
    throw new UpgradeStateError(
      [
        `cannot derive the maintainer-doc contract: ${where} is missing.`,
        '  This helper never hardcodes the path set; it reads the init wizard so the upgrade',
        '  and the adoption strip cannot disagree.',
        fromTag
          ? '  remedy: name a tag that carries the framework scripts, or drop --from-tag to read'
            + '\n          the working tree.'
          : '  remedy: run this from an instance repository that carries the framework scripts,'
            + '\n          or pass --repo pointing at one.',
      ].join('\n'),
      EXIT_UNDERIVABLE,
    );
  }
  const docs = deriveMaintainerDocs(src);
  if (!docs) {
    throw new UpgradeStateError(
      [
        `cannot derive the maintainer-doc contract: no MAINTAINER_DOCS array literal in ${where}.`,
        '  Treating that as an empty set would classify every path as absent, delete nothing,',
        '  and report success — so this stops instead.',
        fromTag
          ? '  remedy: name a release tag whose wizard exports MAINTAINER_DOCS, or re-point the'
            + '\n          derivation in the same commit that moved or renamed the list.'
          : '  remedy: on the FIRST upgrade to a release that introduces the strip list, this tree\'s'
            + '\n          wizard predates it — re-run with `--from-tag <the tag being merged>` so the'
            + '\n          path set comes from that tag while presence is still read from this tree.'
            + '\n          Otherwise: re-point the derivation in the same commit that moved the list.',
      ].join('\n'),
      EXIT_UNDERIVABLE,
    );
  }
  return docs;
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Where the captured classification lives: inside the git directory, never the working tree. */
function statePath(repo, override) {
  if (override) return resolve(override);
  // `--git-path` answers relative to the repo root in a standard clone but
  // ABSOLUTE in a linked worktree; `resolve` handles both.
  return resolve(repo, git(repo, ['rev-parse', '--git-path', STATE_FILE]));
}

function mergeIsInProgress(repo) {
  // Same absolute-vs-relative `--git-path` case as above: `join` would prefix the
  // repo onto the absolute form, miss the file, and take the already-committed
  // branch mid-merge — where `git commit --amend` refuses.
  return existsSync(resolve(repo, git(repo, ['rev-parse', '--git-path', 'MERGE_HEAD'])));
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

/** Working-tree presence, the whole classification for a maintainer-doc path. */
function classify(repo, fromTag) {
  const paths = maintainerDocs(repo, fromTag);
  const owned = [];
  const stripped = [];
  for (const rel of paths) {
    if (existsSync(join(repo, rel))) owned.push(rel);
    else stripped.push(rel);
  }
  return { owned, stripped };
}

function writeState(repo, override, fromTag) {
  const state = classify(repo, fromTag);
  const file = statePath(repo, override);
  writeFileSync(file, `${JSON.stringify({ version: 1, ...state }, null, 2)}\n`);
  return { ...state, file };
}

function readState(repo, override) {
  const file = statePath(repo, override);
  if (!existsSync(file)) {
    throw new UpgradeStateError(
      [
        `no captured maintainer-doc state at ${file}.`,
        '  reconcile consumes the answer `classify` recorded BEFORE the merge; after the merge',
        '  the tree no longer shows what the instance owned.',
        '  remedy: abort the merge, run `classify`, then merge and re-run `reconcile`.',
      ].join('\n'),
      EXIT_FAILURE,
    );
  }
  const state = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(state.owned) || !Array.isArray(state.stripped)) {
    throw new UpgradeStateError(`captured maintainer-doc state at ${file} is malformed`, EXIT_FAILURE);
  }
  return { ...state, file };
}

/** Did this path exist in the pre-merge tree? Answers for a file or a directory. */
function existedAt(repo, rev, rel) {
  return gitLines(repo, ['ls-tree', '-r', '--name-only', rev, '--', rel]).length > 0;
}

/**
 * The `merge` attribute git resolves for a path — `ours` when the instance claimed
 * it, `unspecified` when nothing does. Read per FILE, not per declared path: the
 * declaration is a directory and the attribute is a glob under it. `check-attr`
 * answers from the pattern set rather than the file, so it still answers for a path
 * the merge deleted.
 */
function mergeAttribute(repo, path) {
  // `<path>: merge: <value>`, and a path may itself contain `: ` — read the tail.
  const out = git(repo, ['check-attr', 'merge', '--', path]);
  const cut = out.lastIndexOf(': ');
  return cut === -1 ? 'unspecified' : out.slice(cut + 2);
}

/**
 * Is the `ours` driver defined in this clone? It is per-clone and not
 * version-controlled, so it is observed rather than assumed.
 */
function oursDriverConfigured(repo) {
  return git(repo, ['config', '--get', 'merge.ours.driver'], { allowFailure: true }) !== null;
}

function reconcile(repo, override) {
  const notes = [];
  const failures = [];
  const captured = readState(repo, override);
  const mergeInProgress = mergeIsInProgress(repo);
  const rev = preMergeRevision(repo, mergeInProgress);

  // Re-derive from the MERGED tree: a path the incoming release newly declares
  // maintainer-owned is handled on the upgrade that introduces it, rather than one
  // release later. Anything the capture did not classify is decided from the
  // pre-merge revision directly.
  const declared = maintainerDocs(repo);
  const all = [...new Set([...captured.owned, ...captured.stripped, ...declared])].sort();

  let staged = false;
  const removed = [];
  const kept = [];
  const added = [];
  const restored = [];
  const driverConfigured = oursDriverConfigured(repo);

  for (const rel of all) {
    const owned = captured.owned.includes(rel)
      || (!captured.stripped.includes(rel) && existedAt(repo, rev, rel));

    if (!owned) {
      const tracked = distinctPaths(gitRecords(repo, ['ls-files', '-z', '--', rel]));
      const unmerged = distinctPaths(gitRecords(repo, ['ls-files', '-u', '-z', '--', rel]));
      if (tracked.length > 0 || unmerged.length > 0) {
        // Resolves both shapes in one step: the modify/delete conflict on shared
        // history and the clean theirs-only addition on an unrelated-history merge.
        git(repo, ['rm', '-r', '-f', '-q', '--ignore-unmatch', '--', rel]);
        staged = true;
        removed.push(`${rel} (${tracked.length} path(s), ${unmerged.length} conflicted)`);
      }
      const abs = join(repo, rel);
      if (isDirectory(abs)) {
        rmSync(abs, { recursive: true, force: true });
        removed.push(`${rel} (untracked leftovers)`);
      } else if (existsSync(abs)) {
        rmSync(abs, { force: true });
        removed.push(`${rel} (untracked leftover file)`);
      }
      continue;
    }

    // Owned: the instance's own document must come out of the merge intact, and
    // `merge=ours` is not on its own enough to make that happen. The driver runs
    // only on a three-way CONTENT merge, so an instance whose copy still equals the
    // merge base has `ours == base` and git resolves to theirs without consulting
    // it. Restoring the pre-merge content is therefore the normal outcome wherever
    // the instance CLAIMED the path (`check-attr merge` reports `ours`); where it
    // did not, this stops instead, because reverting the framework's edit on an
    // unclaimed path would be the framework deciding ownership for the instance.
    const unmerged = distinctPaths(gitRecords(repo, ['ls-files', '-u', '-z', '--', rel]));
    const moved = unmerged.map((path) => ({ path, status: 'conflicted' }));
    // `-z` because every path below is fed straight back to git, and `--no-renames`
    // because a rename status carries TWO paths per entry. Together they make each
    // entry exactly one status record followed by one verbatim path record.
    const changes = gitRecords(repo, ['diff', '--name-status', '--no-renames', '-z', rev, '--', rel]);
    for (let i = 0; i + 1 < changes.length; i += 2) {
      const status = changes[i];
      const path = changes[i + 1];
      if (unmerged.includes(path)) continue;
      if (status.startsWith('A')) added.push(path);
      else moved.push({ path, status: `changed (${status}) against the pre-merge tree` });
    }
    for (const { path, status } of moved) {
      const attribute = mergeAttribute(repo, path);
      if (attribute !== 'ours') {
        failures.push({ path, status, attribute });
        continue;
      }
      git(repo, ['checkout', rev, '--', path]);
      staged = true;
      restored.push(`${path} (${status})`);
    }
    kept.push(rel);
  }

  if (failures.length > 0) {
    // The undo depends on whether git stopped or committed. A merge that applied
    // the framework's edits without a conflict is ALREADY on this branch, and
    // `git merge --abort` fails there with `no merge to abort` — the state this
    // diagnostic exists to get the user out of.
    const state = mergeInProgress
      ? '  The merge has not been committed yet.'
      : '  The merge is ALREADY COMMITTED on this branch and currently carries the framework\'s\n'
        + '  copies of those documents. Undo it before pushing.';
    const undo = mergeInProgress
      ? '`git merge --abort`'
      : '`git reset --hard ORIG_HEAD` (ORIG_HEAD is the commit this merge started from)';
    // Both observations are reported, and only the repairs they support are
    // prescribed. Telling a reader to mark a path that `check-attr` already reports
    // as `ours`, or to configure a driver that is already configured, is a remedy
    // that cannot fix anything and leaves re-running as the only visible move.
    const driverObservation = driverConfigured
      ? '  observed: `merge.ours.driver` IS configured in this clone, so the driver is not what'
        + '\n            went wrong here.'
      : '  observed: `merge.ours.driver` is NOT configured in this clone (it is per-clone and not'
        + '\n            version-controlled), so the attribute could not protect any path here.';
    const remedy = driverConfigured
      ? [
        `  remedy: ${undo}, mark those paths \`merge=ours\` in \`.gitattributes\`, then re-run`,
        '          the upgrade.',
      ]
      : [
        `  remedy: ${undo}, mark those paths \`merge=ours\` in \`.gitattributes\`, run`,
        '          `git config merge.ours.driver true`, then re-run the upgrade.',
      ];
    throw new UpgradeStateError(
      [
        'maintainer-doc state was not preserved:',
        ...failures.map((f) => `  - ${f.path} ${f.status}; \`git check-attr merge\` reports \`${f.attribute}\``),
        '  These paths hold documents this instance owns, but nothing in `.gitattributes` claims',
        '  them as instance-owned, so the upgrade will not revert the framework\'s edits for you:',
        '  deciding that a path belongs to the instance is the instance\'s call, not the',
        '  framework\'s. A path that IS marked `merge=ours` is restored automatically instead.',
        driverObservation,
        state,
        ...remedy,
      ].join('\n'),
      EXIT_FAILURE,
    );
  }

  // The merge already committed (nothing conflicted to stop it), so whatever this
  // pass removed or restored is otherwise in the merge commit. Amend it — both
  // parents are preserved, and the finalized merge carries neither a maintainer doc
  // the instance does not own nor the framework's copy of one it does.
  if (!mergeInProgress && staged) {
    git(repo, ['commit', '--amend', '--no-edit', '--quiet']);
    notes.push('amended the merge commit so the reconciled maintainer-doc state is what it carries');
  }

  const postconditions = [];
  for (const rel of all) {
    if (captured.owned.includes(rel)) continue;
    if (kept.includes(rel)) continue;
    if (gitLines(repo, ['ls-files', '--', rel]).length > 0) postconditions.push(`${rel} is still tracked in the index`);
    if (gitLines(repo, ['ls-files', '-u', '--', rel]).length > 0) postconditions.push(`${rel} still has unmerged entries`);
    if (existsSync(join(repo, rel))) postconditions.push(`${rel} still exists in the working tree`);
    if (!mergeInProgress && gitLines(repo, ['ls-tree', '-r', '--name-only', 'HEAD', '--', rel]).length > 0) {
      postconditions.push(`${rel} is committed in ${git(repo, ['rev-parse', '--short', 'HEAD'])}`);
    }
  }
  if (postconditions.length > 0) {
    throw new UpgradeStateError(
      ['stripped maintainer-doc state was not preserved:', ...postconditions.map((f) => `  - ${f}`)].join('\n'),
      EXIT_FAILURE,
    );
  }

  if (removed.length > 0) {
    notes.push(`removed framework maintainer docs this instance does not own: ${removed.join(', ')}`);
  }
  if (restored.length > 0) {
    notes.push(
      `restored ${restored.length} instance-owned maintainer-doc file(s) the merge had moved: ${restored.join(', ')}.`,
      'Those paths are marked `merge=ours`, but git consults a merge driver only on a three-way'
        + ' content merge — an instance whose copy still equals the merge base gets theirs'
        + ' fast-forwarded in, so the attribute never fired. Your pre-merge content is back.',
    );
    if (!driverConfigured) {
      notes.push(
        '`merge.ours.driver` is NOT configured in this clone, so the attribute protected nothing'
          + ' here at all. `/sekai-upgrade` sets it before merging (`git config merge.ours.driver'
          + ' true`, per docs/runbook/UPGRADE.md); configure it in this clone.',
      );
    }
  }
  if (kept.length > 0) {
    notes.push(`instance-owned, holding this instance's ${rev} content: ${kept.join(', ')}`);
  }
  if (added.length > 0) {
    notes.push(
      `the merge ADDED ${added.length} framework file(s) under paths you own: ${added.join(', ')}.`,
      'These are framework-development documents, not your content — decide per file: keep it, or',
      `\`git rm -f -- <path>\`${
        mergeInProgress ? ' before finalizing the merge' : ' followed by `git commit --amend --no-edit`'
      }. The upgrade does not decide for you.`,
    );
  }
  if (notes.length === 0) notes.push('nothing to reconcile: the merge carried no maintainer-doc change');

  unlinkSync(captured.file);
  return notes;
}

// Options are declared PER COMMAND, not globally, and this table is the single
// source both the parser and the documentation guard read. `--from-tag` is
// deliberately absent from `reconcile`: reconciliation must derive from the MERGED
// tree, so that a merge which did not bring the framework's wizard through is
// exposed here rather than papered over by reading the tag instead. Accepting the
// flag there would let a caller opt out of the check the step exists to make.
// `scripts/upgrade/check-upgrade-state.sh` derives the accepted set from this
// literal and asserts the upgrade documents pass only options it really contains.
const COMMAND_OPTIONS = {
  classify: { '--repo': 'repo', '--state': 'state', '--from-tag': 'fromTag' },
  reconcile: { '--repo': 'repo', '--state': 'state' },
  paths: { '--repo': 'repo', '--from-tag': 'fromTag' },
};

const USAGE = 'usage: maintainer-docs-state.mjs classify  [--repo <dir>] [--from-tag <tag>] [--state <file>]\n'
  + '       maintainer-docs-state.mjs reconcile [--repo <dir>] [--state <file>]\n'
  + '       maintainer-docs-state.mjs paths     [--repo <dir>] [--from-tag <tag>]\n'
  + '  --from-tag moves only the path-set derivation to that tag; presence is always read\n'
  + '  from the working tree. Use it on the first upgrade to a release that introduces the\n'
  + '  strip list, when this tree\'s wizard still predates it. `reconcile` does not take it:\n'
  + '  after the merge the path set must come from the merged tree.';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const accepted = COMMAND_OPTIONS[command];
  if (!accepted) return { command, options: null };
  const options = { repo: process.cwd(), state: null, fromTag: null };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = rest[i + 1];
    const key = accepted[flag];
    if (!key) {
      const known = Object.values(COMMAND_OPTIONS).some((table) => flag in table);
      throw new UpgradeStateError(
        known
          ? `${flag} is not an option of \`${command}\`.\n`
            + (flag === '--from-tag'
              ? '  reconcile must derive the path set from the MERGED tree: that is how a merge\n'
                + '  which did not bring the wizard through is caught. Pass --from-tag to `classify`\n'
                + '  before the merge instead.'
              : `  run \`${command}\` with the options its usage line lists.`)
          : `unknown argument: ${flag}`,
        EXIT_USAGE,
      );
    }
    if (value === undefined) throw new UpgradeStateError(`${flag} needs a value`, EXIT_USAGE);
    options[key] = value;
    i += 1;
  }
  return { command, options };
}

function main(argv) {
  const { command, options } = parseArgs(argv);
  if (options === null) throw new UpgradeStateError(USAGE, EXIT_USAGE);
  const repoRoot = git(options.repo, ['rev-parse', '--show-toplevel']);

  if (command === 'paths') {
    for (const rel of maintainerDocs(repoRoot, options.fromTag)) process.stdout.write(`${rel}\n`);
    return;
  }

  if (command === 'classify') {
    const state = writeState(repoRoot, options.state, options.fromTag);
    process.stdout.write(`maintainer-docs-state: owned: ${state.owned.join(', ') || 'none'}\n`);
    process.stdout.write(`maintainer-docs-state: stripped: ${state.stripped.join(', ') || 'none'}\n`);
    process.stdout.write(`maintainer-docs-state: recorded ${state.file}\n`);
    return;
  }

  if (command === 'reconcile') {
    for (const note of reconcile(repoRoot, options.state)) {
      process.stdout.write(`maintainer-docs-state: ${note}\n`);
    }
    process.stdout.write('maintainer-docs-state: maintainer-doc state preserved\n');
    return;
  }

  throw new UpgradeStateError(USAGE, EXIT_USAGE);
}

// Run only when executed directly: `check-framework-docs.mjs` imports the parser
// above so there is one derivation, not two. `realpathSync` is load-bearing —
// `import.meta.url` is the resolved real path, while `process.argv[1]` keeps the
// symlinks it was invoked through (a temp directory under `/var` on macOS is
// really `/private/var`), and comparing the two unresolved makes this file a
// silent no-op when it is run from an extracted copy.
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
    if (err instanceof UpgradeStateError) {
      process.stderr.write(`maintainer-docs-state: ${err.message}\n`);
      process.exit(err.code);
    }
    throw err;
  }
}
