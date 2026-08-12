// The chat surface gate: `features.chat` AND a non-empty `workers.chat`.
//
// Four combinations, and only one of them renders anything. The gate lives in
// src/lib/chat.ts precisely so the page, the Header, and the Footer cannot drift
// apart, so this asserts the predicate AND that all three surfaces consult it -- a
// correct predicate nobody calls would pass a test of the predicate alone.
//
// Fixtures here are synthetic. tests/ is framework code that ships to every adopter,
// so nothing may assume the demo corpus, the demo config, or any place name.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { resolveChat } from '../src/lib/chat.ts';

const ENDPOINT = 'https://chat.example.invalid';

/** A config carrying only what the gate reads. */
const config = (chatFlag, workers) => ({ features: { chat: chatFlag }, workers });

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the four flag and endpoint combinations resolve to one enabled state', () => {
  // 1. flag off, endpoint present -- a deliberate "configured but not yet on".
  assert.deepEqual(resolveChat(config(false, { chat: ENDPOINT })), {
    enabled: false,
    endpoint: ENDPOINT,
  });

  // 2. flag on, no `workers` block at all -- a config written before the key existed.
  assert.deepEqual(resolveChat(config(true, undefined)), { enabled: false, endpoint: '' });

  // 3. flag on, endpoint present but empty -- the worker is not deployed yet.
  assert.deepEqual(resolveChat(config(true, { chat: '' })), { enabled: false, endpoint: '' });

  // 4. both halves present -- the only enabled state.
  assert.deepEqual(resolveChat(config(true, { chat: ENDPOINT })), {
    enabled: true,
    endpoint: ENDPOINT,
  });
});

test('a whitespace-only endpoint is empty, and the endpoint is trimmed', () => {
  assert.deepEqual(resolveChat(config(true, { chat: '   ' })), { enabled: false, endpoint: '' });
  assert.deepEqual(resolveChat(config(true, { chat: `  ${ENDPOINT}  ` })), {
    enabled: true,
    endpoint: ENDPOINT,
  });
});

test('a workers block with no chat key, and a missing features block, stay off', () => {
  assert.deepEqual(resolveChat(config(true, { feedback: ENDPOINT })), {
    enabled: false,
    endpoint: '',
  });
  assert.deepEqual(resolveChat({ workers: { chat: ENDPOINT } }), {
    enabled: false,
    endpoint: ENDPOINT,
  });
});

test('a truthy non-true flag does not enable chat', () => {
  // `features.chat` is a boolean in the schema; a string from a hand-edited config
  // must not slip through as truthy.
  assert.equal(resolveChat(config('yes', { chat: ENDPOINT })).enabled, false);
  assert.equal(resolveChat(config(1, { chat: ENDPOINT })).enabled, false);
});

test('the page, Header, and Footer all gate on the shared predicate', () => {
  for (const path of [
    '../src/templates/chat.template.astro',
    '../src/components/Header.astro',
    '../src/components/Footer.astro',
  ]) {
    const text = source(path);
    assert.match(text, /import \{ resolveChat \} from/, `${path} must import the shared gate`);
    assert.match(text, /resolveChat\(placeConfig\)/, `${path} must resolve against place.config`);
    assert.equal(
      /features\.chat/.test(text),
      false,
      `${path} must not read features.chat directly; that is half the gate`,
    );
  }
});

test('the Header and Footer entry points are inside the gate', () => {
  assert.match(
    source('../src/components/Header.astro'),
    /chat\.enabled \? \[\{ path: '\/chat'/,
    'the Header nav entry must be conditional on the resolved gate',
  );
  assert.match(
    source('../src/components/Footer.astro'),
    /\{chat\.enabled && <a href="\/chat">/,
    'the Footer link must be conditional on the resolved gate',
  );
});

test('the disabled page carries no endpoint and no script', () => {
  const text = source('../src/templates/chat.template.astro');

  const branch = text.indexOf('!enabled ? (');
  assert.notEqual(branch, -1, 'the template must branch on the resolved gate');

  const disabledMarker = text.indexOf('data-chat-disabled');
  const endpointAttr = text.indexOf('data-endpoint={endpoint}');
  const scriptTag = text.indexOf('set:html={CHAT_SCRIPT}');

  assert.notEqual(disabledMarker, -1, 'the disabled state must be identifiable in the markup');
  assert.notEqual(endpointAttr, -1, 'the enabled state must carry the endpoint');
  assert.notEqual(scriptTag, -1, 'the enabled state must carry the inline client');

  // Everything that could reach the network sits after the disabled branch, so a
  // flag-off build emits neither the endpoint nor the script that would use it.
  assert.ok(
    disabledMarker < endpointAttr && disabledMarker < scriptTag,
    'the endpoint and the client script must live in the enabled branch only',
  );
});

test('the page loads no off-origin script', () => {
  const text = source('../src/templates/chat.template.astro');
  const offOrigin = text.match(/<script[^>]*\ssrc=["'](?!\/)[^"']+/gi) ?? [];
  assert.deepEqual(offOrigin, [], 'the chat page must load no external script');
  assert.equal(/https?:\/\/[^"'\s]*\.js/.test(text), false, 'no CDN script URL may appear');
});
