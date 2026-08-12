/**
 * Shared fixtures and assertions for the feedback worker contract tests.
 *
 * Nothing here reads the worker implementation: every constant comes from the LB-69
 * public interface contract. All fixture data is generic (RFC 5737 documentation IPs,
 * RFC 2606 `.invalid` hostnames, `/guides/example/` paths) so the genericity and
 * English-only gates stay green over `workers/`.
 */

import assert from 'node:assert/strict';

export const ALLOWED_ORIGIN = 'https://kb.example.invalid';
export const OTHER_ORIGIN = 'https://other.example.invalid';
export const WORKER_URL = 'https://feedback.example.invalid/submit';
export const SALT = 'contract-test-salt-0123456789';
export const OTHER_SALT = 'contract-test-salt-9876543210';
export const CLIENT_IP = '203.0.113.7';
export const OTHER_CLIENT_IP = '198.51.100.22';
export const USER_AGENT = 'contract-test-agent/1.0';

/** Contract limits (LB-69 validation table). */
export const MAX_BODY_BYTES = 8192;
export const MAX_PAGE = 200;
export const MAX_CATEGORY = 64;
export const MIN_MESSAGE = 10;
export const MAX_MESSAGE = 4000;
export const MAX_CONTACT = 200;
export const DEFAULT_RATE_LIMIT_MAX = 5;
export const DEFAULT_WINDOW_SECONDS = 3600;

/** Sentinel: pass as a value to omit that key entirely. */
export const OMIT = Symbol('omit');

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const HEX_SHA256 = /^[0-9a-f]{64}$/;

function stripOmitted(object) {
  const out = {};
  for (const [key, value] of Object.entries(object)) {
    if (value !== OMIT) out[key] = value;
  }
  return out;
}

/** A payload that passes every validation class; override or OMIT any field. */
export function validPayload(overrides = {}) {
  return stripOmitted({
    page: '/guides/example/',
    category: 'correction',
    message: 'The opening hours listed here look out of date.',
    ...overrides,
  });
}

/**
 * Build a Request against the worker.
 *
 * @param {object} [options]
 * @param {string} [options.method] default 'POST'
 * @param {string|null|symbol} [options.origin] Origin header; OMIT/null to drop it
 * @param {object|string} [options.body] object is JSON-stringified; string is sent as-is
 * @param {string|symbol} [options.contentType] Content-Type header; OMIT to drop it
 * @param {string|symbol} [options.ip] CF-Connecting-IP header; OMIT to drop it
 * @param {string|symbol} [options.userAgent] User-Agent header; OMIT to drop it
 * @param {Record<string,string>} [options.headers] extra headers, applied last
 */
export function makeRequest(options = {}) {
  const {
    method = 'POST',
    origin = ALLOWED_ORIGIN,
    body,
    contentType = 'application/json',
    ip = CLIENT_IP,
    userAgent = USER_AGENT,
    headers: extraHeaders = {},
    url = WORKER_URL,
  } = options;

  const headers = new Headers();
  if (origin !== OMIT && origin !== null && origin !== undefined) headers.set('Origin', origin);
  if (contentType !== OMIT && contentType !== null) headers.set('Content-Type', contentType);
  if (ip !== OMIT && ip !== null) headers.set('CF-Connecting-IP', ip);
  if (userAgent !== OMIT && userAgent !== null) headers.set('User-Agent', userAgent);
  for (const [name, value] of Object.entries(extraHeaders)) {
    if (value === OMIT) headers.delete(name);
    else headers.set(name, value);
  }

  const init = { method, headers };
  const methodAllowsBody = method !== 'GET' && method !== 'HEAD';
  if (body !== undefined && methodAllowsBody) {
    if (body instanceof ReadableStream) {
      // A streamed body carries no Content-Length, which is the case the worker must
      // survive without buffering. `duplex: 'half'` is required for a stream body.
      init.body = body;
      init.duplex = 'half';
    } else {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
  }
  return new Request(url, init);
}

/**
 * A chunked body with no Content-Length, for the streamed-upload case.
 *
 * `pulled` counts the chunks the consumer actually asked for, so a test can prove the
 * worker stopped reading rather than draining the whole upload into memory.
 *
 * @param {number} chunkBytes size of each chunk
 * @param {number} chunkCount how many chunks the client is willing to send
 */
export function streamingBody(chunkBytes, chunkCount) {
  const state = { pulled: 0 };
  const chunk = new TextEncoder().encode('x'.repeat(chunkBytes));
  const stream = new ReadableStream({
    pull(controller) {
      if (state.pulled >= chunkCount) {
        controller.close();
        return;
      }
      state.pulled += 1;
      controller.enqueue(chunk.slice());
    },
  });
  return { stream, state };
}

/** POST a payload object with everything else at its default. */
export function postJson(payload, options = {}) {
  return makeRequest({ method: 'POST', body: payload, ...options });
}

/** Build an env; pass OMIT for a key to leave it unset. */
export function makeEnv(overrides = {}) {
  return stripOmitted({
    ALLOWED_ORIGIN,
    IP_HASH_SALT: SALT,
    ...overrides,
  });
}

/** Lowercase hex sha256, the hash the contract specifies for the client IP. */
export async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The ip hash the worker must bind for a given IP and salt. */
export function expectedIpHash(ip, salt = SALT) {
  return sha256Hex(`${ip}${salt}`);
}

/** Read a JSON response body, failing with the raw text when it is not JSON. */
export async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    assert.fail(`expected a JSON body, got: ${JSON.stringify(text.slice(0, 200))}`);
  }
}

/** Every non-403 response echoes the single allowed origin and varies on Origin. */
export function assertCorsHeaders(response, origin = ALLOWED_ORIGIN) {
  const allowOrigin = response.headers.get('access-control-allow-origin');
  assert.notEqual(allowOrigin, '*', 'Access-Control-Allow-Origin must never be the wildcard');
  assert.equal(allowOrigin, origin, 'Access-Control-Allow-Origin must echo env.ALLOWED_ORIGIN');
  assert.equal(response.headers.get('vary'), 'Origin', 'Vary: Origin must be set');
}

/** Every JSON response declares application/json. */
export function assertJsonContentType(response) {
  const contentType = response.headers.get('content-type') ?? '';
  assert.equal(
    contentType.split(';')[0].trim(),
    'application/json',
    `expected Content-Type: application/json, got ${JSON.stringify(contentType)}`,
  );
}

/** Assert a success-shaped body: exactly { ok: true, id: <uuid v4> }. */
export async function assertSuccessBody(response) {
  assertJsonContentType(response);
  const body = await readJson(response);
  assert.deepEqual(Object.keys(body).sort(), ['id', 'ok'], `unexpected success body keys: ${JSON.stringify(body)}`);
  assert.equal(body.ok, true);
  assert.match(body.id, UUID_V4, 'id must be a crypto.randomUUID() value');
  return body;
}

/** Assert an error body of exactly { error } or { error, field }. */
export async function assertErrorBody(response, error, field) {
  assertJsonContentType(response);
  const body = await readJson(response);
  const expected = field === undefined ? { error } : { error, field };
  assert.deepEqual(body, expected);
  return body;
}

/**
 * Temporarily count crypto.subtle.digest calls. Used to prove the worker hashes
 * nothing when the salt is missing.
 */
export function spyOnDigest() {
  const subtle = crypto.subtle;
  const original = subtle.digest;
  const calls = [];
  subtle.digest = function patchedDigest(...args) {
    calls.push(args);
    return original.apply(this, args);
  };
  return {
    calls,
    restore() {
      delete subtle.digest;
      if (subtle.digest !== original) subtle.digest = original;
    },
  };
}

/**
 * Freeze `Date.now()` and drive it by hand, whole seconds at a time.
 *
 * A rolling window is only observable by moving time, so asserting that a client
 * which waits out `Retry-After` is let back in requires controlling the clock rather
 * than seeding around the real one.
 */
export function installClock(startSeconds = Math.floor(Date.now() / 1000)) {
  const original = Date.now;
  let seconds = startSeconds;
  Date.now = () => seconds * 1000;
  return {
    get seconds() {
      return seconds;
    },
    advance(bySeconds) {
      seconds += bySeconds;
      return seconds;
    },
    restore() {
      Date.now = original;
    },
  };
}

/** Repeat an ASCII character; used for boundary-length fixtures. */
export function chars(count, char = 'a') {
  return char.repeat(count);
}

/** A message of exactly `length` characters that is otherwise valid. */
export function messageOfLength(length) {
  return chars(length, 'm');
}
