#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capturePackageState, reconcilePackageState } from './package-state.mjs';

const run = (cwd, args, options = {}) => execFileSync(args[0], args.slice(1), {
  cwd,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  ...options,
});

const git = (cwd, ...args) => run(cwd, ['git', ...args]);
const configure = (cwd) => {
  git(cwd, 'config', 'user.email', 'package-state@example.invalid');
  git(cwd, 'config', 'user.name', 'Package State Self-test');
  git(cwd, 'config', 'commit.gpgsign', 'false');
  git(cwd, 'config', 'core.hooksPath', join(cwd, '.git', 'no-hooks'));
};

const writeManifest = (root, frameworkVersion, scriptName) => {
  const pkg = {
    name: 'sekai-kb',
    version: frameworkVersion,
    private: true,
    description: 'Framework package',
    scripts: { [scriptName]: 'true' },
  };
  const lock = {
    name: pkg.name,
    version: pkg.version,
    lockfileVersion: 3,
    packages: { '': { name: pkg.name, version: pkg.version } },
  };
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileSync(join(root, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
};

const temp = mkdtempSync(join(tmpdir(), 'sekai-package-state-'));
const framework = join(temp, 'framework');
const adopter = join(temp, 'adopter');
run(temp, ['git', 'init', '-q', framework]);
configure(framework);
writeFileSync(join(framework, '.sekai-template'), 'fixture\n');
writeManifest(framework, '1.0.8', 'old-framework-script');
git(framework, 'add', '-A');
git(framework, 'commit', '-q', '-m', 'framework v1');
git(framework, 'tag', 'fw-v1');
writeManifest(framework, '1.0.9', 'new-framework-script');
git(framework, 'add', '-A');
git(framework, 'commit', '-q', '-m', 'framework v2');
git(framework, 'tag', 'fw-v2');

run(temp, ['git', 'clone', '-q', framework, adopter]);
configure(adopter);
git(adopter, 'checkout', '-q', '-B', 'main', 'fw-v1');
git(adopter, 'rm', '-q', '.sekai-template');
writeFileSync(join(adopter, 'VERSION'), 'v2.3.4\n');
const adopterPkg = JSON.parse(readFileSync(join(adopter, 'package.json')));
adopterPkg.name = 'example-adopter';
delete adopterPkg.version;
adopterPkg.description = 'Adopter package';
writeFileSync(join(adopter, 'package.json'), `${JSON.stringify(adopterPkg, null, 2)}\n`);
const adopterLock = JSON.parse(readFileSync(join(adopter, 'package-lock.json')));
adopterLock.name = adopterPkg.name;
delete adopterLock.version;
adopterLock.packages[''].name = adopterPkg.name;
delete adopterLock.packages[''].version;
writeFileSync(join(adopter, 'package-lock.json'), `${JSON.stringify(adopterLock, null, 2)}\n`);
git(adopter, 'add', '-A');
git(adopter, 'commit', '-q', '-m', 'adopt framework');

const statePath = capturePackageState(adopter);
let mergeFailed = false;
try {
  git(adopter, 'merge', '--no-edit', 'fw-v2');
} catch {
  mergeFailed = true;
}
assert.equal(mergeFailed, true, 'fixture must produce a package manifest conflict');
const result = reconcilePackageState(adopter, statePath);
assert.equal(result.amended, false);
git(adopter, 'commit', '-q', '--no-edit');

const pkg = JSON.parse(readFileSync(join(adopter, 'package.json')));
const lock = JSON.parse(readFileSync(join(adopter, 'package-lock.json')));
assert.equal(pkg.name, 'example-adopter');
assert.equal(pkg.version, '2.3.4');
assert.equal(pkg.description, 'Adopter package');
assert.equal(pkg.scripts['new-framework-script'], 'true');
assert.equal(pkg.scripts['old-framework-script'], undefined);
assert.equal(lock.name, pkg.name);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[''].name, pkg.name);
assert.equal(lock.packages[''].version, pkg.version);
assert.equal(readFileSync(join(adopter, 'VERSION'), 'utf8'), 'v2.3.4\n');

console.log('upgrade package-state self-test OK');
