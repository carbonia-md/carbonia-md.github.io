/**
 * Self-test of the test harness (workers/chat/test/d1-stub.mjs).
 *
 * The stub is identity-routed: it never parses SQL, it re-implements the rolling-window
 * semantics in JavaScript. Two things follow, and this file covers both.
 *
 *   1. A bug in the stub produces false verdicts about the worker, so the stub's own
 *      semantics need tests that do not touch the worker at all. That is the sibling
 *      convention `workers/feedback/test/d1-stub.test.mjs` already established.
 *   2. Because the stub routes by string identity, the four statements in the worker's
 *      exported `SQL` are never executed by anything under `npm run test:workers`. A
 *      typo in the SQL, or a drift between the ON CONFLICT target and the shipped
 *      primary key, would reach the deployed worker with a green suite. So the second
 *      half of this file runs the REAL statements against a real SQLite database built
 *      from the shipped `migrations/0001_init.sql`, and asserts the stub agrees with it
 *      operation for operation.
 *
 * `node:sqlite` is a core module, unflagged since Node 22.13.0; package.json's engines
 * floor is what keeps that true for every supported runtime.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { COUNT, PRUNE, RECORD, RELEASE, createD1Stub } from './d1-stub.mjs';

const NOW = 1_700_000_000;
const WINDOW = 3600;
const IP_HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

/* -- Part 1: the stub's own semantics ---------------------------------------
 *
 * Placeholder statement text, exactly as the feedback sibling does: part 1 is about the
 * stub's behavior, and using the real SQL here would hide a routing bug behind a value
 * that happens to be correct.
 */

const FAKE_SQL = {
  RATE_LIMIT_PRUNE: '<<rate limit prune statement>>',
  RATE_LIMIT_RECORD: '<<rate limit record statement>>',
  RATE_LIMIT_COUNT: '<<rate limit count statement>>',
  RATE_LIMIT_RELEASE: '<<rate limit release statement>>',
};

/** The three statements every request issues, in the worker's order. */
async function submit(stub, { ipHash = IP_HASH, now = NOW, window = WINDOW } = {}) {
  await stub.prepare(FAKE_SQL.RATE_LIMIT_PRUNE).bind(ipHash, now - window).run();
  await stub.prepare(FAKE_SQL.RATE_LIMIT_RECORD).bind(ipHash, now).run();
  return stub.prepare(FAKE_SQL.RATE_LIMIT_COUNT).bind(ipHash).first();
}

/** The fourth, issued only by a request that is being refused. */
function release(stub, { ipHash = IP_HASH, now = NOW } = {}) {
  return stub.prepare(FAKE_SQL.RATE_LIMIT_RELEASE).bind(ipHash, now).run();
}

test('harness: a first submission totals 1 and reports its own second as oldest', async () => {
  const stub = createD1Stub(FAKE_SQL);
  assert.deepEqual(await submit(stub), { total: 1, oldest: NOW });
});

test('harness: submissions in the same second collapse into one row and raise the count', async () => {
  const stub = createD1Stub(FAKE_SQL);
  await submit(stub);
  assert.deepEqual(await submit(stub), { total: 2, oldest: NOW });
  assert.equal(stub.buckets.get(IP_HASH).size, 1, 'one second is one row');
});

test('harness: submissions in different seconds accumulate and keep the earliest as oldest', async () => {
  const stub = createD1Stub(FAKE_SQL);
  await submit(stub);
  await submit(stub, { now: NOW + 5 });
  assert.deepEqual(await submit(stub, { now: NOW + 9 }), { total: 3, oldest: NOW });
  assert.equal(stub.buckets.get(IP_HASH).size, 3);
});

test('harness: the window rolls -- a second at or before the floor is pruned, later ones survive', async () => {
  const stub = createD1Stub(FAKE_SQL);
  stub.seed(IP_HASH, { window_start: NOW, count: 1 }, { window_start: NOW + 10, count: 1 });

  // At NOW + WINDOW the floor is exactly NOW, so only the NOW bucket is pruned.
  const usage = await submit(stub, { now: NOW + WINDOW });
  assert.deepEqual(usage, { total: 2, oldest: NOW + 10 }, 'the NOW + 10 second is still inside');
});

test('harness: a whole window of silence prunes everything and starts a fresh count', async () => {
  const stub = createD1Stub(FAKE_SQL);
  stub.seed(IP_HASH, { window_start: NOW, count: 99 });
  const usage = await submit(stub, { now: NOW + WINDOW + 1 });
  assert.deepEqual(usage, { total: 1, oldest: NOW + WINDOW + 1 });
});

test('harness: a release gives back exactly the slot its own second took', async () => {
  const stub = createD1Stub(FAKE_SQL);
  await submit(stub, { now: NOW - 100 });
  assert.deepEqual(await submit(stub), { total: 2, oldest: NOW - 100 });

  await release(stub);
  assert.deepEqual(stub.usage(IP_HASH), { total: 1, oldest: NOW - 100 });
});

test('harness: a release never drives a count below zero and tolerates a missing row', async () => {
  const stub = createD1Stub(FAKE_SQL);
  await submit(stub);
  await release(stub);
  await release(stub);
  assert.equal(stub.buckets.get(IP_HASH).get(NOW), 0, 'count must floor at zero');

  await release(stub, { now: NOW + 5000 });
  assert.equal(stub.buckets.get(IP_HASH).has(NOW + 5000), false, 'no row must be created');
});

test('harness: the next prune deletes a second a release emptied, inside the window or not', async () => {
  const stub = createD1Stub(FAKE_SQL);
  await submit(stub);
  await release(stub);

  // NOW is nowhere near the floor, so only the count <= 0 half of the DELETE can remove
  // it. A surviving empty row would still answer MIN(window_start).
  await stub.prepare(FAKE_SQL.RATE_LIMIT_PRUNE).bind(IP_HASH, NOW - WINDOW).run();
  assert.deepEqual(stub.usage(IP_HASH), { total: null, oldest: null });
});

test('harness: an empty table aggregates to SQL NULLs, not zeros', async () => {
  const stub = createD1Stub(FAKE_SQL);
  assert.deepEqual(await stub.prepare(FAKE_SQL.RATE_LIMIT_COUNT).bind(IP_HASH).first(), {
    total: null,
    oldest: null,
  });
});

test('harness: rows are isolated per ip hash, and pruning one address spares another', async () => {
  const stub = createD1Stub(FAKE_SQL);
  await submit(stub, { ipHash: OTHER_HASH });
  await submit(stub, { ipHash: IP_HASH, now: NOW + WINDOW + 1 });
  assert.deepEqual(stub.usage(OTHER_HASH), { total: 1, oldest: NOW });
});

test('harness: all() is implemented and returns the documented result envelope', async () => {
  const stub = createD1Stub(FAKE_SQL);
  await stub.prepare(FAKE_SQL.RATE_LIMIT_RECORD).bind(IP_HASH, NOW).run();
  const result = await stub.prepare(FAKE_SQL.RATE_LIMIT_COUNT).bind(IP_HASH).all();
  assert.equal(result.success, true);
  assert.deepEqual(result.results, [{ total: 1, oldest: NOW }]);
});

test('harness: statements are routed by identity, and an unknown statement throws', () => {
  const stub = createD1Stub(FAKE_SQL);
  assert.throws(() => stub.prepare('SELECT 1'), /unknown statement/);
});

test('harness: a wrong bind-argument count throws instead of silently storing a bad row', async () => {
  const stub = createD1Stub(FAKE_SQL);
  await assert.rejects(
    () => stub.prepare(FAKE_SQL.RATE_LIMIT_RECORD).bind(IP_HASH).run(),
    /expected 2 args/,
  );
  await assert.rejects(
    () => stub.prepare(FAKE_SQL.RATE_LIMIT_COUNT).bind(IP_HASH, NOW).first(),
    /expected 1 args/,
  );
});

test('harness: touched reports any D1 contact, prepare included', () => {
  const stub = createD1Stub(FAKE_SQL);
  assert.equal(stub.touched, false);
  stub.prepare(FAKE_SQL.RATE_LIMIT_COUNT);
  assert.equal(stub.touched, true);
  assert.equal(stub.calls.length, 0);
});

test('harness: callsOf reports each routed statement kind', async () => {
  const stub = createD1Stub(FAKE_SQL);
  await submit(stub);
  await release(stub);
  assert.equal(stub.callsOf(PRUNE).length, 1);
  assert.equal(stub.callsOf(RECORD).length, 1);
  assert.equal(stub.callsOf(COUNT).length, 1);
  assert.equal(stub.callsOf(RELEASE).length, 1);
});

test('harness: createD1Stub rejects an SQL object it cannot route by identity', () => {
  assert.throws(() => createD1Stub(null), TypeError);
  assert.throws(() => createD1Stub({ RATE_LIMIT_PRUNE: 'x' }), TypeError);
  assert.throws(
    () =>
      createD1Stub({
        RATE_LIMIT_PRUNE: 'same',
        RATE_LIMIT_RECORD: 'same',
        RATE_LIMIT_COUNT: 'c',
        RATE_LIMIT_RELEASE: 'r',
      }),
    TypeError,
  );
});

/* -- Part 2: the shipped SQL against the shipped schema ----------------------
 *
 * Everything below executes the worker's real statements on a real SQLite database
 * created from migrations/0001_init.sql, then replays the identical operations through
 * the stub and requires the same answer. This is what proves the ON CONFLICT target
 * matches the migration's PRIMARY KEY, and that the stub is a faithful fake rather than
 * a second, divergent implementation.
 */

// Imported from src/sql.mjs, not src/index.mjs: the worker loads the gitignored
// vectors.json at module scope, and installing one here would race chat.test.mjs under
// the parallel node:test runner. index.mjs re-exports this same object.
const { SQL } = await import('../src/sql.mjs');
const MIGRATION = readFileSync(
  fileURLToPath(new URL('../migrations/0001_init.sql', import.meta.url)),
  'utf8',
);

function createSqlite() {
  const db = new DatabaseSync(':memory:');
  db.exec(MIGRATION);
  return {
    prune: (ipHash, floor) => db.prepare(SQL.RATE_LIMIT_PRUNE).run(ipHash, floor),
    record: (ipHash, now) => db.prepare(SQL.RATE_LIMIT_RECORD).run(ipHash, now),
    release: (ipHash, now) => db.prepare(SQL.RATE_LIMIT_RELEASE).run(ipHash, now),
    count: (ipHash) => {
      const row = db.prepare(SQL.RATE_LIMIT_COUNT).get(ipHash);
      // node:sqlite omits a NULL aggregate rather than returning it as a key.
      return { total: row.total ?? null, oldest: row.oldest ?? null };
    },
    rows: (ipHash) =>
      db
        .prepare('SELECT window_start, count FROM submission_window WHERE ip_hash = ? ORDER BY window_start')
        .all(ipHash)
        // node:sqlite returns null-prototype rows, which deepEqual refuses to match
        // against object literals.
        .map((row) => ({ window_start: row.window_start, count: row.count })),
    close: () => db.close(),
  };
}

/**
 * Replay one operation list against both backends and require identical COUNT answers
 * after every step. Ops mirror the worker's own call shapes.
 */
async function assertAgreement(ops, { ipHash = IP_HASH } = {}) {
  const stub = createD1Stub(SQL);
  const real = createSqlite();
  try {
    for (const [index, op] of ops.entries()) {
      if (op.kind === 'prune') {
        await stub.prepare(SQL.RATE_LIMIT_PRUNE).bind(ipHash, op.floor).run();
        real.prune(ipHash, op.floor);
      } else if (op.kind === 'record') {
        await stub.prepare(SQL.RATE_LIMIT_RECORD).bind(ipHash, op.now).run();
        real.record(ipHash, op.now);
      } else if (op.kind === 'release') {
        await stub.prepare(SQL.RATE_LIMIT_RELEASE).bind(ipHash, op.now).run();
        real.release(ipHash, op.now);
      } else {
        throw new Error(`unknown op: ${op.kind}`);
      }

      const fromStub = await stub.prepare(SQL.RATE_LIMIT_COUNT).bind(ipHash).first();
      assert.deepEqual(
        fromStub,
        real.count(ipHash),
        `stub and sqlite disagree after op ${index} (${op.kind})`,
      );
    }
    return real.rows(ipHash);
  } finally {
    real.close();
  }
}

/** The exact statement sequence applyRateLimit issues for one accepted request. */
function accepted(now, window = WINDOW) {
  return [
    { kind: 'prune', floor: now - window },
    { kind: 'record', now },
  ];
}

test('sql: the migration creates the table every shipped statement binds against', () => {
  const real = createSqlite();
  try {
    assert.deepEqual(real.count(IP_HASH), { total: null, oldest: null });
  } finally {
    real.close();
  }
});

test('sql: the ON CONFLICT target matches the migration primary key, so a repeat second upserts', async () => {
  const rows = await assertAgreement([...accepted(NOW), ...accepted(NOW), ...accepted(NOW)]);
  assert.deepEqual(rows, [{ window_start: NOW, count: 3 }], 'one second stays one row');
});

test('sql: distinct seconds are distinct rows and the aggregate spans them', async () => {
  const rows = await assertAgreement([
    ...accepted(NOW),
    ...accepted(NOW + 5),
    ...accepted(NOW + 9),
  ]);
  assert.equal(rows.length, 3);
});

test('sql: the DELETE floor is inclusive -- the second exactly one window back is pruned', async () => {
  const rows = await assertAgreement([
    ...accepted(NOW),
    ...accepted(NOW + 10),
    ...accepted(NOW + WINDOW),
  ]);
  assert.deepEqual(
    rows.map((row) => row.window_start),
    [NOW + 10, NOW + WINDOW],
    'the NOW second is at the floor and goes; NOW + 10 is inside and stays',
  );
});

test('sql: a full window of silence empties the table before the new row lands', async () => {
  const rows = await assertAgreement([...accepted(NOW), ...accepted(NOW + WINDOW + 1)]);
  assert.deepEqual(rows, [{ window_start: NOW + WINDOW + 1, count: 1 }]);
});

test('sql: the refusal release decrements only its own second and floors at zero', async () => {
  const rows = await assertAgreement([
    ...accepted(NOW - 100),
    ...accepted(NOW),
    { kind: 'release', now: NOW },
    { kind: 'release', now: NOW },
  ]);
  assert.deepEqual(rows, [
    { window_start: NOW - 100, count: 1 },
    { window_start: NOW, count: 0 },
  ]);
});

test('sql: a release against a second with no row changes nothing', async () => {
  const rows = await assertAgreement([...accepted(NOW), { kind: 'release', now: NOW + 5000 }]);
  assert.deepEqual(rows, [{ window_start: NOW, count: 1 }]);
});

test('sql: the count <= 0 half of the DELETE reclaims a row a release emptied', async () => {
  const rows = await assertAgreement([
    ...accepted(NOW),
    { kind: 'release', now: NOW },
    // The floor is nowhere near NOW, so only `count <= 0` can remove this row. A
    // surviving empty row would still answer MIN(window_start) and inflate Retry-After.
    { kind: 'prune', floor: NOW - WINDOW },
  ]);
  assert.deepEqual(rows, []);
});

test('sql: rows are scoped by ip hash -- pruning one address leaves the other intact', () => {
  const real = createSqlite();
  try {
    real.record(OTHER_HASH, NOW);
    real.record(IP_HASH, NOW);
    real.prune(IP_HASH, NOW + WINDOW);
    assert.deepEqual(real.count(IP_HASH), { total: null, oldest: null });
    assert.deepEqual(real.count(OTHER_HASH), { total: 1, oldest: NOW });
  } finally {
    real.close();
  }
});

test('sql: the aggregate is NULL, not 0, on an empty table -- the worker coerces it', () => {
  const real = createSqlite();
  try {
    const usage = real.count(IP_HASH);
    assert.equal(usage.total, null);
    assert.equal(Number(usage.total ?? 0), 0, 'the worker reads this as zero usage');
  } finally {
    real.close();
  }
});
