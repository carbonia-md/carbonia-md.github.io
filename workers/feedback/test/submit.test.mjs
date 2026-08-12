/**
 * LB-69 DoD 1 and 5: the module surface, the accepted-submission path, and the exact
 * shape of the row written to D1.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import worker, { handleRequest, SQL } from '../src/index.mjs';
import { createD1Stub, INSERT_COLUMNS } from './d1-stub.mjs';
import {
  ISO_TIMESTAMP,
  OMIT,
  USER_AGENT,
  assertCorsHeaders,
  assertSuccessBody,
  makeEnv,
  postJson,
  validPayload,
} from './helpers.mjs';

function freshEnv(overrides = {}) {
  const DB = createD1Stub(SQL);
  return { DB, env: makeEnv({ DB, ...overrides }) };
}

async function submitPayload(payload, options = {}) {
  const { DB, env } = freshEnv();
  const response = await handleRequest(postJson(payload, options), env);
  return { DB, env, response };
}

// --- module surface --------------------------------------------------------------

test('the module exports handleRequest, a default fetch handler, and four distinct SQL statements', () => {
  assert.equal(typeof handleRequest, 'function');
  assert.equal(typeof worker, 'object');
  assert.equal(typeof worker.fetch, 'function');

  const names = ['RATE_LIMIT_PRUNE', 'RATE_LIMIT_RECORD', 'RATE_LIMIT_COUNT', 'INSERT_FEEDBACK'];
  for (const name of names) {
    assert.equal(typeof SQL[name], 'string', `SQL.${name} must be a string`);
    assert.ok(SQL[name].length > 0, `SQL.${name} must be a non-empty statement`);
  }
  assert.equal(
    new Set(names.map((name) => SQL[name])).size,
    names.length,
    'the statements must be distinguishable by identity',
  );
});

test('the default export delegates fetch to handleRequest', async () => {
  const direct = freshEnv();
  const viaDefault = freshEnv();

  const directResponse = await handleRequest(postJson(validPayload()), direct.env);
  const defaultResponse = await worker.fetch(postJson(validPayload()), viaDefault.env, {
    waitUntil() {},
    passThroughOnException() {},
  });

  assert.equal(defaultResponse.status, directResponse.status);
  assert.equal(defaultResponse.status, 200);
  await assertSuccessBody(defaultResponse);
  assertCorsHeaders(defaultResponse);
  assert.equal(viaDefault.DB.rows.length, 1, 'the default export must run the same insert path');
});

test('the default export rejects a bad origin exactly like handleRequest', async () => {
  const { env } = freshEnv();
  const response = await worker.fetch(
    postJson(validPayload(), { origin: 'https://other.example.invalid' }),
    env,
    {},
  );
  assert.equal(response.status, 403);
});

// --- accepted submission ---------------------------------------------------------

test('a valid submission returns 200 with { ok: true, id } and inserts exactly one row', async () => {
  const { DB, response } = await submitPayload(validPayload());

  assert.equal(response.status, 200);
  const body = await assertSuccessBody(response);
  assertCorsHeaders(response);
  assert.equal(DB.rows.length, 1);
  assert.equal(DB.insertCalls.length, 1);
  assert.equal(DB.insertCalls[0].method, 'run', 'the insert must be consumed with run()');
  assert.equal(DB.rows[0].id, body.id, 'the returned id must be the id of the stored row');
});

test('each accepted submission gets a distinct id', async () => {
  const { DB, env } = freshEnv();
  const first = await assertSuccessBody(await handleRequest(postJson(validPayload()), env));
  const second = await assertSuccessBody(await handleRequest(postJson(validPayload()), env));

  assert.notEqual(first.id, second.id);
  assert.deepEqual(DB.rows.map((row) => row.id).sort(), [first.id, second.id].sort());
});

test('the rate-limit statements run before the insert', async () => {
  const { DB } = await submitPayload(validPayload());

  assert.deepEqual(
    DB.calls.map((call) => call.kind),
    ['prune', 'record', 'count', 'insert'],
    'the worker must settle the rate limit before inserting',
  );
  assert.equal(
    DB.callsOf('count')[0].method,
    'first',
    'the count statement must be consumed with first()',
  );
});

// --- stored row ------------------------------------------------------------------

test('the stored row carries the documented columns in the documented order', async () => {
  const { DB } = await submitPayload(
    validPayload({ contact: 'reader@example.invalid' }),
  );

  assert.equal(
    DB.insertCalls[0].args.length,
    INSERT_COLUMNS.length,
    'the insert must bind exactly the eight documented columns',
  );
  // The stub maps bind positions to column names, so each assertion below also pins the
  // position of that value in the bind list.
  const row = DB.rows[0];
  assert.match(row.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(row.created_at, ISO_TIMESTAMP);
  assert.equal(row.page, '/guides/example/');
  assert.equal(row.category, 'correction');
  assert.equal(row.message, 'The opening hours listed here look out of date.');
  assert.equal(row.contact, 'reader@example.invalid');
  assert.equal(row.user_agent, USER_AGENT);
  assert.equal(row.status, 'new');
});

test('created_at is the ISO-8601 instant of the submission', async () => {
  const before = Date.now();
  const { DB } = await submitPayload(validPayload());
  const after = Date.now();

  const createdAt = DB.rows[0].created_at;
  assert.match(createdAt, ISO_TIMESTAMP);
  const parsed = Date.parse(createdAt);
  assert.equal(new Date(parsed).toISOString(), createdAt, 'created_at must round-trip as an ISO string');
  assert.ok(parsed >= before - 1000 && parsed <= after + 1000, 'created_at must be the time of the request');
});

test('page, category, and message are stored trimmed', async () => {
  const { DB } = await submitPayload(
    validPayload({
      page: '  /guides/example/  ',
      category: '  correction  ',
      message: '  This whitespace must not be stored.  ',
    }),
  );

  const row = DB.rows[0];
  assert.equal(row.page, '/guides/example/');
  assert.equal(row.category, 'correction');
  assert.equal(row.message, 'This whitespace must not be stored.');
});

test('contact is stored trimmed when supplied', async () => {
  const { DB } = await submitPayload(validPayload({ contact: '  reader@example.invalid  ' }));
  assert.equal(DB.rows[0].contact, 'reader@example.invalid');
});

test('contact stores null when it is absent, null, or blank', async () => {
  for (const contact of [OMIT, null, '', '   ']) {
    const { DB, response } = await submitPayload(validPayload({ contact }));
    assert.equal(response.status, 200, `contact=${JSON.stringify(contact)} must be accepted`);
    assert.equal(
      DB.rows[0].contact,
      null,
      `contact=${JSON.stringify(contact)} must store null, got ${JSON.stringify(DB.rows[0].contact)}`,
    );
  }
});

test('user_agent stores the request header, or null when the header is absent', async () => {
  const withAgent = await submitPayload(validPayload(), { userAgent: 'another-test-agent/2.0' });
  assert.equal(withAgent.DB.rows[0].user_agent, 'another-test-agent/2.0');

  const withoutAgent = await submitPayload(validPayload(), { userAgent: OMIT });
  assert.equal(withoutAgent.response.status, 200);
  assert.equal(withoutAgent.DB.rows[0].user_agent, null);
});

test('status is always stored as new', async () => {
  const { DB } = await submitPayload(validPayload({ status: 'closed' }));
  assert.equal(DB.rows[0].status, 'new', 'the client must not be able to choose the status');
});

test('no client-supplied id or created_at is trusted', async () => {
  const { DB, response } = await submitPayload(
    validPayload({ id: 'client-chosen-id', created_at: '1999-01-01T00:00:00.000Z' }),
  );
  const body = await assertSuccessBody(response);

  assert.notEqual(DB.rows[0].id, 'client-chosen-id');
  assert.equal(DB.rows[0].id, body.id);
  assert.notEqual(DB.rows[0].created_at, '1999-01-01T00:00:00.000Z');
});
