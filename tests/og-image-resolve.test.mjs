// tests/og-image-resolve.test.mjs — the four-case absent-safe OG image matrix.
//
// Verifies that the worker URL is used only when features.og === true AND
// workers.og is a non-empty string; every other combination falls back to the
// static defaultOgImage.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOgImage } from '../src/utils/og-image.ts';

const DEFAULT = '/og-default.png';
const WORKER_URL = 'https://og.example.workers.dev';

describe('resolveOgImage four-case matrix', () => {
  it('case 1: features.og=true + workers.og set → worker URL', () => {
    const result = resolveOgImage({
      featureOg: true,
      workerOgUrl: WORKER_URL,
      categorySlug: 'beaches',
      slug: 'lantern-cove',
      defaultOgImage: DEFAULT,
    });
    assert.equal(result, `${WORKER_URL}/og/beaches/lantern-cove.png`);
  });

  it('case 2: features.og=true + workers.og empty → static fallback', () => {
    const result = resolveOgImage({
      featureOg: true,
      workerOgUrl: '',
      categorySlug: 'beaches',
      slug: 'lantern-cove',
      defaultOgImage: DEFAULT,
    });
    assert.equal(result, DEFAULT);
  });

  it('case 3: features.og=false + workers.og set → static fallback', () => {
    const result = resolveOgImage({
      featureOg: false,
      workerOgUrl: WORKER_URL,
      categorySlug: 'beaches',
      slug: 'lantern-cove',
      defaultOgImage: DEFAULT,
    });
    assert.equal(result, DEFAULT);
  });

  it('case 4: features.og=false + workers.og empty → static fallback', () => {
    const result = resolveOgImage({
      featureOg: false,
      workerOgUrl: '',
      categorySlug: 'beaches',
      slug: 'lantern-cove',
      defaultOgImage: DEFAULT,
    });
    assert.equal(result, DEFAULT);
  });

  it('uses defaultOgImage when categorySlug is missing', () => {
    const result = resolveOgImage({
      featureOg: true,
      workerOgUrl: WORKER_URL,
      categorySlug: undefined,
      slug: 'lantern-cove',
      defaultOgImage: DEFAULT,
    });
    assert.equal(result, DEFAULT);
  });

  it('uses defaultOgImage when slug is missing', () => {
    const result = resolveOgImage({
      featureOg: true,
      workerOgUrl: WORKER_URL,
      categorySlug: 'beaches',
      slug: undefined,
      defaultOgImage: DEFAULT,
    });
    assert.equal(result, DEFAULT);
  });

  it('uses explicitImage when provided regardless of feature flags', () => {
    const result = resolveOgImage({
      featureOg: true,
      workerOgUrl: WORKER_URL,
      categorySlug: 'beaches',
      slug: 'lantern-cove',
      explicitImage: '/custom-og.png',
      defaultOgImage: DEFAULT,
    });
    assert.equal(result, '/custom-og.png');
  });

  it('absent features.og (undefined) → static fallback', () => {
    const result = resolveOgImage({
      featureOg: undefined,
      workerOgUrl: WORKER_URL,
      categorySlug: 'beaches',
      slug: 'lantern-cove',
      defaultOgImage: DEFAULT,
    });
    assert.equal(result, DEFAULT);
  });
});
