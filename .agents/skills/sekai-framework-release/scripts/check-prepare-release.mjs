#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prepareFrameworkRelease } from './prepare-release.mjs';

const root = mkdtempSync(join(tmpdir(), 'sekai-framework-release-'));
const git = (...args) => execFileSync('git', args, {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

git('init', '-b', 'main');
git('config', 'user.email', 'test@example.invalid');
git('config', 'user.name', 'Release Test');
writeFileSync(join(root, '.sekai-template'), 'template\n');
writeFileSync(join(root, 'FRAMEWORK-VERSION'), 'v1.2.3\n');
writeFileSync(
  join(root, 'package.json'),
  '{\n  "name": "sekai-kb",\n  "version": "1.2.3"\n}\n',
);
writeFileSync(
  join(root, 'package-lock.json'),
  '{\n'
    + '  "name": "sekai-kb",\n'
    + '  "version": "1.2.3",\n'
    + '  "lockfileVersion": 3,\n'
    + '  "packages": {\n'
    + '    "": {\n'
    + '      "name": "sekai-kb",\n'
    + '      "version": "1.2.3"\n'
    + '    }\n'
    + '  }\n'
    + '}\n',
);
writeFileSync(
  join(root, 'CHANGELOG.md'),
  [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '### Fixed',
    '',
    '- Corrected a release fixture.',
    '',
    '## [1.2.3] — 2026-01-01',
    '',
    'Previous release.',
    '',
    '[Unreleased]: https://github.com/wilsonkichoi/sekai-kb/compare/sekai-kb-v1.2.3...HEAD',
    '[1.2.3]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.2.3',
    '',
  ].join('\n'),
);
git('add', '.');
git('commit', '-m', 'fixture');
git('tag', 'sekai-kb-v1.2.3');

const dryRun = prepareFrameworkRelease(root, 'patch', {
  date: '2026-02-03',
  dryRun: true,
  summary: 'Corrects the release fixture.',
});
assert.equal(dryRun.next, 'v1.2.4');
assert.equal(git('status', '--porcelain'), '');

git('switch', '-c', 'chore/release-v1.2.4');
const result = prepareFrameworkRelease(root, 'patch', {
  date: '2026-02-03',
  summary: 'Corrects the release fixture.',
});
assert.equal(result.tag, 'sekai-kb-v1.2.4');
assert.equal(
  readFileSync(join(root, 'FRAMEWORK-VERSION'), 'utf8'),
  'v1.2.4\n',
);
assert.match(
  readFileSync(join(root, 'package.json'), 'utf8'),
  /"version": "1\.2\.4"/,
);
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
assert.equal(lock.version, '1.2.4');
assert.equal(lock.packages[''].version, '1.2.4');
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
assert.match(
  changelog,
  /## \[Unreleased\]\n\n## \[1\.2\.4\] — 2026-02-03/,
);
assert.match(changelog, /\[Unreleased\]: .*sekai-kb-v1\.2\.4\.\.\.HEAD/);
assert.match(changelog, /\[1\.2\.4\]: .*sekai-kb-v1\.2\.4/);
assert.deepEqual(
  git('diff', '--name-only').trim().split('\n').sort(),
  ['CHANGELOG.md', 'FRAMEWORK-VERSION', 'package-lock.json', 'package.json'],
);

console.log('sekai-framework-release prepare self-test OK');
