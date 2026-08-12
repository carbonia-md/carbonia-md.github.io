#!/usr/bin/env node
//
// package-state.mjs — carry adopter-owned state across a framework tag merge.
//
// Two things ride this helper, for the same reason and through the same
// capture -> merge -> restore -> amend shape:
//
//   1. The mixed-ownership npm manifests. Sekai owns scripts, dependencies, and
//      lock resolution; the adopter owns package name, description, privacy, and
//      the version mirrored from VERSION. They are deliberately NOT `merge=ours`,
//      because the framework half must come through.
//   2. FRAMEWORK-VERSION. It IS marked `merge=ours`, and that is not enough: a
//      merge driver only runs on a three-way conflict, and an instance that has
//      not touched the file since the merge base has `ours == base`, so git
//      fast-forwards to theirs and the file silently claims the incoming release
//      before anything has verified. The upgrade's contract is that it still reads
//      the OLD version until the explicit post-verification bump, so the pre-merge
//      value is captured here and restored immediately after the merge. Restoring
//      an absent file means removing whatever the merge introduced: an instance
//      that had no FRAMEWORK-VERSION must not gain one that predates its own
//      verification.
//
// `scripts/upgrade/check-upgrade-state.sh` is the regression gate for the
// FRAMEWORK-VERSION half; `scripts/upgrade/check-package-state.mjs` for the
// manifest half.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION_RE = /^v\d+\.\d+\.\d+$/;
const FRAMEWORK_VERSION = 'FRAMEWORK-VERSION';

const git = (root, args, options = {}) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  ...options,
});

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const gitPath = (root, name) => {
  const path = git(root, ['rev-parse', '--git-path', name]).trim();
  return resolve(root, path);
};

const validateAdopter = (root) => {
  if (existsSync(resolve(root, '.sekai-template'))) {
    throw new Error('package-state is an adopter upgrade helper, not a framework release tool');
  }
  const version = readFileSync(resolve(root, 'VERSION'), 'utf8').trim();
  if (!VERSION_RE.test(version)) throw new Error('VERSION is not a v-prefixed semantic version');
  const pkg = readJson(resolve(root, 'package.json'));
  const lock = readJson(resolve(root, 'package-lock.json'));
  const npmVersion = version.slice(1);
  const legacyVersionless = pkg.version === undefined
    && lock.version === undefined
    && lock.packages?.['']?.version === undefined;
  if (!legacyVersionless && pkg.version !== npmVersion) {
    throw new Error('package.json.version does not match VERSION');
  }
  if (!legacyVersionless && (lock.version !== npmVersion || lock.packages?.['']?.version !== npmVersion)) {
    throw new Error('package-lock.json root versions do not match VERSION');
  }
  return { version, pkg, lock };
};

// Raw bytes, so the restore is byte-for-byte; `null` records "the instance had no
// FRAMEWORK-VERSION", which is a real pre-wizard state and not the same as "not
// captured" (an absent key, written by an older release of this helper).
const readFrameworkVersion = (root) => {
  const path = resolve(root, FRAMEWORK_VERSION);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
};

export const capturePackageState = (root, output = gitPath(root, 'sekai-package-state.json')) => {
  const base = resolve(root);
  const { version, pkg } = validateAdopter(base);
  const state = {
    name: pkg.name,
    description: pkg.description,
    private: pkg.private,
    version,
    frameworkVersion: readFrameworkVersion(base),
  };
  writeFileSync(output, `${JSON.stringify(state, null, 2)}\n`);
  return output;
};

const incomingRef = (root) => {
  try {
    return git(root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).trim();
  } catch {
    const parents = git(root, ['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(/\s+/);
    if (parents.length < 3) throw new Error('no framework merge is in progress and HEAD is not a merge commit');
    return 'HEAD^2';
  }
};

const readIncomingJson = (root, ref, path) => JSON.parse(git(root, ['show', `${ref}:${path}`]));

const writeJsonAtomic = (path, value) => {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(temp, path);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
};

export const reconcilePackageState = (root, statePath = gitPath(root, 'sekai-package-state.json')) => {
  const base = resolve(root);
  if (!existsSync(statePath)) throw new Error(`captured package state is missing: ${statePath}`);
  const state = readJson(statePath);
  if (!VERSION_RE.test(state.version)) throw new Error('captured VERSION is invalid');

  const ref = incomingRef(base);
  const pkg = readIncomingJson(base, ref, 'package.json');
  const lock = readIncomingJson(base, ref, 'package-lock.json');
  const npmVersion = state.version.slice(1);

  pkg.name = state.name;
  pkg.version = npmVersion;
  pkg.private = state.private;
  if (state.description === undefined) delete pkg.description;
  else pkg.description = state.description;
  lock.name = state.name;
  lock.version = npmVersion;
  lock.packages[''].name = state.name;
  lock.packages[''].version = npmVersion;

  writeJsonAtomic(resolve(base, 'package.json'), pkg);
  writeJsonAtomic(resolve(base, 'package-lock.json'), lock);
  git(base, ['add', '--', 'package.json', 'package-lock.json']);

  // A state file written before this helper carried FRAMEWORK-VERSION has no key
  // at all; touching the file on that evidence would be a guess.
  const frameworkVersionCaptured = Object.hasOwn(state, 'frameworkVersion');
  if (frameworkVersionCaptured) {
    const path = resolve(base, FRAMEWORK_VERSION);
    if (state.frameworkVersion === null) {
      git(base, ['rm', '-q', '-f', '--ignore-unmatch', '--', FRAMEWORK_VERSION]);
      if (existsSync(path)) unlinkSync(path);
    } else {
      // Also resolves the path when the merge left it unmerged: the instance's
      // pre-merge bytes are the answer, and staging them settles the conflict.
      writeFileSync(path, state.frameworkVersion);
      git(base, ['add', '--', FRAMEWORK_VERSION]);
    }
  }

  let mergeInProgress = true;
  try {
    git(base, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
  } catch {
    mergeInProgress = false;
  }
  if (!mergeInProgress) git(base, ['commit', '--amend', '--no-edit'], { stdio: 'ignore' });
  unlinkSync(statePath);
  return {
    name: state.name,
    version: state.version,
    frameworkVersion: frameworkVersionCaptured ? state.frameworkVersion : undefined,
    amended: !mergeInProgress,
  };
};

// `realpathSync` is load-bearing, exactly as in `maintainer-docs-state.mjs`:
// `import.meta.url` is the resolved real path while `process.argv[1]` keeps the
// symlinks it was invoked through (a temp directory under `/var` on macOS is
// really `/private/var`). Comparing the two unresolved makes this file a silent
// no-op when it is run from the copy the upgrade extracts out of a release tag —
// which is the documented first-upgrade bootstrap.
const entryPoint = (() => {
  if (!process.argv[1]) return null;
  try {
    return pathToFileURL(realpathSync(resolve(process.argv[1]))).href;
  } catch {
    return null;
  }
})();
const isMain = entryPoint !== null && import.meta.url === entryPoint;
if (isMain) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'capture' && args.length <= 1) {
      console.log(capturePackageState(process.cwd(), args[0]));
    } else if (command === 'reconcile' && args.length <= 1) {
      const result = reconcilePackageState(process.cwd(), args[0]);
      const framework = result.frameworkVersion === undefined
        ? ''
        : `, ${FRAMEWORK_VERSION} held at ${
          result.frameworkVersion === null ? 'absent' : result.frameworkVersion.trim()
        } until the post-verification bump`;
      console.log(
        `package-state: restored ${result.name} ${result.version}${framework}`
          + `${result.amended ? ' and amended the merge commit' : ''}`,
      );
    } else {
      console.error('usage: node scripts/upgrade/package-state.mjs <capture|reconcile> [state-file]');
      process.exit(2);
    }
  } catch (error) {
    console.error(`package-state FAILED: ${error.message}`);
    process.exit(1);
  }
}
