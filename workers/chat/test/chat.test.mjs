/**
 * LB-84 contract tests for the chat Worker public handler.
 *
 * The suite installs a small synthetic vector artifact before dynamically importing
 * the worker. It restores a pre-existing artifact byte-for-byte, or removes only the
 * artifact it created. No test reads the worker implementation source.
 */

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COUNT, PRUNE, RECORD, RELEASE, createD1Stub } from './d1-stub.mjs';
import {
  ALLOWED_ORIGIN,
  CLIENT_IP,
  DEFAULT_LIMIT,
  DEFAULT_WINDOW,
  MAX_BODY_BYTES,
  OMIT,
  OTHER_ORIGIN,
  SALT,
  SITE_NAME,
  assertCors,
  assertValidationError,
  createAiStub,
  expectedIpHash,
  jsonBodyOfBytes,
  makeEnv,
  makeRequest,
  postJson,
  streamingBody,
  validPayload,
} from './helpers.mjs';

// The fixture is deliberately NOT named vectors.json: both machine gates skip that
// basename, so a fixture carrying it would be scanned by nobody. This name is what
// makes DoD 8's "synthetic, place-free" property machine-checked.
const fixturePath = fileURLToPath(
  new URL('./fixtures/corpus-vectors.fixture.json', import.meta.url),
);
const artifactPath = fileURLToPath(new URL('../vectors.json', import.meta.url));
const fixtureBytes = readFileSync(fixturePath);
const originalArtifact = existsSync(artifactPath) ? readFileSync(artifactPath) : null;
mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(artifactPath, fixtureBytes);

let cleaned = false;
const originalAtob = globalThis.atob;
const fixtureBase64 = JSON.parse(fixtureBytes.toString('utf8')).vectors;
let fixtureDecodeCalls = 0;
globalThis.atob = function countedAtob(value) {
  if (value === fixtureBase64) fixtureDecodeCalls += 1;
  return originalAtob.call(this, value);
};

function cleanupArtifact() {
  if (cleaned) return;
  cleaned = true;
  globalThis.atob = originalAtob;
  if (originalArtifact === null) rmSync(artifactPath, { force: true });
  else writeFileSync(artifactPath, originalArtifact);
}

process.once('exit', cleanupArtifact);
after(cleanupArtifact);

// A developer's real artifact is gitignored, so a leaked synthetic copy is invisible to
// `git status` and would be bundled by the next deploy. 'exit' does not run on a signal.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    cleanupArtifact();
    process.exit(130);
  });
}

const workerModule = await import('../src/index.mjs');
const { CHAT_MODEL, EMBED_MODEL, REFUSAL_SENTENCE, SQL, handleRequest, default: worker } = workerModule;

// The fixture's six chunks are unit vectors chosen to rank strictly against the
// default query [10, 0, 0]: alpha 1.000, bravo 0.898, charlie 0.709, delta 0.504,
// echo 0.197, foxtrot -1.000. Two cutoffs matter, so both are named here.
//
// RANKED_* is the top-k selection with no floor: five chunks, foxtrot excluded
// because it is sixth. FLOORED_* is what survives the shipped 0.46 default, which
// additionally drops echo. A test asserts against whichever contract it is about.
const RANKED_TITLES = ['Alpha Guide', 'Bravo Guide', 'Charlie Guide', 'Delta Guide', 'Echo Guide'];
const RANKED_URLS = ['/guides/alpha', '/guides/bravo', '/guides/charlie', '/guides/delta', '/guides/echo'];
const FLOORED_TITLES = RANKED_TITLES.slice(0, 4);
const FLOORED_URLS = RANKED_URLS.slice(0, 4);
const citationsOf = (titles, urls) => titles.map((title, index) => ({ title, url: urls[index] }));

async function accepted(overrides = {}, payload = validPayload()) {
  const setup = makeEnv(SQL, overrides);
  const response = await handleRequest(postJson(payload), setup.env);
  return { ...setup, response };
}

async function errorShape(response, status) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(typeof body.error, 'string');
  assert.ok(body.error.length > 0);
  return body;
}

describe('public module and model contract', () => {
  test('exports the pinned chat and embedding models, SQL, handleRequest, and default fetch', () => {
    assert.equal(CHAT_MODEL, '@cf/zai-org/glm-4.7-flash');
    assert.equal(EMBED_MODEL, '@cf/baai/bge-m3');
    assert.equal(typeof SQL, 'object');
    assert.equal(typeof handleRequest, 'function');
    assert.equal(typeof worker, 'object');
    assert.equal(typeof worker.fetch, 'function');
    for (const key of ['RATE_LIMIT_PRUNE', 'RATE_LIMIT_RECORD', 'RATE_LIMIT_COUNT', 'RATE_LIMIT_RELEASE']) {
      assert.equal(typeof SQL[key], 'string', `SQL.${key} must be a string`);
      assert.ok(SQL[key].length > 0, `SQL.${key} must not be empty`);
    }
  });

  test('default fetch exposes the same successful handler path', async () => {
    const { env } = makeEnv(SQL);
    const response = await worker.fetch(postJson(validPayload()), env, {});
    assert.equal(response.status, 200);
    assertCors(response);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
  });
});

describe('retrieval, prompting, and SSE', () => {
  test('embeds with EMBED_MODEL and {text:[message]}, retrieves top 5 by normalized dot product, and prompts every selected chunk', async () => {
    const message = 'Which guide best matches this question?';
    const history = [
      { role: 'user', content: 'turn zero' },
      { role: 'assistant', content: 'turn one' },
      { role: 'user', content: 'turn two' },
      { role: 'assistant', content: 'turn three' },
      { role: 'user', content: 'turn four' },
      { role: 'assistant', content: 'turn five' },
    ];
    const AI = createAiStub({ query: [10, 0, 0] });
    // Floor disabled, so this stays a test of top-k selection alone: all five
    // ranked chunks are prompted and foxtrot is excluded for being sixth, not for
    // being below a threshold. The floor has its own suite below.
    const { response } = await accepted({ AI, RELEVANCE_FLOOR: '0' }, { message, history });

    assert.equal(response.status, 200);
    assert.equal(AI.calls.length, 2);
    assert.equal(AI.calls[0].model, EMBED_MODEL);
    assert.deepEqual(AI.calls[0].input, { text: [message] });

    assert.equal(AI.calls[1].model, CHAT_MODEL);
    assert.equal(AI.calls[1].input.stream, true);
    const messages = AI.calls[1].input.messages;
    assert.deepEqual(messages.slice(1, -1), history.slice(-4), 'only the last four history entries belong in the prompt');
    assert.deepEqual(messages.at(-1), { role: 'user', content: message });
    assert.equal(messages[0].role, 'system');
    const systemPrompt = messages[0].content;
    for (let index = 0; index < RANKED_TITLES.length; index += 1) {
      assert.ok(systemPrompt.includes(RANKED_TITLES[index]), `missing title ${RANKED_TITLES[index]}`);
      assert.ok(systemPrompt.includes(RANKED_URLS[index]), `missing URL ${RANKED_URLS[index]}`);
    }
    assert.equal(systemPrompt.includes('Foxtrot Guide'), false, 'the sixth-ranked chunk must not be prompted');
    assert.ok(systemPrompt.includes(SITE_NAME), 'the system prompt must identify the configured site');
    assert.match(systemPrompt, /only/i, 'the system prompt must restrict answers to supplied context');
    assert.match(systemPrompt, /context|excerpt/i, 'the system prompt must identify the supplied context');
    assert.match(systemPrompt, /cite/i, 'the system prompt must require citations');
    assert.match(systemPrompt, /url/i, 'the system prompt must require source article URLs');
    assert.match(
      systemPrompt,
      /brows/i,
      `the unsure path must suggest browsing, got ${JSON.stringify(systemPrompt)}`,
    );
    // LB-90: the unsure path is the with-context twin of the no-context refusal and
    // was written in the same imperative shape, so it gets the same guard before it
    // is observed failing rather than after.
    assert.ok(
      systemPrompt.includes(REFUSAL_SENTENCE(SITE_NAME)),
      `the unsure path must supply the exact refusal sentence, got ${JSON.stringify(systemPrompt)}`,
    );
    assert.equal(
      systemPrompt.includes('and suggest browsing'),
      false,
      'no subjectless imperative fragment may sit where a parroting model can emit it',
    );
  });

  // The QR flow's safety property. A `hint` arrives from `/chat?ctx=<slug>`, which is
  // a URL any stranger can retype, so it is allowed to move the query vector and
  // nothing else: reaching the prompt would make a scanned link a way to write
  // instructions into the model's context ("ignore the excerpts", "you may guess").
  // Both halves are asserted, because only the first one passing is the bug.
  test('a hint is appended to the embedded query text and never reaches the prompt', async () => {
    const message = 'What is worth seeing here?';
    const hint = 'the north dock and the water around it';
    const AI = createAiStub({ query: [10, 0, 0] });
    const { response } = await accepted({ AI }, { message, history: [], hint });

    assert.equal(response.status, 200);
    assert.equal(AI.calls[0].model, EMBED_MODEL);
    assert.deepEqual(
      AI.calls[0].input,
      { text: [`${message} ${hint}`] },
      'the hint must ride the text that gets embedded',
    );

    const generation = JSON.stringify(AI.calls[1].input);
    assert.equal(
      generation.includes(hint),
      false,
      `the hint must not appear anywhere in the generation call: ${generation}`,
    );
    assert.deepEqual(
      AI.calls[1].input.messages.at(-1),
      { role: 'user', content: message },
      'the model sees the reader\'s question, not the question plus the hint',
    );
  });

  test('an absent, blank, or whitespace-only hint leaves the embedded text exactly the message', async () => {
    const message = 'What is worth seeing here?';
    for (const hint of [undefined, '', '   ']) {
      const AI = createAiStub({ query: [10, 0, 0] });
      const payload = { message, history: [] };
      if (hint !== undefined) payload.hint = hint;
      const { response } = await accepted({ AI }, payload);
      assert.equal(response.status, 200);
      assert.deepEqual(
        AI.calls[0].input,
        { text: [message] },
        `hint ${JSON.stringify(hint)} must not pad the embedded text`,
      );
    }
  });

  test('passes upstream data frames, removes [DONE], and ends with citations for every prompted chunk', async () => {
    const AI = createAiStub({
      streamParts: ['data: {"response":"Guide "}\n', '\ndata: {"response":"answer"}\n\n', 'data: [DONE]\n\n'],
    });
    const { response } = await accepted({ AI });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    const body = await response.text();

    assert.ok(
      body.includes('data: {"response":"Guide "}\n\n'),
      `first upstream frame was not preserved: ${JSON.stringify(body)}`,
    );
    assert.ok(
      body.includes('data: {"response":"answer"}\n\n'),
      `second upstream frame was not preserved: ${JSON.stringify(body)}`,
    );
    assert.equal(body.includes('[DONE]'), false, 'the upstream terminal marker must not reach the client');
    assert.match(body, /event: citations\ndata: .+\n\n$/, 'citations must remain the final event');
  });

  test('an upstream that ends without a blank line still yields a separate citations frame', async () => {
    const AI = createAiStub({ streamParts: ['data: {"response":"tail"}'] });
    const { response } = await accepted({ AI });
    const body = await response.text();
    assert.match(
      body,
      /^data: \{"response":"tail"\}\n\nevent: citations\ndata: .+\n\n$/,
      `the trailing partial frame must be terminated, got ${JSON.stringify(body)}`,
    );
  });

  test('final citations contain exactly title and URL for every prompted chunk', async () => {
    // Default env, so the shipped floor applies: the payload must track what
    // actually reached the prompt, not the pre-floor ranking.
    const { response } = await accepted();
    const body = await response.text();
    const finalFrame = body.match(/event: citations\ndata: (.+)\n\n$/);
    assert.ok(finalFrame, `expected a final citations event, got ${JSON.stringify(body)}`);
    assert.deepEqual(JSON.parse(finalFrame[1]), {
      citations: citationsOf(FLOORED_TITLES, FLOORED_URLS),
    });
  });

  test('decodes the base64 vector artifact once across two handler invocations', async () => {
    const first = await accepted();
    const second = await accepted();
    assert.equal(first.response.status, 200);
    assert.equal(second.response.status, 200);
    await first.response.text();
    await second.response.text();
    assert.equal(fixtureDecodeCalls, 1, 'the fixture base64 must be decoded once in module-global state');
  });
});

/*
 * The relevance floor exists so that "the corpus cannot answer this" is expressible.
 * Top-k alone always returns k chunks, so a question with no support still cites the
 * k least-bad matches -- which is a fabricated source list wearing a real URL.
 *
 * Reading the fixture scores (see RANKED_TITLES): a floor between 0.198 and 0.504
 * drops echo only; above 1.0 drops everything. Both boundaries are exercised.
 */
describe('relevance floor', () => {
  async function citationsFrom(response) {
    const body = await response.text();
    const frame = body.match(/event: citations\ndata: (.+)\n\n$/);
    assert.ok(frame, `expected a final citations event, got ${JSON.stringify(body)}`);
    return JSON.parse(frame[1]).citations;
  }

  test('the shipped default drops a chunk below it and keeps the rest', async () => {
    const { response } = await accepted();
    assert.deepEqual(await citationsFrom(response), citationsOf(FLOORED_TITLES, FLOORED_URLS));
  });

  test('RELEVANCE_FLOOR overrides the default', async () => {
    // 0.8 admits alpha (1.000) and bravo (0.898); charlie (0.709) is the first cut.
    const { response } = await accepted({ RELEVANCE_FLOOR: '0.8' });
    assert.deepEqual(await citationsFrom(response), citationsOf(RANKED_TITLES.slice(0, 2), RANKED_URLS.slice(0, 2)));
  });

  // An orthogonal query rather than an impossible floor: every fixture chunk lies in
  // the first two dimensions, so a third-dimension query scores 0.000 against all of
  // them. That is the real shape of the case this exists for -- a question the corpus
  // has nothing to say about -- and it exercises the shipped default rather than a
  // value tuned to defeat the fixture.
  const ORTHOGONAL_QUERY = [0, 0, 10];

  test('a query nothing clears yields an empty citation payload and still streams', async () => {
    const { response } = await accepted({ AI: createAiStub({ query: ORTHOGONAL_QUERY }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    assert.deepEqual(await citationsFrom(response), []);
  });

  test('with nothing retrieved the prompt carries no excerpt and instructs a refusal', async () => {
    const AI = createAiStub({ query: ORTHOGONAL_QUERY });
    await accepted({ AI });
    const systemPrompt = AI.calls[1].input.messages[0].content;
    for (const url of RANKED_URLS) {
      assert.equal(systemPrompt.includes(url), false, `no excerpt may be prompted, found ${url}`);
    }
    assert.match(systemPrompt, /not.*(cover|relevant)|no excerpt/i, 'the prompt must state the corpus does not cover it');
    assert.match(systemPrompt, /brows/i, 'the prompt must suggest browsing');
    assert.match(systemPrompt, /not cite|do not cite/i, 'the prompt must forbid citing anything');
    assert.ok(systemPrompt.includes(SITE_NAME), 'the prompt must still identify the configured site');
  });

  // LB-90: the refusal used to be described to the model in the imperative, and the
  // deployed model dropped the leading verb and emitted the remainder as its answer --
  // a second clause with no subject, reaching readers as broken English. The prompt
  // must therefore carry the refusal as a sentence that survives being copied
  // verbatim, and must carry no imperative that reads as an answer when it is.
  test('the no-context prompt supplies the refusal sentence instead of commanding one', async () => {
    const AI = createAiStub({ query: ORTHOGONAL_QUERY });
    await accepted({ AI });
    const systemPrompt = AI.calls[1].input.messages[0].content;

    assert.equal(
      systemPrompt.includes('Say that the knowledge base does not cover it'),
      false,
      'the imperative the model parroted must not be in the prompt',
    );
    assert.equal(
      systemPrompt.includes('and suggest browsing'),
      false,
      'no subjectless imperative fragment may sit where a parroting model can emit it',
    );
    assert.ok(
      systemPrompt.includes(REFUSAL_SENTENCE(SITE_NAME)),
      `the prompt must supply the exact refusal sentence, got ${JSON.stringify(systemPrompt)}`,
    );
  });

  test('a floor of 0 disables filtering and restores plain top-k', async () => {
    const { response } = await accepted({ RELEVANCE_FLOOR: '0' });
    assert.deepEqual(await citationsFrom(response), citationsOf(RANKED_TITLES, RANKED_URLS));
  });

  // A mistyped tuning var must not take chat down, and must not silently become a
  // permissive floor either: every unusable value falls back to the shipped default.
  for (const [label, value] of [
    ['blank', ''],
    ['whitespace', '   '],
    ['non-numeric', 'strict'],
    ['negative', '-0.5'],
    ['above one', '1.5'],
  ]) {
    test(`a ${label} RELEVANCE_FLOOR falls back to the default`, async () => {
      const { response } = await accepted({ RELEVANCE_FLOOR: value });
      assert.deepEqual(await citationsFrom(response), citationsOf(FLOORED_TITLES, FLOORED_URLS));
    });
  }
});

/*
 * The two ways the machinery under the answer fails: a vector artifact the worker
 * cannot use, and an upstream inference call that does not return. Both must reach
 * the caller as a described 503 rather than a bare runtime 500.
 */
describe('artifact and upstream failures', () => {
  for (const mismatch of ['model', 'dim']) {
    test(`returns 503 and names the artifact ${mismatch} mismatch`, () => {
      const runner = fileURLToPath(new URL('./artifact-case.mjs', import.meta.url));
      const result = spawnSync(process.execPath, [runner, mismatch], {
        encoding: 'utf8',
        cwd: fileURLToPath(new URL('../../..', import.meta.url)),
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const output = JSON.parse(result.stdout);
      assert.equal(output.status, 503);
      const text = output.body.toLowerCase();
      assert.match(
        text,
        /mismatch|does not match|incompatible/,
        `response must name the incompatibility: ${output.body}`,
      );
      if (mismatch === 'model') assert.ok(text.includes('model'), `response must name model: ${output.body}`);
      else assert.match(text, /dim|dimension/, `response must name dimension: ${output.body}`);
    });
  }

  // An AI outage and a corrupt artifact are different operator problems. Reporting the
  // first as the second sends whoever is on the deploy after an artifact that is fine.
  test('an embedding call failure is 503 with CORS, and is not reported as an artifact mismatch', async () => {
    const AI = {
      calls: [],
      async run(model) {
        if (model === EMBED_MODEL) throw new Error('inference upstream refused the request');
        throw new Error('generation must not be reached');
      },
    };
    const { response } = await accepted({ AI });
    const body = await errorShape(response, 503);
    assertCors(response);
    assert.notEqual(body.error, 'query_embedding_incompatible', 'an outage is not a mismatch');
  });

  test('a generation failure is 503 with CORS and an {error} body, never a bare runtime 500', async () => {
    const AI = createAiStub({
      onRun(model) {
        if (model === CHAT_MODEL) throw new Error('daily neuron allocation exhausted');
      },
    });
    const { response } = await accepted({ AI });
    await errorShape(response, 503);
    assertCors(response);
  });
});

describe('CORS and method handling', () => {
  test('allowed OPTIONS returns the exact 204 preflight contract without touching D1 or AI', async () => {
    const { DB, AI, env } = makeEnv(SQL);
    const response = await handleRequest(makeRequest({ method: 'OPTIONS', contentType: OMIT }), env);
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
    assert.equal(response.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
    assert.equal(response.headers.get('access-control-allow-headers'), 'Content-Type');
    assert.equal(response.headers.get('vary'), 'Origin');
    assert.deepEqual(
      [...response.headers.keys()].filter((name) => name.startsWith('access-control-')).sort(),
      ['access-control-allow-headers', 'access-control-allow-methods', 'access-control-allow-origin'],
    );
    assert.equal(DB.touched, false);
    assert.equal(AI.calls.length, 0);
  });

  test('an unset, missing, or mismatched origin is 403 and never receives wildcard CORS', async () => {
    const cases = [
      { request: postJson(validPayload(), { origin: OTHER_ORIGIN }), env: {} },
      { request: postJson(validPayload(), { origin: OMIT }), env: {} },
      { request: postJson(validPayload()), env: { ALLOWED_ORIGIN: OMIT } },
      { request: makeRequest({ method: 'OPTIONS', contentType: OMIT }), env: { ALLOWED_ORIGIN: OMIT } },
    ];
    for (const item of cases) {
      const { DB, AI, env } = makeEnv(SQL, item.env);
      const response = await handleRequest(item.request, env);
      assert.equal(response.status, 403);
      assert.notEqual(response.headers.get('access-control-allow-origin'), '*');
      assert.equal(response.headers.get('access-control-allow-origin'), null);
      assert.equal(DB.touched, false);
      assert.equal(AI.calls.length, 0);
    }
  });

  test('every method other than POST and OPTIONS returns 405', async () => {
    for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE']) {
      const { DB, AI, env } = makeEnv(SQL);
      const response = await handleRequest(makeRequest({ method, contentType: OMIT }), env);
      await errorShape(response, 405);
      assertCors(response);
      assert.equal(DB.touched, false);
      assert.equal(AI.calls.length, 0);
    }
  });
});

describe('request validation', () => {
  async function reject(request, expectedField) {
    const { DB, AI, env } = makeEnv(SQL);
    const response = await handleRequest(request, env);
    await assertValidationError(response, expectedField);
    assert.equal(DB.touched, false, 'validation failures must not spend a rate-limit slot');
    assert.equal(AI.calls.length, 0, 'validation failures must not call AI');
  }

  test('rejects media types other than application/json, while accepting a charset parameter', async () => {
    for (const contentType of ['text/plain', 'application/jsonp', 'text/json', 'application/x-www-form-urlencoded']) {
      await reject(postJson(validPayload(), { contentType }), 'content-type');
    }
    const { response } = await accepted({}, validPayload());
    assert.equal(response.status, 200);
    const setup = makeEnv(SQL);
    const charset = await handleRequest(
      postJson(validPayload(), { contentType: 'application/json; charset=utf-8' }),
      setup.env,
    );
    assert.equal(charset.status, 200);
  });

  test('rejects declared and streamed bodies over 32768 bytes, and accepts exactly 32768 bytes', async () => {
    await reject(
      makeRequest({ body: validPayload(), headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) } }),
      'body',
    );
    await reject(makeRequest({ body: jsonBodyOfBytes(MAX_BODY_BYTES + 1) }), 'body');

    const { stream, state } = streamingBody(1024, 4096);
    await reject(makeRequest({ body: stream, headers: { 'Content-Length': OMIT } }), 'body');
    assert.ok(state.pulled <= Math.ceil(MAX_BODY_BYTES / 1024) + 1, 'oversized stream must be abandoned at the ceiling');

    const setup = makeEnv(SQL);
    const exact = await handleRequest(makeRequest({ body: jsonBodyOfBytes(MAX_BODY_BYTES) }), setup.env);
    assert.equal(exact.status, 200, 'the exact byte ceiling must remain accepted');
  });

  test('rejects malformed JSON and JSON values that are not objects', async () => {
    for (const body of ['{bad json', '', 'null', '[]', 'true', '42', '"text"']) {
      await reject(makeRequest({ body }), 'body');
    }
  });

  test('rejects missing, non-string, blank, one-character, and over-1000 messages', async () => {
    for (const message of [OMIT, null, 3, {}, [], '', '   ', 'x', 'x'.repeat(1001)]) {
      await reject(postJson(validPayload({ message })), 'message');
    }
  });

  test('accepts message lengths 2 and 1000 exactly', async () => {
    for (const message of ['xy', 'x'.repeat(1000)]) {
      const { response } = await accepted({}, validPayload({ message }));
      assert.equal(response.status, 200, `message length ${message.length} must be accepted`);
    }
  });

  test('rejects a non-string hint and one over 200 characters', async () => {
    for (const hint of [3, {}, [], true, 'x'.repeat(201)]) {
      await reject(postJson(validPayload({ hint })), 'hint');
    }
  });

  test('accepts an absent, null, empty, and exactly-200-character hint', async () => {
    for (const hint of [OMIT, null, '', 'x'.repeat(200)]) {
      const { response } = await accepted({}, validPayload({ hint }));
      assert.equal(response.status, 200, `hint ${JSON.stringify(hint)} must be accepted`);
    }
  });

  test('rejects history when missing, not an array, or longer than 20 entries', async () => {
    for (const history of [OMIT, null, {}, 'history', 4, Array(21).fill({ role: 'user', content: 'entry' })]) {
      await reject(postJson(validPayload({ history })), 'history');
    }
  });

  test('rejects history entries with missing, non-string, or blank role or content', async () => {
    const invalid = [
      {},
      { role: 'user' },
      { content: 'entry' },
      { role: null, content: 'entry' },
      { role: 7, content: 'entry' },
      { role: '', content: 'entry' },
      { role: '   ', content: 'entry' },
      { role: 'user', content: null },
      { role: 'user', content: 7 },
      { role: 'user', content: '' },
      { role: 'user', content: '   ' },
    ];
    for (const entry of invalid) await reject(postJson(validPayload({ history: [entry] })), /^history(?:\[|$)/);
  });

  test('accepts exactly 20 valid history entries and forwards only the final four', async () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `history entry ${index}`,
    }));
    const AI = createAiStub();
    const { response } = await accepted({ AI }, validPayload({ history }));
    assert.equal(response.status, 200);
    assert.deepEqual(AI.calls[1].input.messages.slice(1, -1), history.slice(-4));
  });

  test('missing IP_HASH_SALT is a hard 500 before hashing, D1, or AI', async () => {
    const { DB, AI, env } = makeEnv(SQL, { IP_HASH_SALT: OMIT });
    const response = await handleRequest(postJson(validPayload()), env);
    await errorShape(response, 500);
    assertCors(response);
    assert.equal(DB.touched, false);
    assert.equal(AI.calls.length, 0);
  });
});

describe('salted rolling D1 rate limit', () => {
  test('default 20/3600 accepts the twentieth request and rejects the twenty-first with Retry-After', async () => {
    const DB = createD1Stub(SQL);
    const AI = createAiStub();
    const env = { DB, AI, ALLOWED_ORIGIN, SITE_NAME, IP_HASH_SALT: SALT };

    for (let number = 1; number <= DEFAULT_LIMIT; number += 1) {
      const response = await handleRequest(postJson(validPayload()), env);
      assert.equal(response.status, 200, `request ${number} must be accepted`);
    }
    const rejected = await handleRequest(postJson(validPayload()), env);
    assert.equal(rejected.status, 429);
    assert.match(rejected.headers.get('retry-after'), /^\d+$/);
    assert.ok(Number(rejected.headers.get('retry-after')) >= 1);
    assertCors(rejected);

    const ipHash = await expectedIpHash();
    assert.equal(DB.usage(ipHash).total, DEFAULT_LIMIT, 'the rejected request must release its slot');
    assert.ok(DB.callsOf(RELEASE).length > 0, 'a 429 must issue the release statement');
    const lastPrune = DB.callsOf(PRUNE).at(-1).args;
    const lastRecord = DB.callsOf(RECORD).at(-1).args;
    assert.equal(lastRecord[1] - lastPrune[1], DEFAULT_WINDOW, 'the default rolling window is 3600 seconds');
  });

  test('configured max and rolling window replace the defaults at exact boundaries', async () => {
    const DB = createD1Stub(SQL);
    const ipHash = await expectedIpHash();
    const now = Math.floor(Date.now() / 1000);
    DB.seed(ipHash, { window_start: now - 59, count: 2 });
    const env = {
      DB,
      AI: createAiStub(),
      ALLOWED_ORIGIN,
      SITE_NAME,
      IP_HASH_SALT: SALT,
      RATE_LIMIT_MAX: '2',
      RATE_LIMIT_WINDOW_SECONDS: '60',
    };
    const response = await handleRequest(postJson(validPayload()), env);
    assert.equal(response.status, 429);
    const [, floor] = DB.callsOf(PRUNE).at(-1).args;
    const [, boundNow] = DB.callsOf(RECORD).at(-1).args;
    assert.equal(boundNow - floor, 60);
    assert.equal(DB.usage(ipHash).total, 2);
  });

  test('only entries aged out of the rolling window stop counting', async () => {
    const DB = createD1Stub(SQL);
    const ipHash = await expectedIpHash();
    const now = Math.floor(Date.now() / 1000);
    DB.seed(
      ipHash,
      { window_start: now - DEFAULT_WINDOW, count: 1 },
      { window_start: now - 1, count: DEFAULT_LIMIT - 1 },
    );
    const env = { DB, AI: createAiStub(), ALLOWED_ORIGIN, SITE_NAME, IP_HASH_SALT: SALT };
    const response = await handleRequest(postJson(validPayload()), env);
    assert.equal(response.status, 200, 'the exact-floor entry is pruned and frees one slot');
    assert.equal(DB.usage(ipHash).total, DEFAULT_LIMIT);
  });

  test('D1 receives only sha256(IP + salt), never the raw client IP', async () => {
    const { DB, response } = await accepted();
    assert.equal(response.status, 200);
    const expected = await expectedIpHash(CLIENT_IP, SALT);
    for (const call of DB.calls) {
      assert.equal(call.args[0], expected);
      assert.equal(call.args.some((value) => String(value).includes(CLIENT_IP)), false);
    }
    assert.deepEqual(DB.calls.map((call) => call.kind), [PRUNE, RECORD, COUNT]);
  });
});
