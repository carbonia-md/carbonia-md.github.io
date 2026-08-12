/**
 * LB-69 DoD 2: origin allowlist, preflight, and the CORS headers on every response.
 *
 * Contract: a request is accepted only when `Origin` equals `env.ALLOWED_ORIGIN`; OPTIONS
 * is answered with that single origin plus the documented method/header/Vary set; an unset
 * var or an origin mismatch is 403, never `*`. The origin check runs before the method
 * check.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { handleRequest, SQL } from '../src/index.mjs';
import { createD1Stub } from './d1-stub.mjs';
import {
  ALLOWED_ORIGIN,
  CLIENT_IP,
  DEFAULT_WINDOW_SECONDS,
  OMIT,
  OTHER_ORIGIN,
  SALT,
  assertCorsHeaders,
  assertErrorBody,
  assertSuccessBody,
  expectedIpHash,
  makeEnv,
  makeRequest,
  postJson,
  validPayload,
} from './helpers.mjs';

function envWithStub(overrides = {}) {
  const DB = createD1Stub(SQL);
  return { env: makeEnv({ DB, ...overrides }), DB };
}

test('OPTIONS from the allowed origin is a 204 preflight with the documented CORS headers', async () => {
  const { env, DB } = envWithStub();
  const response = await handleRequest(makeRequest({ method: 'OPTIONS', contentType: OMIT }), env);

  assert.equal(response.status, 204);
  assert.equal(await response.text(), '', 'preflight body must be empty');
  assert.equal(response.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
  assert.equal(response.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal(response.headers.get('access-control-allow-headers'), 'Content-Type');
  assert.equal(response.headers.get('vary'), 'Origin');
  assert.deepEqual(
    [...response.headers.keys()].filter((name) => name.startsWith('access-control-')).sort(),
    ['access-control-allow-headers', 'access-control-allow-methods', 'access-control-allow-origin'],
    'preflight must carry exactly the three documented Access-Control headers',
  );
  assert.equal(DB.touched, false, 'preflight must not touch D1');
});

test('preflight never answers with a wildcard origin', async () => {
  const { env } = envWithStub();
  const response = await handleRequest(makeRequest({ method: 'OPTIONS', contentType: OMIT }), env);
  assert.notEqual(response.headers.get('access-control-allow-origin'), '*');
});

test('a POST from a different origin is 403 origin_not_allowed with no CORS origin header', async () => {
  const { env, DB } = envWithStub();
  const response = await handleRequest(postJson(validPayload(), { origin: OTHER_ORIGIN }), env);

  assert.equal(response.status, 403);
  await assertErrorBody(response, 'origin_not_allowed');
  assert.equal(
    response.headers.get('access-control-allow-origin'),
    null,
    'the 403 rejection must carry no Access-Control-Allow-Origin header at all',
  );
  assert.equal(DB.touched, false);
});

test('a POST with no Origin header at all is 403 origin_not_allowed', async () => {
  const { env, DB } = envWithStub();
  const response = await handleRequest(postJson(validPayload(), { origin: OMIT }), env);

  assert.equal(response.status, 403);
  await assertErrorBody(response, 'origin_not_allowed');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(DB.touched, false);
});

test('an empty Origin header is 403 origin_not_allowed', async () => {
  const { env } = envWithStub();
  const response = await handleRequest(postJson(validPayload(), { origin: '' }), env);

  assert.equal(response.status, 403);
  await assertErrorBody(response, 'origin_not_allowed');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('an unset env.ALLOWED_ORIGIN rejects every request with 403, never a wildcard', async () => {
  for (const allowed of [OMIT, '']) {
    const DB = createD1Stub(SQL);
    const env = makeEnv({ DB, ALLOWED_ORIGIN: allowed });

    const post = await handleRequest(postJson(validPayload()), env);
    assert.equal(post.status, 403, `POST with ALLOWED_ORIGIN=${String(allowed)}`);
    await assertErrorBody(post, 'origin_not_allowed');
    assert.equal(post.headers.get('access-control-allow-origin'), null);

    const preflight = await handleRequest(makeRequest({ method: 'OPTIONS', contentType: OMIT }), env);
    assert.equal(preflight.status, 403, `OPTIONS with ALLOWED_ORIGIN=${String(allowed)}`);
    assert.equal(preflight.headers.get('access-control-allow-origin'), null);
    assert.equal(DB.touched, false);
  }
});

test('an unset env.ALLOWED_ORIGIN rejects a request that sends no Origin either', async () => {
  const DB = createD1Stub(SQL);
  const env = makeEnv({ DB, ALLOWED_ORIGIN: OMIT });
  const response = await handleRequest(postJson(validPayload(), { origin: OMIT }), env);

  assert.equal(response.status, 403, 'an absent header must not be treated as matching an absent var');
  await assertErrorBody(response, 'origin_not_allowed');
});

test('the origin check runs before the method check: a GET from a bad origin is 403', async () => {
  const { env } = envWithStub();
  const response = await handleRequest(makeRequest({ method: 'GET', origin: OTHER_ORIGIN, contentType: OMIT }), env);

  assert.equal(response.status, 403);
  await assertErrorBody(response, 'origin_not_allowed');
});

test('a GET from the allowed origin is 405 method_not_allowed', async () => {
  const { env, DB } = envWithStub();
  const response = await handleRequest(makeRequest({ method: 'GET', contentType: OMIT }), env);

  assert.equal(response.status, 405);
  await assertErrorBody(response, 'method_not_allowed');
  assertCorsHeaders(response);
  assert.equal(DB.touched, false);
});

test('every method other than POST and OPTIONS is 405 method_not_allowed', async () => {
  for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE']) {
    const { env, DB } = envWithStub();
    const request = makeRequest({
      method,
      contentType: method === 'GET' || method === 'HEAD' ? OMIT : 'application/json',
      body: method === 'GET' || method === 'HEAD' ? undefined : validPayload(),
    });
    const response = await handleRequest(request, env);

    assert.equal(response.status, 405, `${method} must be 405`);
    await assertErrorBody(response, 'method_not_allowed');
    assertCorsHeaders(response);
    assert.equal(DB.touched, false, `${method} must not touch D1`);
  }
});

test('CORS headers are present on every non-403 response class', async () => {
  const validRateLimitEnv = () => {
    const DB = createD1Stub(SQL);
    return { DB, env: makeEnv({ DB }) };
  };

  // 200 success
  {
    const { env } = validRateLimitEnv();
    const response = await handleRequest(postJson(validPayload()), env);
    assert.equal(response.status, 200);
    assertCorsHeaders(response);
    await assertSuccessBody(response);
  }

  // 200 honeypot
  {
    const { env } = validRateLimitEnv();
    const response = await handleRequest(postJson(validPayload({ website: 'spam' })), env);
    assert.equal(response.status, 200);
    assertCorsHeaders(response);
  }

  // 400 validation
  {
    const { env } = validRateLimitEnv();
    const response = await handleRequest(postJson(validPayload({ page: OMIT })), env);
    assert.equal(response.status, 400);
    assertCorsHeaders(response);
  }

  // 400 content type
  {
    const { env } = validRateLimitEnv();
    const response = await handleRequest(
      postJson(validPayload(), { contentType: 'text/plain; charset=utf-8' }),
      env,
    );
    assert.equal(response.status, 400);
    assertCorsHeaders(response);
  }

  // 405 method
  {
    const { env } = validRateLimitEnv();
    const response = await handleRequest(makeRequest({ method: 'GET', contentType: OMIT }), env);
    assert.equal(response.status, 405);
    assertCorsHeaders(response);
  }

  // 500 missing salt
  {
    const DB = createD1Stub(SQL);
    const response = await handleRequest(postJson(validPayload()), makeEnv({ DB, IP_HASH_SALT: OMIT }));
    assert.equal(response.status, 500);
    assertCorsHeaders(response);
  }

  // 429 rate limited
  {
    const DB = createD1Stub(SQL);
    DB.seedRateLimit(await expectedIpHash(CLIENT_IP, SALT), {
      window_start: Math.floor(Date.now() / 1000),
      count: 500,
    });
    const response = await handleRequest(postJson(validPayload()), makeEnv({ DB }));
    assert.equal(response.status, 429);
    assertCorsHeaders(response);
  }

  // 204 preflight
  {
    const { env } = validRateLimitEnv();
    const response = await handleRequest(makeRequest({ method: 'OPTIONS', contentType: OMIT }), env);
    assert.equal(response.status, 204);
    assertCorsHeaders(response);
  }
});

test('the seeded 429 fixture proves the rate-limit window is the documented default', async () => {
  const DB = createD1Stub(SQL);
  const windowStart = Math.floor(Date.now() / 1000);
  DB.seedRateLimit(await expectedIpHash(CLIENT_IP, SALT), { window_start: windowStart, count: 500 });
  const response = await handleRequest(postJson(validPayload()), makeEnv({ DB }));

  assert.equal(response.status, 429);
  const [, floor] = DB.callsOf('prune').at(-1).args;
  const [, boundNow] = DB.callsOf('record').at(-1).args;
  assert.equal(boundNow - floor, DEFAULT_WINDOW_SECONDS, 'windowFloor must be now - 3600 by default');
});
