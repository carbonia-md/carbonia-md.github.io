/**
 * Self-test of the test harness (workers/feedback/test/d1-stub.mjs).
 *
 * The D1 stub encodes the rolling-window semantics the contract documents, so a bug in
 * the stub would produce false verdicts about the worker. These tests do not touch the
 * worker at all; they keep the harness honest.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createD1Stub, INSERT_COLUMNS } from './d1-stub.mjs';

const SQL = {
  RATE_LIMIT_PRUNE: '<<rate limit prune statement>>',
  RATE_LIMIT_RECORD: '<<rate limit record statement>>',
  RATE_LIMIT_COUNT: '<<rate limit count statement>>',
  RATE_LIMIT_RELEASE: '<<rate limit release statement>>',
  INSERT_FEEDBACK: '<<insert feedback statement>>',
};

const NOW = 1_700_000_000;
const WINDOW = 3600;
const IP_HASH = 'a'.repeat(64);

/** The three statements every request issues, in the worker's order. */
async function submit(stub, { ipHash = IP_HASH, now = NOW, window = WINDOW } = {}) {
  await stub.prepare(SQL.RATE_LIMIT_PRUNE).bind(ipHash, now - window).run();
  await stub.prepare(SQL.RATE_LIMIT_RECORD).bind(ipHash, now).run();
  return stub.prepare(SQL.RATE_LIMIT_COUNT).bind(ipHash).first();
}

/** The fourth, issued only by a request that is being refused. */
function release(stub, { ipHash = IP_HASH, now = NOW } = {}) {
  return stub.prepare(SQL.RATE_LIMIT_RELEASE).bind(ipHash, now).run();
}

function insertRow(stub, overrides = {}) {
  const values = {
    id: 'id-1',
    created_at: '2026-01-01T00:00:00.000Z',
    page: '/guides/example/',
    category: 'correction',
    message: 'a message that is long enough',
    contact: null,
    user_agent: null,
    status: 'new',
    ...overrides,
  };
  return stub
    .prepare(SQL.INSERT_FEEDBACK)
    .bind(...INSERT_COLUMNS.map((column) => values[column]))
    .run();
}

test('harness: a first submission totals 1 and reports its own second as oldest', async () => {
  const stub = createD1Stub(SQL);
  assert.deepEqual(await submit(stub), { total: 1, oldest: NOW });
});

test('harness: submissions in the same second collapse into one row and raise the count', async () => {
  const stub = createD1Stub(SQL);
  await submit(stub);
  const second = await submit(stub);
  assert.deepEqual(second, { total: 2, oldest: NOW });
  assert.equal(stub.buckets.get(IP_HASH).size, 1, 'one second is one row');
});

test('harness: submissions in different seconds accumulate and keep the earliest as oldest', async () => {
  const stub = createD1Stub(SQL);
  await submit(stub);
  await submit(stub, { now: NOW + 5 });
  const third = await submit(stub, { now: NOW + 9 });
  assert.deepEqual(third, { total: 3, oldest: NOW });
  assert.equal(stub.buckets.get(IP_HASH).size, 3);
});

test('harness: the window rolls -- a second at or before the floor is pruned, later ones survive', async () => {
  const stub = createD1Stub(SQL);
  stub.seedRateLimit(
    IP_HASH,
    { window_start: NOW, count: 1 },
    { window_start: NOW + 10, count: 1 },
  );

  // At NOW + WINDOW the floor is exactly NOW, so only the NOW bucket is pruned.
  const usage = await submit(stub, { now: NOW + WINDOW });
  assert.deepEqual(usage, { total: 2, oldest: NOW + 10 }, 'the NOW + 10 second is still inside');
});

test('harness: a whole window of silence prunes everything and starts a fresh count', async () => {
  const stub = createD1Stub(SQL);
  stub.seedRateLimit(IP_HASH, { window_start: NOW, count: 99 });
  const usage = await submit(stub, { now: NOW + WINDOW + 1 });
  assert.deepEqual(usage, { total: 1, oldest: NOW + WINDOW + 1 });
});

test('harness: a release gives back exactly the slot its own second took', async () => {
  const stub = createD1Stub(SQL);
  await submit(stub, { now: NOW - 100 });
  assert.deepEqual(await submit(stub), { total: 2, oldest: NOW - 100 });

  await release(stub);
  assert.deepEqual(await stub.prepare(SQL.RATE_LIMIT_COUNT).bind(IP_HASH).first(), {
    total: 1,
    oldest: NOW - 100,
  });
});

test('harness: a release never drives a count below zero and tolerates a missing row', async () => {
  const stub = createD1Stub(SQL);
  await submit(stub);
  await release(stub);
  await release(stub);
  assert.equal(stub.buckets.get(IP_HASH).get(NOW), 0, 'count must floor at zero');

  await release(stub, { now: NOW + 5000 });
  assert.equal(stub.buckets.get(IP_HASH).has(NOW + 5000), false, 'no row must be created');
});

test('harness: the next prune deletes a second a release emptied, inside the window or not', async () => {
  const stub = createD1Stub(SQL);
  await submit(stub);
  await release(stub);

  // NOW is nowhere near the floor, so only the count <= 0 half of the DELETE can
  // remove it. A surviving empty row would still answer MIN(window_start).
  await stub.prepare(SQL.RATE_LIMIT_PRUNE).bind(IP_HASH, NOW - WINDOW).run();
  assert.deepEqual(await stub.prepare(SQL.RATE_LIMIT_COUNT).bind(IP_HASH).first(), {
    total: null,
    oldest: null,
  });
});

test('harness: an empty table aggregates to SQL NULLs, not zeros', async () => {
  const stub = createD1Stub(SQL);
  const usage = await stub.prepare(SQL.RATE_LIMIT_COUNT).bind(IP_HASH).first();
  assert.deepEqual(usage, { total: null, oldest: null });
});

test('harness: rate-limit rows are isolated per ip hash', async () => {
  const stub = createD1Stub(SQL);
  await submit(stub, { ipHash: 'a'.repeat(64) });
  await submit(stub, { ipHash: 'a'.repeat(64) });
  const other = await submit(stub, { ipHash: 'b'.repeat(64) });
  assert.deepEqual(other, { total: 1, oldest: NOW });
});

test('harness: pruning one address does not touch another', async () => {
  const stub = createD1Stub(SQL);
  await submit(stub, { ipHash: 'b'.repeat(64) });
  await submit(stub, { ipHash: 'a'.repeat(64), now: NOW + WINDOW + 1 });
  assert.deepEqual(stub.usage('b'.repeat(64)), { total: 1, oldest: NOW });
});

test('harness: an insert records its bound columns and reports one changed row', async () => {
  const stub = createD1Stub(SQL);
  const result = await insertRow(stub, { contact: 'reader@example.invalid' });
  assert.equal(result.success, true);
  assert.equal(result.meta.changes, 1);
  assert.equal(stub.rows.length, 1);
  assert.equal(stub.rows[0].contact, 'reader@example.invalid');
  assert.equal(stub.rows[0].status, 'new');
});

test('harness: all() is implemented and returns the documented result envelope', async () => {
  const stub = createD1Stub(SQL);
  await stub.prepare(SQL.RATE_LIMIT_RECORD).bind(IP_HASH, NOW).run();
  const result = await stub.prepare(SQL.RATE_LIMIT_COUNT).bind(IP_HASH).all();
  assert.equal(result.success, true);
  assert.deepEqual(result.results, [{ total: 1, oldest: NOW }]);
});

test('harness: statements are routed by identity, and an unknown statement throws', () => {
  const stub = createD1Stub(SQL);
  assert.throws(() => stub.prepare('SELECT 1'), /unknown prepared statement/);
});

test('harness: a wrong bind-argument count throws instead of silently storing a bad row', async () => {
  const stub = createD1Stub(SQL);
  await assert.rejects(
    () => stub.prepare(SQL.INSERT_FEEDBACK).bind('only', 'three', 'args').run(),
    /expects 8 bind args/,
  );
  await assert.rejects(
    () => stub.prepare(SQL.RATE_LIMIT_RECORD).bind(IP_HASH).run(),
    /expects 2 bind args/,
  );
  await assert.rejects(
    () => stub.prepare(SQL.RATE_LIMIT_COUNT).bind(IP_HASH, NOW).first(),
    /expects 1 bind args/,
  );
});

test('harness: touched reports any D1 contact, prepare included', async () => {
  const stub = createD1Stub(SQL);
  assert.equal(stub.touched, false);
  stub.prepare(SQL.INSERT_FEEDBACK);
  assert.equal(stub.touched, true);
  assert.equal(stub.calls.length, 0);
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
        INSERT_FEEDBACK: 'i',
      }),
    TypeError,
  );
});
