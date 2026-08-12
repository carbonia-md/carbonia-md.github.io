#!/usr/bin/env node
// Verify that every check-rules GitHub Action reference matches the dev-plugin
// repository and release declared at the top of .agent-toolkit/dev.md.
// Adopted repositories without dev-plugin state skip cleanly.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CONFIG = join(ROOT, '.agent-toolkit/dev.md');
const WORKFLOWS = join(ROOT, '.github/workflows');

function fail(message) {
  console.error(`dev-plugin action check FAILED: ${message}`);
  process.exit(1);
}

if (!existsSync(CONFIG)) {
  console.log('OK: dev-plugin action check skipped; no .agent-toolkit/dev.md');
  process.exit(0);
}

const config = readFileSync(CONFIG, 'utf8');
const frontmatterEnd = config.indexOf('\n---', 4);
if (!config.startsWith('---\n') || frontmatterEnd === -1) {
  fail('.agent-toolkit/dev.md has no complete YAML frontmatter block');
}
const frontmatter = config.slice(4, frontmatterEnd);

function declaredValue(key) {
  const matches = [...frontmatter.matchAll(new RegExp(`^${key}:\\s*([^#\\n]+?)\\s*$`, 'gm'))];
  if (matches.length !== 1) {
    fail(`.agent-toolkit/dev.md must declare ${key} exactly once`);
  }
  return matches[0][1].trim().replace(/^['"]|['"]$/g, '');
}

const repository = declaredValue('dev_plugin_repository');
const release = declaredValue('dev_plugin_release');

if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  fail(`dev_plugin_repository is not an owner/repository pair: ${repository}`);
}
if (!/^dev-v\d+\.\d+\.\d+$/.test(release)) {
  fail(`dev_plugin_release is not a dev-vX.Y.Z release: ${release}`);
}
if (!existsSync(WORKFLOWS)) {
  fail('.github/workflows is missing');
}

function workflowFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return workflowFiles(path);
    return /\.ya?ml$/.test(entry.name) ? [path] : [];
  });
}

const expected = `${repository}/.github/actions/check-rules@${release}`;
const references = [];
const usesPattern = /^\s*uses:\s*(.*?)\s*$/gm;

for (const file of workflowFiles(WORKFLOWS)) {
  const source = readFileSync(file, 'utf8');
  let match;
  while ((match = usesPattern.exec(source)) !== null) {
    const value = match[1]
      .replace(/\s+#.*$/, '')
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (!value.includes('/.github/actions/check-rules')) continue;
    references.push({
      file: relative(ROOT, file),
      line: source.slice(0, match.index).split('\n').length,
      value,
    });
  }
}

if (references.length === 0) {
  fail('no check-rules action reference was found under .github/workflows');
}

const mismatches = references.filter(({ value }) => value !== expected);
if (mismatches.length > 0) {
  const details = mismatches
    .map(({ file, line, value }) => `  ${file}:${line}: ${value}`)
    .join('\n');
  fail(`expected ${expected}; found:\n${details}`);
}

console.log(`OK: ${references.length} check-rules action references match ${expected}`);
