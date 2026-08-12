// workers/og/test/handler.test.mjs — unit tests for the OG image handler.
//
// Drives handleRequest directly with a stubbed global fetch, a stubbed Cache
// API, and stub rendering deps. No wasm, no real PNG rendering — the tests
// validate routing, caching, data flow, and the topics-fetch caching contract.

import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, buildCard, resetForTesting } from '../src/handler.mjs';

const SAMPLE_TOPICS = [
  {
    title: 'Lantern Cove',
    description: 'A sheltered cove with tide pools',
    category: 'beaches',
    tags: ['cove', 'tide-pools'],
    url: '/beaches/lantern-cove',
    kb: '/kb/articles/beaches/lantern-cove.md',
    readingTime: 5,
    date: '2026-01-15',
    featured: true,
  },
  {
    title: 'Summit Ridge Trail',
    description: 'Ridge hike with ocean views',
    category: 'trails',
    tags: ['hiking'],
    url: '/trails/summit-ridge-trail',
    kb: '/kb/articles/trails/summit-ridge-trail.md',
    readingTime: 4,
    date: '2026-02-01',
    featured: false,
  },
];

const ENV = {
  SITE_ORIGIN: 'https://example.com',
  SITE_NAME: 'Test Site',
  CATEGORY_COLORS: JSON.stringify({ beaches: '#0284c7', trails: '#15803d' }),
};

const FAKE_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function makeDeps() {
  return {
    satori: mock.fn(async () => '<svg></svg>'),
    Resvg: class {
      render() {
        return { asPng: () => FAKE_PNG };
      }
    },
    initWasm: mock.fn(async () => {}),
    resvgWasm: {},
    fontData: new ArrayBuffer(8),
  };
}

function makeRequest(path, method = 'GET') {
  return new Request(`https://og.example.com${path}`, { method });
}

function createCacheStub() {
  const store = new Map();
  return {
    match: mock.fn(async (key) => {
      const url = typeof key === 'string' ? key : key.url;
      return store.get(url) || undefined;
    }),
    put: mock.fn(async (key, response) => {
      const url = typeof key === 'string' ? key : key.url;
      store.set(url, response);
    }),
    store,
  };
}

describe('OG worker handler routing', () => {
  let originalFetch;
  let originalCaches;
  let cacheStub;
  let topicsFetchCount;

  before(() => {
    originalFetch = globalThis.fetch;
    originalCaches = globalThis.caches;
  });

  after(() => {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  });

  beforeEach(() => {
    resetForTesting();
    topicsFetchCount = 0;
    globalThis.fetch = mock.fn(async (url) => {
      if (typeof url === 'string' && url.includes('/kb/topics.json')) {
        topicsFetchCount++;
        return new Response(JSON.stringify(SAMPLE_TOPICS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });
    cacheStub = createCacheStub();
    globalThis.caches = { default: cacheStub };
  });

  it('returns 405 for POST', async () => {
    const res = await handleRequest(makeRequest('/og/beaches/lantern-cove.png', 'POST'), ENV, makeDeps());
    assert.equal(res.status, 405);
  });

  it('returns 405 for PUT', async () => {
    const res = await handleRequest(makeRequest('/og/beaches/lantern-cove.png', 'PUT'), ENV, makeDeps());
    assert.equal(res.status, 405);
  });

  it('returns 405 for DELETE', async () => {
    const res = await handleRequest(makeRequest('/og/beaches/lantern-cove.png', 'DELETE'), ENV, makeDeps());
    assert.equal(res.status, 405);
  });

  it('returns 404 for paths not matching /og/{category}/{slug}.png', async () => {
    const cases = [
      '/og/',
      '/og/beaches/',
      '/og/beaches/lantern-cove',
      '/og/beaches/lantern-cove.jpg',
      '/other/path',
      '/',
      '/og/a/b/c.png',
    ];
    const deps = makeDeps();
    for (const path of cases) {
      const res = await handleRequest(makeRequest(path), ENV, deps);
      assert.equal(res.status, 404, `Expected 404 for ${path}`);
    }
  });

  it('returns 200 with image/png for a valid article path', async () => {
    const res = await handleRequest(makeRequest('/og/beaches/lantern-cove.png'), ENV, makeDeps());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'image/png');
  });

  it('returns Cache-Control: public, max-age=31536000, immutable', async () => {
    const res = await handleRequest(makeRequest('/og/trails/summit-ridge-trail.png'), ENV, makeDeps());
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get('Cache-Control'),
      'public, max-age=31536000, immutable',
    );
  });

  it('renders a brand-only card for an unknown slug (no error)', async () => {
    const res = await handleRequest(makeRequest('/og/beaches/nonexistent-article.png'), ENV, makeDeps());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'image/png');
  });

  it('writes to the Cache API on a cache miss', async () => {
    await handleRequest(makeRequest('/og/beaches/lantern-cove.png'), ENV, makeDeps());
    assert.equal(cacheStub.put.mock.calls.length, 1);
  });

  it('serves from cache on a cache hit without re-rendering', async () => {
    const cachedResponse = new Response('cached-png', {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
    cacheStub.store.set(
      'https://og.example.com/og/beaches/cached-test.png',
      cachedResponse,
    );
    const deps = makeDeps();
    const res = await handleRequest(makeRequest('/og/beaches/cached-test.png'), ENV, deps);
    assert.equal(res, cachedResponse);
    assert.equal(deps.satori.mock.calls.length, 0);
    assert.equal(cacheStub.put.mock.calls.length, 0);
  });

  it('fetches topics.json only once across two handler invocations', async () => {
    const deps = makeDeps();
    await handleRequest(makeRequest('/og/beaches/lantern-cove.png'), ENV, deps);
    await handleRequest(makeRequest('/og/trails/summit-ridge-trail.png'), ENV, deps);
    assert.equal(topicsFetchCount, 1);
  });

  it('HEAD returns the same status and headers as GET', async () => {
    const res = await handleRequest(makeRequest('/og/beaches/lantern-cove.png', 'HEAD'), ENV, makeDeps());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'image/png');
  });
});

describe('buildCard', () => {
  it('returns a brand-only card when article is null', () => {
    const card = buildCard(ENV, null);
    assert.equal(card.props.children[0].props.children, 'Test Site');
  });

  it('uses the category accent color from CATEGORY_COLORS', () => {
    const article = SAMPLE_TOPICS[0];
    const card = buildCard(ENV, article);
    const categoryBadge = card.props.children[0].props.children[0];
    assert.equal(categoryBadge.props.style.backgroundColor, '#0284c7');
  });

  it('falls back to default blue when category has no color', () => {
    const article = { ...SAMPLE_TOPICS[0], category: 'unknown' };
    const card = buildCard(ENV, article);
    const categoryBadge = card.props.children[0].props.children[0];
    assert.equal(categoryBadge.props.style.backgroundColor, '#3b82f6');
  });

  it('uses smaller font for long titles', () => {
    const article = { ...SAMPLE_TOPICS[0], title: 'A'.repeat(50) };
    const card = buildCard(ENV, article);
    const titleBlock = card.props.children[1].props.children[0];
    assert.equal(titleBlock.props.style.fontSize, 48);
  });
});
