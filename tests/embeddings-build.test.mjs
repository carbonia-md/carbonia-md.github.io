// embeddings-build.test.mjs -- run with
// `node --test tests/embeddings-build.test.mjs`.
//
// LB-83 DoD 3 (the embed path against the Workers AI REST endpoint), DoD 4 (the
// int8 quantization round-trip), and DoD 5 (the coverage assertion and the
// artifact). Written against the published contract of
// scripts/core/build-embeddings.mjs only; nothing here reads the module's source.
//
// No test performs real network I/O: embedBatch takes fetchImpl and sleep, so
// every HTTP case is a stub and no retry ever waits. Every float vector is
// generated from a seeded PRNG or an analytic function, never Math.random(), so a
// quantization-error assertion is reproducible run to run.
//
// This file lives under tests/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SCHEMA,
  MODEL,
  DIM,
  QUANT,
  MAX_BATCH,
  l2normInt8,
  packVectors,
  unpackVectors,
  readCredentials,
  embedBatch,
  embedAllChunks,
  embedInput,
  assertFullCoverage,
  buildArtifact,
} from '../scripts/core/build-embeddings.mjs';

/* ------------------------------------------------------------------ fixtures */

/** Deterministic PRNG (mulberry32). Seeded, so every run quantizes the same vectors. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A DIM-long float vector of seeded uniform values in [-1, 1). */
function randomVector(seed, dim = DIM) {
  const next = mulberry32(seed);
  return Array.from({ length: dim }, () => next() * 2 - 1);
}

/** A DIM-long float vector from an analytic function, scaled. */
function analyticVector(period, scale = 1, dim = DIM) {
  return Array.from({ length: dim }, (_, i) => Math.sin(i / period) * scale);
}

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const norm = (a) => Math.sqrt(dot(a, a));
const cosine = (a, b) => dot(a, b) / (norm(a) * norm(b));

/** The cosine a consumer computes from the decoded int8 vectors: dot / 127^2. */
const int8Cosine = (a, b) => dot([...a], [...b]) / (127 * 127);

/** A chunk-shaped record for the artifact tests: the eight published keys. */
function chunkRecord(index) {
  return {
    id: `about/example-article#${index}`,
    slug: 'about/example-article',
    title: 'Example Article',
    url: '/about/example-article',
    category: 'about',
    heading: `Section ${index}`,
    chunkIndex: index,
    text: `body text for chunk ${index}`,
  };
}

/* ------------------------------------------------------- the build constants */

describe('the build constants are the published values', () => {
  test('SCHEMA, MODEL, DIM, QUANT and MAX_BATCH', () => {
    assert.equal(SCHEMA, 'rag-v1');
    assert.equal(MODEL, '@cf/baai/bge-m3');
    assert.equal(DIM, 1024);
    assert.equal(QUANT, 'i8-unit');
    assert.equal(MAX_BATCH, 100);
  });
});

/* ------------------------------------------------------------- l2normInt8 */

describe('DoD 4: l2normInt8 normalizes then scales to int8', () => {
  test('returns an Int8Array of the same length', () => {
    const out = l2normInt8(randomVector(11));
    assert.ok(out instanceof Int8Array, `expected an Int8Array, got ${Object.prototype.toString.call(out)}`);
    assert.equal(out.length, DIM);
  });

  test('L2-normalizes the vector, then scales by 127', () => {
    // [3, 4] has norm 5, so the unit vector is [0.6, 0.8] and the int8 form is
    // [76.2, 101.6] before rounding. A tolerance of 1 admits round or truncate.
    const out = l2normInt8([3, 4]);
    assert.equal(out.length, 2);
    assert.ok(Math.abs(out[0] - 76.2) <= 1, `expected ~76 for 0.6 * 127, got ${out[0]}`);
    assert.ok(Math.abs(out[1] - 101.6) <= 1, `expected ~102 for 0.8 * 127, got ${out[1]}`);
  });

  test('scale is independent of input magnitude: a 1000x longer vector quantizes the same', () => {
    const small = l2normInt8([3, 4]);
    const large = l2normInt8([3000, 4000]);
    assert.deepEqual([...large], [...small]);
  });

  test('negative components keep their sign', () => {
    const out = l2normInt8([-3, 4]);
    assert.ok(out[0] < 0, `expected a negative component, got ${out[0]}`);
    assert.ok(Math.abs(out[0] + 76.2) <= 1, `expected ~-76, got ${out[0]}`);
  });

  test('every component is clamped to [-127, 127]', () => {
    for (const vector of [randomVector(12), analyticVector(7, 5000), [1e9, 0, 0, 0], [-1e9, 1e-9]]) {
      for (const value of l2normInt8(vector)) {
        assert.ok(value >= -127 && value <= 127, `expected a value in [-127, 127], got ${value}`);
      }
    }
  });

  test('a single-axis vector quantizes to the clamp boundary, not past it', () => {
    const out = l2normInt8([5, 0, 0, 0]);
    assert.equal(out[0], 127);
    assert.deepEqual([...out.slice(1)], [0, 0, 0]);
  });

  test('an all-zero vector produces zeros, not NaN', () => {
    const out = l2normInt8(new Array(DIM).fill(0));
    assert.equal(out.length, DIM);
    for (const value of out) {
      assert.ok(Number.isFinite(value), `expected a finite value, got ${value}`);
      assert.equal(value, 0);
    }
  });

  test('quantization preserves direction: the int8 vector is near-parallel to the float one', () => {
    const vector = randomVector(13);
    const quantized = [...l2normInt8(vector)];
    assert.ok(
      Math.abs(cosine(vector, quantized) - 1) < 0.01,
      `expected the quantized vector to stay parallel, cosine was ${cosine(vector, quantized)}`,
    );
  });
});

/* ------------------------------------------------- packVectors/unpackVectors */

describe('DoD 4: packVectors and unpackVectors are inverses', () => {
  const vectors = [1, 2, 3].map((seed) => l2normInt8(randomVector(seed)));

  test('packVectors returns a base64 string', () => {
    const packed = packVectors(vectors);
    assert.equal(typeof packed, 'string');
    assert.match(packed, /^[A-Za-z0-9+/]*={0,2}$/, 'expected base64 characters only');
  });

  test('the packed buffer is exactly N * dim bytes', () => {
    const bytes = Buffer.from(packVectors(vectors), 'base64');
    assert.equal(bytes.length, vectors.length * DIM);
  });

  test('unpackVectors returns N Int8Arrays of length dim', () => {
    const out = unpackVectors(packVectors(vectors), DIM);
    assert.equal(out.length, vectors.length);
    for (const vector of out) {
      assert.ok(vector instanceof Int8Array, `expected an Int8Array, got ${Object.prototype.toString.call(vector)}`);
      assert.equal(vector.length, DIM);
    }
  });

  test('a vector round-trips byte-identically', () => {
    const out = unpackVectors(packVectors(vectors), DIM);
    assert.equal(out.length, vectors.length);
    for (const [i, vector] of out.entries()) {
      assert.deepEqual([...vector], [...vectors[i]], `vector ${i} did not round-trip byte-identically`);
    }
  });

  test('vector order survives the round trip', () => {
    // Three vectors whose first components are distinct, so a reordering shows up.
    const marked = [
      l2normInt8([5, 0, 0, 0]),
      l2normInt8([0, 5, 0, 0]),
      l2normInt8([0, 0, 5, 0]),
    ];
    const out = unpackVectors(packVectors(marked), 4);
    assert.deepEqual(out.map((vector) => [...vector].indexOf(127)), [0, 1, 2]);
  });

  test('negative components survive the round trip as negative bytes', () => {
    const signed = [Int8Array.from([-127, -1, 0, 1, 127])];
    const out = unpackVectors(packVectors(signed), 5);
    assert.deepEqual([...out[0]], [-127, -1, 0, 1, 127]);
  });

  test('an empty vector list packs to an empty buffer and unpacks to no vectors', () => {
    const packed = packVectors([]);
    assert.equal(Buffer.from(packed, 'base64').length, 0);
    assert.deepEqual(unpackVectors(packed, DIM), []);
  });
});

/* -------------------------------------- DoD 4: the cosine-similarity round trip */

describe('DoD 4: cosine similarity survives the quantization round trip', () => {
  // Seeded and analytic vectors only: no Math.random(), so an error bound is a
  // reproducible assertion rather than a flaky one. The set mixes near-duplicate,
  // unrelated, tiny-magnitude and sparse vectors so the bound is not tested on
  // easy pairs alone.
  const base = randomVector(101);
  const near = base.map((value, i) => value + Math.sin(i / 3) * 0.02);
  const sparse = Array.from({ length: DIM }, (_, i) => (i % 97 === 0 ? 4 : 0));
  const floats = [
    base,
    near,
    randomVector(202),
    analyticVector(17),
    analyticVector(29, 0.001),
    sparse,
  ];

  test('every pairwise cosine computed from the decoded int8 vectors is within 0.01 of the float cosine', () => {
    const decoded = unpackVectors(packVectors(floats.map((vector) => l2normInt8(vector))), DIM);
    assert.equal(decoded.length, floats.length);

    for (let i = 0; i < floats.length; i++) {
      for (let j = i + 1; j < floats.length; j++) {
        const expected = cosine(floats[i], floats[j]);
        const actual = int8Cosine(decoded[i], decoded[j]);
        assert.ok(
          Math.abs(actual - expected) < 0.01,
          `pair (${i}, ${j}): float cosine ${expected}, decoded cosine ${actual}, ` +
            `absolute error ${Math.abs(actual - expected)} must stay under 0.01`,
        );
      }
    }
  });

  test('a vector compared with itself decodes to a cosine of ~1', () => {
    const decoded = unpackVectors(packVectors([l2normInt8(base)]), DIM);
    assert.ok(
      Math.abs(int8Cosine(decoded[0], decoded[0]) - 1) < 0.01,
      `expected ~1, got ${int8Cosine(decoded[0], decoded[0])}`,
    );
  });

  test('the round trip is byte-identical for the whole set', () => {
    const quantized = floats.map((vector) => l2normInt8(vector));
    const decoded = unpackVectors(packVectors(quantized), DIM);
    for (const [i, vector] of decoded.entries()) {
      assert.deepEqual([...vector], [...quantized[i]], `vector ${i} did not round-trip byte-identically`);
    }
  });
});

/* ------------------------------------------------------- DoD 3: credentials */

describe('DoD 3: readCredentials reads the two variables off the passed object', () => {
  test('returns accountId and apiToken from CF_ACCOUNT_ID and CF_AI_TOKEN', () => {
    const credentials = readCredentials({ CF_ACCOUNT_ID: 'account-one', CF_AI_TOKEN: 'token-one' });
    assert.equal(credentials.accountId, 'account-one');
    assert.equal(credentials.apiToken, 'token-one');
  });

  test('extra keys on the env object are ignored', () => {
    const credentials = readCredentials({
      CF_ACCOUNT_ID: 'account-one',
      CF_AI_TOKEN: 'token-one',
      PATH: '/usr/bin',
    });
    assert.equal(credentials.accountId, 'account-one');
    assert.equal(credentials.apiToken, 'token-one');
  });

  for (const [what, value] of [
    ['missing', undefined],
    ['an empty string', ''],
    ['whitespace-only', '   '],
  ]) {
    test(`throws naming CF_ACCOUNT_ID when it is ${what}`, () => {
      const env = { CF_AI_TOKEN: 'token-one' };
      if (value !== undefined) env.CF_ACCOUNT_ID = value;
      assert.throws(
        () => readCredentials(env),
        (error) => {
          assert.ok(error instanceof Error, 'expected an Error');
          assert.ok(
            error.message.includes('CF_ACCOUNT_ID'),
            `expected the message to name CF_ACCOUNT_ID, got: ${error.message}`,
          );
          return true;
        },
      );
    });

    test(`throws naming CF_AI_TOKEN when it is ${what}`, () => {
      const env = { CF_ACCOUNT_ID: 'account-one' };
      if (value !== undefined) env.CF_AI_TOKEN = value;
      assert.throws(
        () => readCredentials(env),
        (error) => {
          assert.ok(error instanceof Error, 'expected an Error');
          assert.ok(
            error.message.includes('CF_AI_TOKEN'),
            `expected the message to name CF_AI_TOKEN, got: ${error.message}`,
          );
          return true;
        },
      );
    });
  }

  test('reads the passed object, never process.env', () => {
    const saved = { id: process.env.CF_ACCOUNT_ID, token: process.env.CF_AI_TOKEN };
    process.env.CF_ACCOUNT_ID = 'account-from-process-env';
    process.env.CF_AI_TOKEN = 'token-from-process-env';
    try {
      assert.throws(() => readCredentials({}), /CF_ACCOUNT_ID|CF_AI_TOKEN/);
      const credentials = readCredentials({ CF_ACCOUNT_ID: 'account-one', CF_AI_TOKEN: 'token-one' });
      assert.equal(credentials.accountId, 'account-one');
      assert.equal(credentials.apiToken, 'token-one');
    } finally {
      if (saved.id === undefined) delete process.env.CF_ACCOUNT_ID;
      else process.env.CF_ACCOUNT_ID = saved.id;
      if (saved.token === undefined) delete process.env.CF_AI_TOKEN;
      else process.env.CF_AI_TOKEN = saved.token;
    }
  });
});

/* --------------------------------------------------------- DoD 3: embedBatch */

const ACCOUNT = 'account-one';
const TOKEN = 'token-one';
const SMALL_DIM = 3;
const TEXTS = ['first chunk text', 'second chunk text'];
const VECTORS = [
  [0.1, 0.2, 0.3],
  [-0.4, 0.5, -0.6],
];

/**
 * A sleep that records its delays and reports whether the promise it last handed
 * out has settled. A retry issued while the sleep is unsettled was never awaited.
 */
function makeSleep() {
  const delays = [];
  let settled = true;
  const sleep = (ms) => {
    delays.push(ms);
    settled = false;
    return new Promise((resolve) => {
      setTimeout(() => {
        settled = true;
        resolve();
      }, 0);
    });
  };
  return { delays, sleep, isSettled: () => settled };
}

/** A fetch stub driven by a per-attempt handler, recording every call. */
function makeFetch(handler, sleepState) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, sleepSettled: sleepState ? sleepState.isSettled() : true });
    return handler(calls.length - 1);
  };
  return { calls, fetchImpl };
}

const okResponse = (vectors) =>
  new Response(JSON.stringify({ result: { data: vectors } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const errorResponse = (status) =>
  new Response(JSON.stringify({ success: false, errors: [{ code: status, message: 'stub failure' }] }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('DoD 3: embedBatch calls the Workers AI REST endpoint', () => {
  test('throws when texts.length exceeds MAX_BATCH, without issuing a request', async () => {
    const { calls, fetchImpl } = makeFetch(() => okResponse(VECTORS));
    const { sleep } = makeSleep();
    const texts = Array.from({ length: MAX_BATCH + 1 }, (_, i) => `text ${i}`);

    await assert.rejects(
      () => embedBatch(texts, { accountId: ACCOUNT, apiToken: TOKEN, fetchImpl, sleep, dim: SMALL_DIM }),
      (error) => {
        assert.ok(error instanceof Error, 'expected an Error');
        return true;
      },
    );
    assert.equal(calls.length, 0, 'an over-sized batch must never reach the network');
  });

  test('accepts exactly MAX_BATCH texts', async () => {
    const texts = Array.from({ length: MAX_BATCH }, (_, i) => `text ${i}`);
    const vectors = texts.map((_, i) => [i, i + 1, i + 2]);
    const { calls, fetchImpl } = makeFetch(() => okResponse(vectors));
    const { sleep } = makeSleep();

    const out = await embedBatch(texts, {
      accountId: ACCOUNT,
      apiToken: TOKEN,
      fetchImpl,
      sleep,
      dim: SMALL_DIM,
    });
    assert.equal(out.length, MAX_BATCH);
    assert.equal(calls.length, 1);
  });

  test('issues one POST to the account/model run URL with the bearer token and the text payload', async () => {
    const { calls, fetchImpl } = makeFetch(() => okResponse(VECTORS));
    const { sleep, delays } = makeSleep();

    await embedBatch(TEXTS, {
      accountId: ACCOUNT,
      apiToken: TOKEN,
      fetchImpl,
      sleep,
      model: MODEL,
      dim: SMALL_DIM,
    });

    assert.equal(calls.length, 1, 'a 200 must not be retried');
    assert.deepEqual(delays, [], 'a happy path must never sleep');
    const [{ url, init }] = calls;
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`);
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(init.body), { text: TEXTS });
  });

  test('uses the model given in options when it differs from MODEL', async () => {
    const { calls, fetchImpl } = makeFetch(() => okResponse(VECTORS));
    const { sleep } = makeSleep();

    await embedBatch(TEXTS, {
      accountId: ACCOUNT,
      apiToken: TOKEN,
      fetchImpl,
      sleep,
      model: 'other/model-name',
      dim: SMALL_DIM,
    });
    assert.equal(calls[0].url, `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/other/model-name`);
  });

  test('returns result.data, the raw float vectors, in input order', async () => {
    const { fetchImpl } = makeFetch(() => okResponse(VECTORS));
    const { sleep } = makeSleep();

    const out = await embedBatch(TEXTS, {
      accountId: ACCOUNT,
      apiToken: TOKEN,
      fetchImpl,
      sleep,
      dim: SMALL_DIM,
    });
    assert.deepEqual(out, VECTORS);
  });
});

describe('DoD 3: embedBatch retries every non-2xx status uniformly', () => {
  test('a 401 is retried like any other status, then fails after 1 + retries attempts', async () => {
    const sleepState = makeSleep();
    const { calls, fetchImpl } = makeFetch(() => errorResponse(401), sleepState);

    // retries is left at its default of 3, so the contract's cap is 4 requests.
    await assert.rejects(
      () =>
        embedBatch(TEXTS, {
          accountId: ACCOUNT,
          apiToken: TOKEN,
          fetchImpl,
          sleep: sleepState.sleep,
          dim: SMALL_DIM,
        }),
      (error) => {
        assert.ok(error instanceof Error, 'expected an Error');
        assert.ok(error.message.includes('401'), `expected the status in the message, got: ${error.message}`);
        return true;
      },
    );

    assert.equal(calls.length, 4, 'at most 1 + retries = 4 requests');
    assert.equal(sleepState.delays.length, 3, 'one sleep between each pair of attempts');
    for (const [i, call] of calls.entries()) {
      assert.ok(call.sleepSettled, `attempt ${i} was issued before the preceding sleep resolved`);
    }
  });

  test('a 500 followed by a 200 resolves after exactly two requests, having slept once', async () => {
    const sleepState = makeSleep();
    const { calls, fetchImpl } = makeFetch(
      (attempt) => (attempt === 0 ? errorResponse(500) : okResponse(VECTORS)),
      sleepState,
    );

    const out = await embedBatch(TEXTS, {
      accountId: ACCOUNT,
      apiToken: TOKEN,
      fetchImpl,
      sleep: sleepState.sleep,
      dim: SMALL_DIM,
    });

    assert.deepEqual(out, VECTORS);
    assert.equal(calls.length, 2);
    assert.equal(sleepState.delays.length, 1);
    assert.ok(calls[1].sleepSettled, 'the retry was issued before the sleep resolved');
  });

  test('a 429 is retried on the same uniform path', async () => {
    const sleepState = makeSleep();
    const { calls, fetchImpl } = makeFetch(
      (attempt) => (attempt === 0 ? errorResponse(429) : okResponse(VECTORS)),
      sleepState,
    );

    const out = await embedBatch(TEXTS, {
      accountId: ACCOUNT,
      apiToken: TOKEN,
      fetchImpl,
      sleep: sleepState.sleep,
      dim: SMALL_DIM,
    });
    assert.deepEqual(out, VECTORS);
    assert.equal(calls.length, 2);
  });

  test('the retry budget is the retries option: 1 + retries requests', async () => {
    const sleepState = makeSleep();
    const { calls, fetchImpl } = makeFetch(() => errorResponse(503), sleepState);

    await assert.rejects(() =>
      embedBatch(TEXTS, {
        accountId: ACCOUNT,
        apiToken: TOKEN,
        fetchImpl,
        sleep: sleepState.sleep,
        dim: SMALL_DIM,
        retries: 1,
      }),
    );
    assert.equal(calls.length, 2);
    assert.equal(sleepState.delays.length, 1);
  });
});

describe('DoD 3: embedBatch validates the response shape', () => {
  test('a vector that is not dim long throws, naming the expected and the actual length', async () => {
    const { calls, fetchImpl } = makeFetch(() => okResponse([[0.1, 0.2, 0.3], [0.4, 0.5]]));
    const sleepState = makeSleep();

    await assert.rejects(
      () =>
        embedBatch(TEXTS, {
          accountId: ACCOUNT,
          apiToken: TOKEN,
          fetchImpl,
          sleep: sleepState.sleep,
          dim: SMALL_DIM,
        }),
      (error) => {
        assert.ok(error instanceof Error, 'expected an Error');
        assert.ok(
          error.message.includes(String(SMALL_DIM)),
          `expected the expected length ${SMALL_DIM} in the message, got: ${error.message}`,
        );
        assert.ok(
          error.message.includes('2'),
          `expected the actual length 2 in the message, got: ${error.message}`,
        );
        return true;
      },
    );

    assert.equal(calls.length, 1, 'a wrong-dimension response is a hard failure, never retried');
    assert.equal(sleepState.delays.length, 0, 'a wrong-dimension response must not sleep');
  });

  test('a wrong dimension is detected against the dim option, not only against DIM', async () => {
    const { fetchImpl } = makeFetch(() => okResponse([new Array(DIM).fill(0.1), new Array(DIM).fill(0.2)]));
    const { sleep } = makeSleep();

    await assert.rejects(() =>
      embedBatch(TEXTS, {
        accountId: ACCOUNT,
        apiToken: TOKEN,
        fetchImpl,
        sleep,
        dim: SMALL_DIM,
      }),
    );
  });

  test('fewer vectors than texts throws', async () => {
    const { fetchImpl } = makeFetch(() => okResponse([[0.1, 0.2, 0.3]]));
    const { sleep } = makeSleep();

    await assert.rejects(
      () =>
        embedBatch(TEXTS, {
          accountId: ACCOUNT,
          apiToken: TOKEN,
          fetchImpl,
          sleep,
          dim: SMALL_DIM,
        }),
      (error) => {
        assert.ok(error instanceof Error, 'expected an Error');
        return true;
      },
    );
  });

  test('more vectors than texts throws', async () => {
    const { fetchImpl } = makeFetch(() => okResponse([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6], [0.7, 0.8, 0.9]]));
    const { sleep } = makeSleep();

    await assert.rejects(() =>
      embedBatch(TEXTS, {
        accountId: ACCOUNT,
        apiToken: TOKEN,
        fetchImpl,
        sleep,
        dim: SMALL_DIM,
      }),
    );
  });
});

/* -------------------------------------------- DoD 3: the fail-soft embed loop */

describe('DoD 3: embedAllChunks keeps going past a failed batch and counts the failures', () => {
  /** `count` chunks, each identifiable by slug, spanning `Math.ceil(count / MAX_BATCH)` batches. */
  const chunksFor = (count) =>
    Array.from({ length: count }, (_, i) => ({
      id: `alpha/article-${i}#0`,
      slug: `alpha/article-${i}`,
      title: `Article ${i}`,
      heading: '',
      text: `body of chunk ${i}`,
    }));

  /** A stub embedder that fails the batches whose zero-based index is in `failAt`. */
  const embedderFailing = (failAt, calls = []) => {
    let batchIndex = 0;
    return async (texts) => {
      const index = batchIndex++;
      calls.push({ index, size: texts.length });
      if (failAt.includes(index)) throw new Error(`HTTP 500 after 4 attempts (batch ${index})`);
      return texts.map(() => Array.from({ length: DIM }, () => 0.5));
    };
  };

  test('a happy run returns one int8 vector per chunk and no failures', async () => {
    const chunks = chunksFor(5);
    const { vectors, failures } = await embedAllChunks({
      chunks,
      accountId: 'acct',
      apiToken: 'tok',
      embed: embedderFailing([]),
    });
    assert.equal(vectors.length, chunks.length);
    assert.deepEqual(failures, []);
    for (const vector of vectors) assert.ok(vector instanceof Int8Array);
  });

  test('a failed first batch does not stop the later batches from running', async () => {
    const calls = [];
    const chunks = chunksFor(MAX_BATCH * 3);
    const { failures } = await embedAllChunks({
      chunks,
      accountId: 'acct',
      apiToken: 'tok',
      embed: embedderFailing([0], calls),
    });
    assert.deepEqual(
      calls.map((c) => c.index),
      [0, 1, 2],
      'every batch must be attempted, so one run reports the whole failure picture',
    );
    assert.equal(failures.length, 1);
  });

  test('the failure record names the affected articles and the underlying message', async () => {
    const chunks = chunksFor(MAX_BATCH * 2);
    const { failures } = await embedAllChunks({
      chunks,
      accountId: 'acct',
      apiToken: 'tok',
      embed: embedderFailing([1]),
    });
    assert.equal(failures.length, 1);
    assert.equal(failures[0].firstChunk, MAX_BATCH);
    assert.equal(failures[0].chunkCount, MAX_BATCH);
    assert.deepEqual(failures[0].slugs, chunks.slice(MAX_BATCH).map((c) => c.slug));
    assert.match(failures[0].message, /HTTP 500/);
  });

  test('every failed batch is counted, not just the first', async () => {
    const chunks = chunksFor(MAX_BATCH * 3);
    const { vectors, failures } = await embedAllChunks({
      chunks,
      accountId: 'acct',
      apiToken: 'tok',
      embed: embedderFailing([0, 2]),
    });
    assert.equal(failures.length, 2);
    assert.equal(
      failures.reduce((n, f) => n + f.chunkCount, 0),
      MAX_BATCH * 2,
    );
    assert.equal(vectors.length, MAX_BATCH, 'only the surviving batch contributed vectors');
  });

  test('batches are exactly MAX_BATCH wide, with the remainder last', async () => {
    const calls = [];
    await embedAllChunks({
      chunks: chunksFor(MAX_BATCH * 2 + 7),
      accountId: 'acct',
      apiToken: 'tok',
      embed: embedderFailing([], calls),
    });
    assert.deepEqual(
      calls.map((c) => c.size),
      [MAX_BATCH, MAX_BATCH, 7],
    );
  });

  test('the credentials are handed to the embedder unchanged', async () => {
    let seen = null;
    await embedAllChunks({
      chunks: chunksFor(1),
      accountId: 'acct-1',
      apiToken: 'tok-1',
      embed: async (texts, options) => {
        seen = options;
        return texts.map(() => Array.from({ length: DIM }, () => 0.5));
      },
    });
    assert.equal(seen.accountId, 'acct-1');
    assert.equal(seen.apiToken, 'tok-1');
  });

  test('what is embedded is embedInput: title, heading and text', async () => {
    let sent = null;
    const chunk = { id: 'a#0', slug: 'a', title: 'Title', heading: 'Heading', text: 'Body text' };
    await embedAllChunks({
      chunks: [chunk],
      accountId: 'acct',
      apiToken: 'tok',
      embed: async (texts) => {
        sent = texts;
        return texts.map(() => Array.from({ length: DIM }, () => 0.5));
      },
    });
    assert.deepEqual(sent, [embedInput(chunk)]);
    assert.equal(sent[0], 'Title\nHeading\nBody text');
  });

  test('no chunks means no request and no failure', async () => {
    const calls = [];
    const { vectors, failures } = await embedAllChunks({
      chunks: [],
      accountId: 'acct',
      apiToken: 'tok',
      embed: embedderFailing([], calls),
    });
    assert.deepEqual(calls, []);
    assert.deepEqual(vectors, []);
    assert.deepEqual(failures, []);
  });
});

/* ------------------------------------------------- DoD 5: the coverage assertion */

describe('DoD 5: assertFullCoverage', () => {
  test('returns undefined when every entry has a chunkCount above zero', () => {
    const result = assertFullCoverage([
      { file: 'knowledge/AlphaCategory/first-article.md', chunkCount: 3 },
      { file: 'knowledge/AlphaCategory/second-article.md', chunkCount: 1 },
      { file: 'knowledge/BetaCategory/third-article.md', chunkCount: 12 },
    ]);
    assert.equal(result, undefined);
  });

  test('throws naming every zero-chunk file', () => {
    const perArticle = [
      { file: 'knowledge/AlphaCategory/first-article.md', chunkCount: 3 },
      { file: 'knowledge/AlphaCategory/empty-one.md', chunkCount: 0 },
      { file: 'knowledge/BetaCategory/third-article.md', chunkCount: 7 },
      { file: 'knowledge/BetaCategory/empty-two.md', chunkCount: 0 },
      { file: 'knowledge/BetaCategory/fifth-article.md', chunkCount: 2 },
    ];

    assert.throws(
      () => assertFullCoverage(perArticle),
      (error) => {
        assert.ok(error instanceof Error, 'expected an Error');
        for (const file of ['knowledge/AlphaCategory/empty-one.md', 'knowledge/BetaCategory/empty-two.md']) {
          assert.ok(
            error.message.includes(file),
            `expected the message to name ${file}, got: ${error.message}`,
          );
        }
        return true;
      },
    );
  });

  test('throws when a single entry has zero chunks', () => {
    assert.throws(
      () => assertFullCoverage([{ file: 'knowledge/AlphaCategory/only-one.md', chunkCount: 0 }]),
      (error) => {
        assert.ok(error.message.includes('knowledge/AlphaCategory/only-one.md'));
        return true;
      },
    );
  });
});

/* ------------------------------------------------------ DoD 5: the artifact */

describe('DoD 5: buildArtifact', () => {
  const chunks = [chunkRecord(0), chunkRecord(1)];
  const vectors = [l2normInt8(randomVector(21)), l2normInt8(randomVector(22))];
  const builtAt = '2026-08-05T00:00:00.000Z';
  const build = () => buildArtifact({ chunks, vectors, model: MODEL, builtAt });

  test('returns exactly the eight artifact keys', () => {
    assert.deepEqual(
      [...Object.keys(build())].sort(),
      ['builtAt', 'chunks', 'count', 'dim', 'model', 'quant', 'schema', 'vectors'],
    );
  });

  test('schema, dim and quant are the published constants', () => {
    const artifact = build();
    assert.equal(artifact.schema, SCHEMA);
    assert.equal(artifact.dim, DIM);
    assert.equal(artifact.quant, QUANT);
  });

  test('model and builtAt are the values passed in', () => {
    const artifact = buildArtifact({ chunks, vectors, model: 'other/model-name', builtAt });
    assert.equal(artifact.model, 'other/model-name');
    assert.equal(artifact.builtAt, builtAt);
  });

  test('count is chunks.length and chunks is the array passed in', () => {
    const artifact = build();
    assert.equal(artifact.count, chunks.length);
    assert.deepEqual(artifact.chunks, chunks);
  });

  test('vectors is the packVectors base64 string of the int8 vectors', () => {
    const artifact = build();
    assert.equal(typeof artifact.vectors, 'string');
    assert.equal(artifact.vectors, packVectors(vectors));
  });

  test('the packed vectors unpack back to the vectors passed in', () => {
    const decoded = unpackVectors(build().vectors, DIM);
    assert.equal(decoded.length, vectors.length);
    for (const [i, vector] of decoded.entries()) {
      assert.deepEqual([...vector], [...vectors[i]]);
    }
  });

  test('throws when chunks and vectors are not the same length', () => {
    assert.throws(() => buildArtifact({ chunks, vectors: vectors.slice(0, 1), model: MODEL, builtAt }));
    assert.throws(() =>
      buildArtifact({ chunks: chunks.slice(0, 1), vectors, model: MODEL, builtAt }),
    );
  });

  test('the artifact JSON-serializes and reparses to the same object', () => {
    const artifact = build();
    assert.deepEqual(JSON.parse(JSON.stringify(artifact)), artifact);
  });
});
