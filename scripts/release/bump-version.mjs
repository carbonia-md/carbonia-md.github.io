#!/usr/bin/env node

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const LEVELS = new Set(['patch', 'minor', 'major']);
const VERSION_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const replaceVersionLine = (content, indent, current, next, label) => {
  const pattern = new RegExp(`^ {${indent}}"version": "${escapeRegex(current)}"(,?)$`, 'gm');
  const matches = [...content.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`${label} must contain exactly one ${indent}-space-indented version field`);
  }
  return content.replace(pattern, `${' '.repeat(indent)}"version": "${next}"$1`);
};

const replaceLockVersions = (content, current, next) => {
  const withRoot = replaceVersionLine(content, 2, current, next, 'package-lock.json root');
  const emptyPackageStart = withRoot.search(/^    "": \{$/m);
  if (emptyPackageStart === -1) throw new Error('package-lock.json must contain packages[""]');
  const afterEmptyPackage = withRoot.slice(emptyPackageStart + 1);
  const nextPackageOffset = afterEmptyPackage.search(/^    "[^"]+": \{$/m);
  const emptyPackageEnd = nextPackageOffset === -1
    ? withRoot.length
    : emptyPackageStart + 1 + nextPackageOffset;
  const before = withRoot.slice(0, emptyPackageStart);
  const emptyPackage = withRoot.slice(emptyPackageStart, emptyPackageEnd);
  const after = withRoot.slice(emptyPackageEnd);
  return before + replaceVersionLine(
    emptyPackage,
    6,
    current,
    next,
    'package-lock.json packages[""]',
  ) + after;
};

const parseVersion = (value, label) => {
  const match = VERSION_RE.exec(value.trim());
  if (!match) throw new Error(`${label} must contain one v-prefixed semantic version`);
  return match.slice(1).map(Number);
};

export const nextVersion = (current, level) => {
  if (!LEVELS.has(level)) throw new Error('release level must be patch, minor, or major');
  let [major, minor, patch] = parseVersion(current, 'VERSION');
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
  return `v${major}.${minor}.${patch}`;
};

const writeAtomically = (files) => {
  const pending = files.map(({ path, content }) => ({
    path,
    temp: `${path}.${process.pid}.tmp`,
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

export const bumpAdopterVersion = (root, level, { dryRun = false } = {}) => {
  const base = resolve(root);
  if (existsSync(resolve(base, '.sekai-template'))) {
    throw new Error('this is the Sekai framework template; bump FRAMEWORK-VERSION through the framework release flow');
  }

  const versionPath = resolve(base, 'VERSION');
  const packagePath = resolve(base, 'package.json');
  const lockPath = resolve(base, 'package-lock.json');
  const current = readFileSync(versionPath, 'utf8').trim();
  const packageSource = readFileSync(packagePath, 'utf8');
  const lockSource = readFileSync(lockPath, 'utf8');
  parseVersion(current, 'VERSION');

  const pkg = JSON.parse(packageSource);
  const lock = JSON.parse(lockSource);
  const npmCurrent = current.slice(1);
  if (pkg.version !== npmCurrent) throw new Error('package.json.version does not match VERSION');
  if (lock.version !== npmCurrent || lock.packages?.['']?.version !== npmCurrent) {
    throw new Error('package-lock.json root versions do not match VERSION');
  }

  const next = nextVersion(current, level);
  const npmNext = next.slice(1);

  if (!dryRun) {
    writeAtomically([
      { path: versionPath, content: `${next}\n` },
      { path: packagePath, content: replaceVersionLine(packageSource, 2, npmCurrent, npmNext, 'package.json') },
      { path: lockPath, content: replaceLockVersions(lockSource, npmCurrent, npmNext) },
    ]);
  }
  return { current, next, level };
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const levels = args.filter((arg) => arg !== '--dry-run');
  if (levels.length !== 1) {
    console.error('usage: npm run release:bump -- <patch|minor|major> [--dry-run]');
    process.exit(2);
  }
  try {
    const result = bumpAdopterVersion(process.cwd(), levels[0], { dryRun });
    console.log(`${dryRun ? 'Would update' : 'Updated'} adopter VERSION ${result.current} -> ${result.next} (${result.level})`);
  } catch (error) {
    console.error(`release:bump FAILED: ${error.message}`);
    process.exit(1);
  }
}
