/**
 * LB-69 DoD 3: honeypot, rate limiting, and the salted IP hash.
 *
 * Contract: a non-empty trap field returns 200 with a success-shaped body and inserts no
 * row; at most RATE_LIMIT_MAX (default 5) submissions per rolling
 * RATE_LIMIT_WINDOW_SECONDS (default 3600) per sha256(CF-Connecting-IP + IP_HASH_SALT),
 * then 429 with Retry-After; a missing salt is a hard 500 and never an unsalted hash.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { handleRequest, SQL } from '../src/index.mjs';
import { PRUNE, RECORD, RELEASE, createD1Stub } from './d1-stub.mjs';
import {
  CLIENT_IP,
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_WINDOW_SECONDS,
  HEX_SHA256,
  OMIT,
  OTHER_CLIENT_IP,
  OTHER_SALT,
  SALT,
  assertCorsHeaders,
  assertErrorBody,
  assertSuccessBody,
  expectedIpHash,
  installClock,
  makeEnv,
  makeRequest,
  postJson,
  sha256Hex,
  spyOnDigest,
  validPayload,
} from './helpers.mjs';

const nowSeconds = () => Math.floor(Date.now() / 1000);

function submit(env, options = {}) {
  return handleRequest(postJson(validPayload(), options), env);
}

/**
 * Seed the stub so the next submission from `ip` sees `count + 1`.
 *
 * `count` seeds one second's bucket (a burst at a single instant); `seeds` seeds
 * several, which is how a test spreads prior submissions across the window.
 */
async function seededEnv({
  count,
  seeds,
  envOverrides = {},
  ip = CLIENT_IP,
  salt = SALT,
  windowStart,
} = {}) {
  const DB = createD1Stub(SQL);
  const env = makeEnv({ DB, IP_HASH_SALT: salt, ...envOverrides });
  const buckets = seeds ?? (count === undefined ? [] : [{ window_start: windowStart ?? nowSeconds(), count }]);
  if (buckets.length > 0) {
    DB.seedRateLimit(await expectedIpHash(ip, salt), ...buckets);
  }
  return { DB, env };
}

/** The bind args of the last PRUNE / RECORD call, which carry floor and now. */
const lastPrune = (DB) => DB.callsOf(PRUNE).at(-1).args;
const lastRecord = (DB) => DB.callsOf(RECORD).at(-1).args;
const boundWindowSeconds = (DB) => lastRecord(DB)[1] - lastPrune(DB)[1];

// --- honeypot --------------------------------------------------------------------

test('a non-empty trap field returns 200 with a success-shaped body and touches no D1', async () => {
  const { DB, env } = await seededEnv();
  const response = await handleRequest(postJson(validPayload({ website: 'https://spam.example.invalid' })), env);

  assert.equal(response.status, 200);
  await assertSuccessBody(response);
  assertCorsHeaders(response);
  assert.equal(DB.touched, false, 'the honeypot must make no D1 call whatsoever');
  assert.equal(DB.rows.length, 0, 'the honeypot must insert no row');
});

test('the honeypot answer carries a fresh uuid on every request', async () => {
  const { env } = await seededEnv();
  const first = await assertSuccessBody(
    await handleRequest(postJson(validPayload({ website: 'trap' })), env),
  );
  const second = await assertSuccessBody(
    await handleRequest(postJson(validPayload({ website: 'trap' })), env),
  );
  assert.notEqual(first.id, second.id, 'each honeypot answer must look like a distinct submission');
});

test('the honeypot is checked before validation: an invalid payload with the trap set still returns 200', async () => {
  const { DB, env } = await seededEnv();
  const response = await handleRequest(
    postJson({ page: '', category: '', message: 'x', website: 'trap' }),
    env,
  );

  assert.equal(response.status, 200);
  await assertSuccessBody(response);
  assert.equal(DB.touched, false);
});

test('a trap field that is absent, null, or blank after trim is not treated as spam', async () => {
  for (const website of [OMIT, null, '', '   ']) {
    const { DB, env } = await seededEnv();
    const response = await handleRequest(postJson(validPayload({ website })), env);

    assert.equal(response.status, 200, `website=${JSON.stringify(website)} must be accepted normally`);
    assert.equal(DB.rows.length, 1, `website=${JSON.stringify(website)} must still insert a row`);
  }
});

// --- rate limit ------------------------------------------------------------------

test('the default rate limit accepts 5 submissions in a window and rejects the 6th', async () => {
  const { DB, env } = await seededEnv();

  for (let i = 1; i <= DEFAULT_RATE_LIMIT_MAX; i += 1) {
    const response = await submit(env);
    assert.equal(response.status, 200, `submission ${i} must be accepted`);
  }
  assert.equal(DB.rows.length, DEFAULT_RATE_LIMIT_MAX);

  const rejected = await submit(env);
  assert.equal(rejected.status, 429);
  await assertErrorBody(rejected, 'rate_limited');
  assertCorsHeaders(rejected);
  assert.equal(DB.rows.length, DEFAULT_RATE_LIMIT_MAX, 'a rate-limited request must insert no row');
});

test('a configured RATE_LIMIT_MAX replaces the default at its exact boundary', async () => {
  const max = 3;

  const accepted = await seededEnv({ count: max - 1, envOverrides: { RATE_LIMIT_MAX: String(max) } });
  const okResponse = await submit(accepted.env);
  assert.equal(okResponse.status, 200, `submission ${max} must still be accepted`);

  const rejected = await seededEnv({ count: max, envOverrides: { RATE_LIMIT_MAX: String(max) } });
  const limited = await submit(rejected.env);
  assert.equal(limited.status, 429, `submission ${max + 1} must be rate limited`);
  await assertErrorBody(limited, 'rate_limited');
});

// The regression this suite exists to hold. A first-hit-anchored fixed window accepts
// max at the very end of one window and a further max immediately after it resets, so
// 2 x max land within a second of each other while every rolling window of the
// configured length is supposed to hold at most max. The window must roll: the seconds
// that have actually aged out are the only ones that stop counting.
test('a burst across the window boundary cannot exceed the limit (no fixed-window reset)', async () => {
  const windowSeconds = DEFAULT_WINDOW_SECONDS;
  const now = nowSeconds();

  // One submission a full window ago, then max - 1 in the second just gone: exactly
  // max inside the rolling window, with the oldest sitting on the boundary.
  const { DB, env } = await seededEnv({
    seeds: [
      { window_start: now - windowSeconds + 1, count: 1 },
      { window_start: now - 1, count: DEFAULT_RATE_LIMIT_MAX - 1 },
    ],
  });

  const rejected = await submit(env);
  assert.equal(
    rejected.status,
    429,
    'the window must roll, not reset: max submissions are still inside it',
  );
  assert.equal(DB.rows.length, 0, 'a rate-limited request must insert no row');
});

test('only the seconds that have aged out stop counting', async () => {
  const windowSeconds = 600;
  const now = nowSeconds();

  // The oldest second is exactly at the floor (now - windowSeconds) and is pruned; the
  // rest remain, leaving max - 1 inside the window, so one more submission fits.
  const { DB, env } = await seededEnv({
    envOverrides: { RATE_LIMIT_WINDOW_SECONDS: String(windowSeconds) },
    seeds: [
      { window_start: now - windowSeconds, count: 1 },
      { window_start: now - 30, count: DEFAULT_RATE_LIMIT_MAX - 1 },
    ],
  });

  const response = await submit(env);
  assert.equal(response.status, 200, 'the aged-out second must free exactly one slot');
  assert.equal(DB.rows.length, 1);

  const limited = await submit(env);
  assert.equal(limited.status, 429, 'and the next one must be refused again');
});

test('a 429 carries a Retry-After of oldest + windowSeconds - now as an integer string', async () => {
  const windowSeconds = 600;
  const elapsed = 120;
  const { env } = await seededEnv({
    count: DEFAULT_RATE_LIMIT_MAX,
    envOverrides: { RATE_LIMIT_WINDOW_SECONDS: String(windowSeconds) },
    windowStart: nowSeconds() - elapsed,
  });

  const response = await submit(env);
  assert.equal(response.status, 429);

  const retryAfter = response.headers.get('retry-after');
  assert.match(retryAfter, /^\d+$/, 'Retry-After must be an integer string');
  assert.equal(
    Number(retryAfter),
    windowSeconds - elapsed,
    'the wait is until the oldest second inside the window falls out of it',
  );
  assert.ok(Number(retryAfter) >= 1, 'Retry-After must never be below 1');
});

test('Retry-After never exceeds the window and never drops below 1', async () => {
  const windowSeconds = 300;
  // Every prior submission is in the current second, so the wait is the whole window.
  const { env } = await seededEnv({
    count: DEFAULT_RATE_LIMIT_MAX,
    envOverrides: { RATE_LIMIT_WINDOW_SECONDS: String(windowSeconds) },
    windowStart: nowSeconds(),
  });

  const response = await submit(env);
  assert.equal(response.status, 429);
  const retryAfter = Number(response.headers.get('retry-after'));
  assert.ok(retryAfter >= 1 && retryAfter <= windowSeconds, `Retry-After ${retryAfter} out of range`);
});

// A refused attempt is not a submission, so it must not spend budget. If it did, an
// address at the limit would re-record itself on every retry and never get back in.
test('a request rejected with 429 gives back the slot it took: the count is unchanged', async () => {
  const { DB, env } = await seededEnv({ count: DEFAULT_RATE_LIMIT_MAX });
  const ipHash = await expectedIpHash(CLIENT_IP);

  const response = await submit(env);
  assert.equal(response.status, 429);
  assert.equal(
    DB.usage(ipHash).total,
    DEFAULT_RATE_LIMIT_MAX,
    'a refused attempt must not be counted as a submission',
  );

  const released = DB.callsOf(RELEASE).at(-1);
  assert.ok(released, 'a rejected request must issue RATE_LIMIT_RELEASE');
  assert.deepEqual(
    released.args,
    [ipHash, lastRecord(DB)[1]],
    'the release must target exactly the second this request recorded',
  );
});

test('an accepted request never releases its slot', async () => {
  const { DB, env } = await seededEnv({ count: DEFAULT_RATE_LIMIT_MAX - 1 });

  const response = await submit(env);
  assert.equal(response.status, 200);
  assert.equal(DB.callsOf(RELEASE).length, 0, 'only a refusal gives its slot back');
  assert.equal(
    DB.usage(await expectedIpHash(CLIENT_IP)).total,
    DEFAULT_RATE_LIMIT_MAX,
    'an accepted submission stays counted',
  );
});

// The exact staggered-bucket scenario from review: submissions spread across the
// window rather than bunched, so the oldest second falling out frees exactly one slot.
// A client that sleeps for Retry-After and retries must be accepted on that retry.
test('waiting exactly Retry-After after a 429 gets the next submission accepted', async () => {
  const windowSeconds = DEFAULT_WINDOW_SECONDS;
  const spacing = 600;
  const clock = installClock();
  try {
    const start = clock.seconds;
    const { DB, env } = await seededEnv({
      seeds: Array.from({ length: DEFAULT_RATE_LIMIT_MAX }, (_, i) => ({
        window_start: start - windowSeconds + spacing * (i + 1),
        count: 1,
      })),
    });

    const rejected = await submit(env);
    assert.equal(rejected.status, 429);
    const retryAfter = Number(rejected.headers.get('retry-after'));
    assert.equal(retryAfter, spacing, 'the oldest second falls out of the window in 600s');

    clock.advance(retryAfter);
    const retried = await submit(env);
    assert.equal(
      retried.status,
      200,
      'a client that obeys Retry-After must be let in, not refused again',
    );
    assert.equal(DB.rows.length, 1, 'and the accepted retry must store its row');
  } finally {
    clock.restore();
  }
});

// The general property behind the test above: obeying Retry-After always terminates.
// Seeded far above the limit -- as concurrent requests can transiently leave it --
// each retry must shed counted seconds and add none, so acceptance is reached.
test('obeying Retry-After always converges on acceptance, never an endless 429 loop', async () => {
  const windowSeconds = DEFAULT_WINDOW_SECONDS;
  const clock = installClock();
  try {
    const start = clock.seconds;
    const { env } = await seededEnv({
      seeds: Array.from({ length: DEFAULT_RATE_LIMIT_MAX * 3 }, (_, i) => ({
        window_start: start - windowSeconds + 120 * (i + 1),
        count: 1,
      })),
    });

    let accepted = false;
    for (let attempt = 0; attempt < DEFAULT_RATE_LIMIT_MAX * 4; attempt += 1) {
      const response = await submit(env);
      if (response.status === 200) {
        accepted = true;
        break;
      }
      assert.equal(response.status, 429);
      const retryAfter = Number(response.headers.get('retry-after'));
      assert.ok(retryAfter >= 1, 'every 429 must name a wait that actually advances the clock');
      clock.advance(retryAfter);
    }
    assert.ok(accepted, 'a client obeying Retry-After must eventually be accepted');
  } finally {
    clock.restore();
  }
});

// A released second sits at count 0. It contributes nothing to the total but would
// still answer MIN(window_start), which is what Retry-After is derived from -- so the
// prune has to drop it on the next request rather than wait for it to age out.
test('a released second is deleted by the next prune, not left to skew Retry-After', async () => {
  const clock = installClock();
  try {
    const { DB, env } = await seededEnv({
      seeds: [{ window_start: clock.seconds - 30, count: DEFAULT_RATE_LIMIT_MAX }],
    });
    const ipHash = await expectedIpHash(CLIENT_IP);

    const rejected = await submit(env);
    assert.equal(rejected.status, 429);
    assert.equal(DB.buckets.get(ipHash).get(clock.seconds), 0, 'the released second sits at zero');

    clock.advance(10);
    await submit(env);
    assert.equal(
      DB.buckets.get(ipHash).has(clock.seconds - 10),
      false,
      'the emptied second must be deleted, not carried as a zero row',
    );
  } finally {
    clock.restore();
  }
});

test('a whole window of silence prunes the history and the submission is accepted again', async () => {
  const { DB, env } = await seededEnv({
    count: 99,
    windowStart: nowSeconds() - DEFAULT_WINDOW_SECONDS - 60,
  });

  const response = await submit(env);
  assert.equal(response.status, 200, 'seconds older than the window must no longer count');
  await assertSuccessBody(response);
  assert.equal(DB.rows.length, 1);

  const ipHash = await expectedIpHash(CLIENT_IP);
  assert.equal(DB.usage(ipHash).total, 1, 'the stale rows must be gone, not merely ignored');
});

test('expired rows are deleted, so a hammering address does not grow the table without bound', async () => {
  const windowSeconds = 5;
  const { DB, env } = await seededEnv({
    envOverrides: { RATE_LIMIT_WINDOW_SECONDS: String(windowSeconds) },
    seeds: Array.from({ length: 50 }, (_, i) => ({
      window_start: nowSeconds() - windowSeconds - i - 1,
      count: 3,
    })),
  });

  await submit(env);

  const ipHash = await expectedIpHash(CLIENT_IP);
  assert.equal(DB.buckets.get(ipHash).size, 1, 'every aged-out second must be deleted, not kept');
});

test('the rate limit is keyed per client IP: a second IP starts with a fresh counter', async () => {
  const { DB, env } = await seededEnv({ count: DEFAULT_RATE_LIMIT_MAX });

  const limited = await submit(env, { ip: CLIENT_IP });
  assert.equal(limited.status, 429);

  const other = await submit(env, { ip: OTHER_CLIENT_IP });
  assert.equal(other.status, 200, 'a different client IP must not inherit the exhausted counter');
  assert.equal(DB.rows.length, 1);
});

test('RATE_LIMIT_WINDOW_SECONDS controls the bound window floor', async () => {
  const { DB, env } = await seededEnv({ envOverrides: { RATE_LIMIT_WINDOW_SECONDS: '120' } });
  await submit(env);

  assert.equal(boundWindowSeconds(DB), 120, 'windowFloor must equal now - windowSeconds');
});

test('absent, empty, non-numeric, or non-positive RATE_LIMIT_WINDOW_SECONDS falls back to 3600', async () => {
  for (const value of [OMIT, '', '   ', 'abc', '0', '-5', 0, -1]) {
    const { DB, env } = await seededEnv({ envOverrides: { RATE_LIMIT_WINDOW_SECONDS: value } });
    await submit(env);

    assert.equal(
      boundWindowSeconds(DB),
      DEFAULT_WINDOW_SECONDS,
      `RATE_LIMIT_WINDOW_SECONDS=${JSON.stringify(String(value))} must fall back to 3600`,
    );
  }
});

test('absent, empty, non-numeric, or non-positive RATE_LIMIT_MAX falls back to 5', async () => {
  for (const value of [OMIT, '', '   ', 'abc', '0', '-5', 0, -1]) {
    const accepted = await seededEnv({
      count: DEFAULT_RATE_LIMIT_MAX - 1,
      envOverrides: { RATE_LIMIT_MAX: value },
    });
    const okResponse = await submit(accepted.env);
    assert.equal(
      okResponse.status,
      200,
      `RATE_LIMIT_MAX=${JSON.stringify(String(value))}: submission 5 must be accepted`,
    );

    const rejected = await seededEnv({
      count: DEFAULT_RATE_LIMIT_MAX,
      envOverrides: { RATE_LIMIT_MAX: value },
    });
    const limited = await submit(rejected.env);
    assert.equal(
      limited.status,
      429,
      `RATE_LIMIT_MAX=${JSON.stringify(String(value))}: submission 6 must be rate limited`,
    );
  }
});

test('a numeric RATE_LIMIT_MAX and RATE_LIMIT_WINDOW_SECONDS are honoured as well as string ones', async () => {
  const { DB, env } = await seededEnv({
    count: 2,
    envOverrides: { RATE_LIMIT_MAX: 2, RATE_LIMIT_WINDOW_SECONDS: 300 },
  });
  const response = await submit(env);

  assert.equal(response.status, 429);
  assert.equal(boundWindowSeconds(DB), 300);
});

test('the rate-limit statements are bound with the ip hash, a unix-second now, and now - windowSeconds', async () => {
  const before = nowSeconds();
  const { DB, env } = await seededEnv();
  await submit(env);
  const after = nowSeconds();

  const [pruneHash, floor] = lastPrune(DB);
  const [recordHash, now] = lastRecord(DB);

  assert.match(recordHash, HEX_SHA256);
  assert.equal(pruneHash, recordHash, 'every statement must address the same hashed client');
  assert.equal(Number.isInteger(now), true, 'now must be an integer count of seconds');
  assert.ok(now >= before && now <= after, 'now must be the current unix time in seconds');
  assert.equal(floor, now - DEFAULT_WINDOW_SECONDS);
});

test('the three rate-limit statements run in order: prune, record, then count', async () => {
  const { DB, env } = await seededEnv();
  await submit(env);

  const kinds = DB.rateLimitCalls.map((call) => call.kind);
  assert.deepEqual(
    kinds,
    ['prune', 'record', 'count'],
    'counting before recording would let two concurrent requests both slip under the limit',
  );
});

// --- salt ------------------------------------------------------------------------

test('a missing IP_HASH_SALT is a 500 server_misconfigured with no D1 call', async () => {
  const DB = createD1Stub(SQL);
  const response = await handleRequest(postJson(validPayload()), makeEnv({ DB, IP_HASH_SALT: OMIT }));

  assert.equal(response.status, 500);
  await assertErrorBody(response, 'server_misconfigured');
  assertCorsHeaders(response);
  assert.equal(DB.touched, false, 'a misconfigured worker must not touch D1');
});

test('an empty IP_HASH_SALT is a 500 server_misconfigured, never an unsalted hash', async () => {
  const DB = createD1Stub(SQL);
  const response = await handleRequest(postJson(validPayload()), makeEnv({ DB, IP_HASH_SALT: '' }));

  assert.equal(response.status, 500, 'an empty IP_HASH_SALT must be a hard failure');
  await assertErrorBody(response, 'server_misconfigured');
  assert.equal(DB.touched, false);
});

// The contract said the salt check fires when IP_HASH_SALT is "missing or empty" and left
// blank-but-non-empty unspecified. Resolved in favour of failing closed: `wrangler secret
// put` stores a whitespace value without complaint, and a salt nobody chose is a
// configuration error rather than a salt. The worker checks the trimmed value but hashes
// the raw one, so a deliberate salt with leading or trailing space keeps its full entropy.
test(
  'a whitespace-only IP_HASH_SALT is treated as unset',
  async () => {
    const DB = createD1Stub(SQL);
    const response = await handleRequest(postJson(validPayload()), makeEnv({ DB, IP_HASH_SALT: '   ' }));

    assert.equal(response.status, 500, 'a whitespace-only IP_HASH_SALT must be a hard failure');
    await assertErrorBody(response, 'server_misconfigured');
    assert.equal(DB.touched, false);
  },
);

test('a missing IP_HASH_SALT performs no hashing of any kind', async () => {
  const spy = spyOnDigest();
  try {
    const DB = createD1Stub(SQL);
    const response = await handleRequest(postJson(validPayload()), makeEnv({ DB, IP_HASH_SALT: OMIT }));
    assert.equal(response.status, 500);
    assert.equal(spy.calls.length, 0, 'no digest may be computed without a salt');
  } finally {
    spy.restore();
  }
});

test('the salt check runs after the origin and method checks', async () => {
  const DB = createD1Stub(SQL);
  const env = makeEnv({ DB, IP_HASH_SALT: OMIT });

  const badMethod = await handleRequest(makeRequest({ method: 'GET', contentType: OMIT }), env);
  assert.equal(badMethod.status, 405, 'method rejection precedes the salt check');

  const preflight = await handleRequest(makeRequest({ method: 'OPTIONS', contentType: OMIT }), env);
  assert.equal(preflight.status, 204, 'preflight precedes the salt check');
});

// --- ip hashing ------------------------------------------------------------------

test('the rate-limit key is the lowercase hex sha256 of the client IP concatenated with the salt', async () => {
  const { DB, env } = await seededEnv();
  await submit(env, { ip: CLIENT_IP });

  const [ipHash] = DB.rateLimitCalls.at(-1).args;
  assert.match(ipHash, HEX_SHA256, 'the ip hash must be 64 lowercase hex characters');
  assert.equal(ipHash, await sha256Hex(`${CLIENT_IP}${SALT}`));
});

test('the same client IP hashes differently under a different salt', async () => {
  const first = await seededEnv({ salt: SALT });
  await submit(first.env, { ip: CLIENT_IP });
  const second = await seededEnv({ salt: OTHER_SALT });
  await submit(second.env, { ip: CLIENT_IP });

  const hashA = first.DB.rateLimitCalls.at(-1).args[0];
  const hashB = second.DB.rateLimitCalls.at(-1).args[0];
  assert.match(hashA, HEX_SHA256);
  assert.match(hashB, HEX_SHA256);
  assert.notEqual(hashA, hashB, 'the salt must change the hash for the same IP');
});

test('a missing CF-Connecting-IP hashes the empty string with the salt', async () => {
  const { DB, env } = await seededEnv();
  const response = await handleRequest(postJson(validPayload(), { ip: OMIT }), env);

  assert.equal(response.status, 200);
  const [ipHash] = DB.rateLimitCalls.at(-1).args;
  assert.equal(ipHash, await sha256Hex(SALT), 'an absent IP must hash as the empty string plus the salt');
});

test('the raw client IP is never bound to a statement and never stored in a column', async () => {
  const { DB, env } = await seededEnv();
  await submit(env, { ip: CLIENT_IP });

  const bound = DB.calls.flatMap((call) => call.args).map((arg) => String(arg));
  for (const value of bound) {
    assert.equal(value.includes(CLIENT_IP), false, `bound value must not contain the raw IP: ${value}`);
  }
  for (const row of DB.rows) {
    for (const [column, value] of Object.entries(row)) {
      assert.equal(
        String(value).includes(CLIENT_IP),
        false,
        `column ${column} must not contain the raw IP`,
      );
    }
  }
});

test('the raw client IP is never written to the console', async () => {
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const originals = {};
  const captured = [];
  for (const method of methods) {
    originals[method] = console[method];
    console[method] = (...args) => {
      captured.push(args.map((arg) => String(arg)).join(' '));
    };
  }
  try {
    const accepted = await seededEnv();
    await submit(accepted.env, { ip: CLIENT_IP });

    const limited = await seededEnv({ count: DEFAULT_RATE_LIMIT_MAX });
    await submit(limited.env, { ip: CLIENT_IP });

    const rejected = await seededEnv();
    await handleRequest(postJson(validPayload({ message: 'short' })), rejected.env);
  } finally {
    for (const method of methods) console[method] = originals[method];
  }

  for (const line of captured) {
    assert.equal(line.includes(CLIENT_IP), false, `the raw IP must never be logged: ${line}`);
  }
});
