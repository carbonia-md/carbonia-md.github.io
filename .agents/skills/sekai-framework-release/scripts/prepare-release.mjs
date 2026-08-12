#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const LEVELS = new Set(['patch', 'minor', 'major']);
const VERSION_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

const fail = (message) => {
  throw new Error(message);
};

const runGit = (root, args) => execFileSync('git', args, {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

const parseVersion = (value, label) => {
  const match = VERSION_RE.exec(value.trim());
  if (!match) fail(label + ' must contain one v-prefixed semantic version');
  return match.slice(1).map(Number);
};

export const nextVersion = (current, level) => {
  if (!LEVELS.has(level)) fail('release level must be patch, minor, or major');
  let [major, minor, patch] = parseVersion(current, 'FRAMEWORK-VERSION');
  if (level === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (level === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return 'v' + major + '.' + minor + '.' + patch;
};

const replaceVersionLine = (content, indent, current, next, label) => {
  const escaped = current.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    '^ {' + indent + '}"version": "' + escaped + '"(,?)$',
    'gm',
  );
  const matches = [...content.matchAll(pattern)];
  if (matches.length !== 1) {
    fail(label + ' must contain exactly one root version field');
  }
  return content.replace(
    pattern,
    ' '.repeat(indent) + '"version": "' + next + '"$1',
  );
};

const replaceLockVersions = (content, current, next) => {
  const withRoot = replaceVersionLine(
    content,
    2,
    current,
    next,
    'package-lock.json',
  );
  const packageStart = withRoot.search(/^    "": \{$/m);
  if (packageStart === -1) fail('package-lock.json must contain packages[""]');
  const tail = withRoot.slice(packageStart + 1);
  const nextPackage = tail.search(/^    "[^"]+": \{$/m);
  const packageEnd = nextPackage === -1
    ? withRoot.length
    : packageStart + 1 + nextPackage;
  return withRoot.slice(0, packageStart)
    + replaceVersionLine(
      withRoot.slice(packageStart, packageEnd),
      6,
      current,
      next,
      'package-lock.json packages[""]',
    )
    + withRoot.slice(packageEnd);
};

const replaceChangelog = (source, current, next, date, summary) => {
  const currentNpm = current.slice(1);
  const nextNpm = next.slice(1);
  const section = /^## \[Unreleased\]\n\n([\s\S]*?)(?=^## \[\d+\.\d+\.\d+\])/m.exec(source);
  if (!section) {
    fail('CHANGELOG.md must contain Unreleased before the latest release');
  }
  const body = section[1].trim();
  if (!/^### (Added|Changed|Deprecated|Removed|Fixed|Security)$/m.test(body)) {
    fail('CHANGELOG.md Unreleased section has no release entries');
  }
  const released = '## [Unreleased]\n\n'
    + '## [' + nextNpm + '] — ' + date + '\n\n'
    + summary + '\n\n'
    + body + '\n\n';
  let updated = source.replace(section[0], released);
  const oldLink = '[Unreleased]: https://github.com/wilsonkichoi/sekai-kb/compare/'
    + 'sekai-kb-' + current + '...HEAD';
  const newLinks = '[Unreleased]: https://github.com/wilsonkichoi/sekai-kb/compare/'
    + 'sekai-kb-' + next + '...HEAD\n'
    + '[' + nextNpm + ']: https://github.com/wilsonkichoi/sekai-kb/releases/tag/'
    + 'sekai-kb-' + next;
  if (!updated.includes(oldLink)) {
    fail('CHANGELOG.md is missing the expected Unreleased comparison from ' + currentNpm);
  }
  return updated.replace(oldLink, newLinks);
};

const writeAtomically = (files) => {
  const pending = files.map(({ path, content }) => ({
    path,
    temp: path + '.' + process.pid + '.tmp',
    content,
  }));
  try {
    for (const file of pending) writeFileSync(file.temp, file.content);
    for (const file of pending) renameSync(file.temp, file.path);
  } finally {
    for (const file of pending) {
      if (existsSync(file.temp)) unlinkSync(file.temp);
    }
  }
};

export const prepareFrameworkRelease = (
  root,
  level,
  { date, summary, dryRun = false } = {},
) => {
  const base = resolve(root);
  if (!existsSync(resolve(base, '.sekai-template'))) {
    fail('not the Sekai framework template');
  }
  if (existsSync(resolve(base, 'VERSION'))) {
    fail('framework template must not contain VERSION');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
    fail('--date must use YYYY-MM-DD');
  }
  if (!summary || summary.includes('\n') || summary.length > 240) {
    fail('--summary must be one non-empty line of at most 240 characters');
  }
  if (runGit(base, ['status', '--porcelain'])) fail('working tree must be clean');

  const current = readFileSync(
    resolve(base, 'FRAMEWORK-VERSION'),
    'utf8',
  ).trim();
  const next = nextVersion(current, level);
  const npmCurrent = current.slice(1);
  const npmNext = next.slice(1);
  const expectedTag = 'sekai-kb-' + current;
  if (runGit(base, ['tag', '--list', expectedTag]) !== expectedTag) {
    fail('current framework tag ' + expectedTag + ' is missing locally');
  }
  if (runGit(base, ['tag', '--list', 'sekai-kb-' + next])) {
    fail('target tag sekai-kb-' + next + ' already exists');
  }

  const packagePath = resolve(base, 'package.json');
  const lockPath = resolve(base, 'package-lock.json');
  const changelogPath = resolve(base, 'CHANGELOG.md');
  const frameworkPath = resolve(base, 'FRAMEWORK-VERSION');
  const packageSource = readFileSync(packagePath, 'utf8');
  const lockSource = readFileSync(lockPath, 'utf8');
  const changelogSource = readFileSync(changelogPath, 'utf8');
  const pkg = JSON.parse(packageSource);
  const lock = JSON.parse(lockSource);
  if (pkg.version !== npmCurrent) {
    fail('package.json.version does not match FRAMEWORK-VERSION');
  }
  if (lock.version !== npmCurrent || lock.packages?.['']?.version !== npmCurrent) {
    fail('package-lock.json root versions do not match FRAMEWORK-VERSION');
  }

  const branch = 'chore/release-' + next;
  if (!dryRun && runGit(base, ['branch', '--show-current']) !== branch) {
    fail('write mode requires branch ' + branch);
  }
  const files = [
    {
      path: changelogPath,
      content: replaceChangelog(
        changelogSource,
        current,
        next,
        date,
        summary,
      ),
    },
    { path: frameworkPath, content: next + '\n' },
    {
      path: packagePath,
      content: replaceVersionLine(
        packageSource,
        2,
        npmCurrent,
        npmNext,
        'package.json',
      ),
    },
    {
      path: lockPath,
      content: replaceLockVersions(lockSource, npmCurrent, npmNext),
    },
  ];
  if (!dryRun) writeAtomically(files);
  return {
    branch,
    current,
    date,
    dryRun,
    level,
    next,
    tag: 'sekai-kb-' + next,
  };
};

const parseArgs = (args) => {
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  return {
    date: value('--date'),
    dryRun: args.includes('--dry-run'),
    level: args[0],
    summary: value('--summary'),
  };
};

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    const { level, ...options } = parseArgs(process.argv.slice(2));
    console.log(JSON.stringify(
      prepareFrameworkRelease(process.cwd(), level, options),
      null,
      2,
    ));
  } catch (error) {
    console.error('framework-release prepare FAILED: ' + error.message);
    process.exit(1);
  }
}
