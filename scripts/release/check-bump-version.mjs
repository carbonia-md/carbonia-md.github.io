#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bumpAdopterVersion, nextVersion } from './bump-version.mjs';

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'sekai-release-bump-'));
  writeFileSync(join(root, 'VERSION'), 'v1.2.3\n');
  writeFileSync(join(root, 'FRAMEWORK-VERSION'), 'v4.5.6\n');
  writeFileSync(
    join(root, 'package.json'),
    '{\n  "name": "fixture",\n  "version": "1.2.3",\n  "description": "preserve \\u2014 bytes",\n  "private": true\n}\n',
  );
  writeFileSync(
    join(root, 'package-lock.json'),
    '{\n  "name": "fixture",\n  "version": "1.2.3",\n  "lockfileVersion": 3,\n  "packages": {\n    "": {\n      "name": "fixture",\n      "version": "1.2.3"\n    }\n  }\n}\n',
  );
  return root;
};

assert.equal(nextVersion('v1.2.3', 'patch'), 'v1.2.4');
assert.equal(nextVersion('v1.2.3', 'minor'), 'v1.3.0');
assert.equal(nextVersion('v1.2.3', 'major'), 'v2.0.0');
assert.throws(() => nextVersion('v1.2.3', 'latest'), /patch, minor, or major/);

for (const [level, expected] of [['patch', 'v1.2.4'], ['minor', 'v1.3.0'], ['major', 'v2.0.0']]) {
  const root = fixture();
  const packageBefore = readFileSync(join(root, 'package.json'), 'utf8');
  const lockBefore = readFileSync(join(root, 'package-lock.json'), 'utf8');
  const result = bumpAdopterVersion(root, level);
  assert.equal(result.next, expected);
  assert.equal(readFileSync(join(root, 'VERSION'), 'utf8'), `${expected}\n`);
  const packageAfter = readFileSync(join(root, 'package.json'), 'utf8');
  const lockAfter = readFileSync(join(root, 'package-lock.json'), 'utf8');
  assert.equal(packageAfter, packageBefore.replace('"version": "1.2.3"', `"version": "${expected.slice(1)}"`));
  assert.equal(
    lockAfter,
    lockBefore.replaceAll('"version": "1.2.3"', `"version": "${expected.slice(1)}"`),
  );
  assert.equal(JSON.parse(packageAfter).version, expected.slice(1));
  const lock = JSON.parse(lockAfter);
  assert.equal(lock.version, expected.slice(1));
  assert.equal(lock.packages[''].version, expected.slice(1));
  assert.equal(readFileSync(join(root, 'FRAMEWORK-VERSION'), 'utf8'), 'v4.5.6\n');
}

const dryRunRoot = fixture();
bumpAdopterVersion(dryRunRoot, 'patch', { dryRun: true });
assert.equal(readFileSync(join(dryRunRoot, 'VERSION'), 'utf8'), 'v1.2.3\n');

const templateRoot = fixture();
writeFileSync(join(templateRoot, '.sekai-template'), 'fixture\n');
assert.throws(() => bumpAdopterVersion(templateRoot, 'patch'), /Sekai framework template/);

const driftRoot = fixture();
writeFileSync(join(driftRoot, 'package.json'), '{\n  "name": "fixture",\n  "version": "9.9.9",\n  "private": true\n}\n');
assert.throws(() => bumpAdopterVersion(driftRoot, 'patch'), /package.json.version does not match VERSION/);

console.log('release:bump self-test OK');
