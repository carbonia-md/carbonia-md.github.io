#!/usr/bin/env node
// run-worker-tests.mjs -- the `npm run test:workers` entry point.
//
// Runs every Cloudflare Worker unit suite (workers/**/*.test.mjs) under the
// node:test runner. Discovery is by walking the tree, so a worker added in a later
// phase is gated the moment its first *.test.mjs lands -- no edit here and none in
// the CI workflow.
//
// Why this exists instead of `node --test <path>` in package.json: neither native
// form is safe as a CI gate.
//
//   - `node --test workers/` resolves the directory as a module and fails with
//     "Cannot find module" (verified on Node 22 and 24). Loud, but broken.
//   - `node --test "workers/**/*.test.mjs"` runs correctly, but a glob that matches
//     NOTHING exits 0. A refactor that moves or renames the suites would leave a
//     green `test` job running zero tests, which is the exact failure the DoD-guard
//     doctrine exists to stop: a guard nothing forces you to run is not a guard.
//
// So: zero discovered files in a workers/ tree that exists is a hard failure. An
// absent workers/ tree is a skip, matching the scan-root convention of the
// genericity gates -- an adopter who deletes a worker they do not use keeps a green
// CI, while anyone who keeps the tree cannot lose its coverage silently.
//
// This file lives under scripts/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.
//
// Usage: node scripts/ci/run-worker-tests.mjs   (run from anywhere)

import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WORKERS_DIR = join(ROOT, 'workers');
const TEST_SUFFIX = '.test.mjs';

if (!existsSync(WORKERS_DIR)) {
  console.log('OK: no workers/ tree in this checkout -- nothing to test.');
  process.exit(0);
}

// `recursive: true` on readdirSync is stable from Node 20.1; it returns paths
// relative to WORKERS_DIR. Sorted so the run order is deterministic across
// platforms.
const testFiles = readdirSync(WORKERS_DIR, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(TEST_SUFFIX))
  .map((entry) => relative(ROOT, join(entry.parentPath ?? entry.path, entry.name)))
  .sort();

if (testFiles.length === 0) {
  console.error(
    `FAIL: workers/ exists but contains no *${TEST_SUFFIX} files.\n` +
      '  A worker tree with no suite is an ungated deploy target. Either add the\n' +
      '  suites back, or delete workers/ if the capability is really gone.',
  );
  process.exit(1);
}

console.log(`Running ${testFiles.length} worker test file(s):`);
for (const file of testFiles) console.log(`  ${file}`);

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: ROOT,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`FAIL: could not start the node:test runner: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
