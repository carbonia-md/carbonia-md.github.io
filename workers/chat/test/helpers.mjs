import assert from 'node:assert/strict';

import { createD1Stub } from './d1-stub.mjs';

export const ALLOWED_ORIGIN = 'https://kb.example.invalid';
export const OTHER_ORIGIN = 'https://other.example.invalid';
export const WORKER_URL = 'https://chat.example.invalid/';
export const SITE_NAME = 'Example Knowledge Base';
export const CLIENT_IP = '203.0.113.17';
export const OTHER_CLIENT_IP = '198.51.100.29';
export const SALT = 'chat-contract-test-salt-0123456789';
export const DEFAULT_LIMIT = 20;
export const DEFAULT_WINDOW = 3600;
export const MAX_BODY_BYTES = 32768;
export const OMIT = Symbol('omit');

function withoutOmitted(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== OMIT));
}

export function validPayload(overrides = {}) {
  return withoutOmitted({ message: 'Where can I find the alpha guide?', history: [], ...overrides });
}

export function makeRequest(options = {}) {
  const {
    method = 'POST',
    origin = ALLOWED_ORIGIN,
    contentType = 'application/json',
    ip = CLIENT_IP,
    body,
    headers: extraHeaders = {},
  } = options;
  const headers = new Headers();
  if (origin !== OMIT) headers.set('Origin', origin);
  if (contentType !== OMIT) headers.set('Content-Type', contentType);
  if (ip !== OMIT) headers.set('CF-Connecting-IP', ip);
  for (const [name, value] of Object.entries(extraHeaders)) {
    if (value === OMIT) headers.delete(name);
    else headers.set(name, value);
  }
  const init = { method, headers };
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    if (body instanceof ReadableStream) {
      init.body = body;
      init.duplex = 'half';
    } else {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
  }
  return new Request(WORKER_URL, init);
}

export function postJson(payload, options = {}) {
  return makeRequest({ body: payload, ...options });
}

export function sseStream(parts = ['data: {"response":"Guide answer"}\n\n', 'data: [DONE]\n\n']) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

export function createAiStub({ query = [10, 0, 0], streamParts, onRun } = {}) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      onRun?.(model, input, calls.length);
      if (model === '@cf/baai/bge-m3') return { data: [query] };
      return sseStream(streamParts);
    },
  };
}

export function makeEnv(SQL, overrides = {}) {
  const DB = overrides.DB ?? createD1Stub(SQL);
  const AI = overrides.AI ?? createAiStub();
  return {
    DB,
    AI,
    env: withoutOmitted({
      DB,
      AI,
      ALLOWED_ORIGIN,
      SITE_NAME,
      IP_HASH_SALT: SALT,
      ...overrides,
    }),
  };
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function expectedIpHash(ip = CLIENT_IP, salt = SALT) {
  return sha256Hex(`${ip}${salt}`);
}

export function assertCors(response, origin = ALLOWED_ORIGIN) {
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.notEqual(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('vary'), 'Origin');
}

export async function assertValidationError(response, field) {
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['error', 'field']);
  assert.equal(typeof body.error, 'string');
  assert.ok(body.error.length > 0);
  if (field instanceof RegExp) assert.match(body.field, field);
  else assert.equal(body.field, field);
  return body;
}

export function jsonBodyOfBytes(target) {
  const base = validPayload({ filler: '' });
  const empty = JSON.stringify(base);
  const deficit = target - new TextEncoder().encode(empty).length;
  assert.ok(deficit >= 0);
  const body = JSON.stringify({ ...base, filler: 'x'.repeat(deficit) });
  assert.equal(new TextEncoder().encode(body).length, target);
  return body;
}

export function streamingBody(chunkBytes, chunkCount) {
  const state = { pulled: 0 };
  const chunk = new TextEncoder().encode('x'.repeat(chunkBytes));
  return {
    state,
    stream: new ReadableStream({
      pull(controller) {
        if (state.pulled >= chunkCount) {
          controller.close();
          return;
        }
        state.pulled += 1;
        controller.enqueue(chunk.slice());
      },
    }),
  };
}
