// The `npm run qr:sheet` CLI: which cards a real run writes, and which it drops.
//
// tests/qr-sheet.test.mjs covers the renderer, which takes an already-validated context
// list and a route set as arguments. That left the CLI's own job -- deciding what route
// set to hand the reader -- untested, and a route set NARROWER than the one `/chat`
// validates against silently drops cards for links the site serves correctly (review B1
// on PR #71). So these drive the executable end to end against a temporary instance.
//
// Each case builds a whole miniature instance in a temp directory: place.config.ts,
// src/pages/, knowledge/, and the context manifest. That is the same shape the CLI reads
// in a real repository, so nothing here stubs the thing under test.
//
// tests/ is framework code that ships to every adopter: every fixture is synthetic and
// carries no place name.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, test } from 'node:test';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(REPO, 'scripts/tools/qr-sheet.mjs');

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const PLACE_CONFIG = `export interface PlaceConfig {
  place: { name: string; tagline: string; domain: string; locale: string; languages: string[] };
  categories: Array<{ slug: string; title: string; icon: string; description: string }>;
  features: Record<string, boolean>;
}
const config = {
  place: {
    name: 'Example Knowledge Base',
    tagline: 'An example.',
    domain: 'example.invalid',
    locale: 'en',
    languages: ['en'],
  },
  categories: [
    { slug: 'guides', title: 'Guides', icon: 'G', description: 'Guides.' },
    { slug: 'places', title: 'Places', icon: 'P', description: 'Places.' },
  ],
  features: {},
};
export default config;
`;

/**
 * A miniature instance: the config, some static pages, some articles, and the context
 * manifest frontmatter `contexts` block the case is about.
 *
 * `articles` are given as `<Category Title>/<file>.md`, because that is the layout
 * `scripts/core/sync.sh` reads -- a knowledge directory is named for the category's
 * TITLE while its route carries the SLUG. A fixture that named the directories after
 * the slugs would make the two indistinguishable and could not catch a reader that
 * confused them.
 */
function makeRoot(
  contextsYaml,
  {
    pages = ['index', 'chat', 'soundscape'],
    articles = ['Guides/alpha.md', 'Places/north-dock.md'],
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'qr-sheet-cli-'));
  roots.push(root);

  writeFileSync(join(root, 'place.config.ts'), PLACE_CONFIG, 'utf8');

  mkdirSync(join(root, 'src/pages'), { recursive: true });
  for (const page of pages) writeFileSync(join(root, 'src/pages', `${page}.astro`), '---\n---\n', 'utf8');

  for (const article of articles) {
    const path = join(root, 'knowledge', article);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '---\ntitle: An article\n---\n\nBody.\n', 'utf8');
  }

  if (contextsYaml !== null) {
    mkdirSync(join(root, 'knowledge/chat'), { recursive: true });
    writeFileSync(
      join(root, 'knowledge/chat/_contexts.md'),
      `---\n${contextsYaml}---\n\nNotes.\n`,
      'utf8',
    );
  }

  // Deliberately no build output. The route set comes from `knowledge/` and the config,
  // so a sheet must print correctly in a tree that has never been built.
  return root;
}

/** Runs the CLI exactly as `npm run qr:sheet` does, and never throws on a clean exit. */
function run(root, args = []) {
  // Diagnostics land on stderr (the reader warns through console.warn) and the summary
  // on stdout, so a case about a dropped context reads both. spawnSync rather than
  // execFileSync: a nonzero exit is a result to assert on here, not an exception.
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', CLI, '--root', root, ...args],
    { encoding: 'utf8' },
  );
  const outPath = join(root, 'qr-sheet.html');
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    html: existsSync(outPath) ? readFileSync(outPath, 'utf8') : null,
  };
}

/** Asserts a clean exit and returns the run, so no case can pass on a crash. */
function runOk(root, args = []) {
  const result = run(root, args);
  assert.equal(result.code, 0, `qr-sheet exited ${result.code}: ${result.stderr}`);
  return result;
}

const cardSlugs = (html) =>
  [...(html ?? '').matchAll(/<article class="card" data-context="([^"]+)">/g)].map((m) => m[1]);

describe('the route set the CLI validates `article` against', () => {
  // The B1 regression. `/soundscape` is a static page and `/places` is a category hub:
  // both are routes the build produces and neither is an article, so a route set built
  // from article routes alone drops all three of these contexts and prints one card.
  test('accepts a static page, a category hub, and an article alike', () => {
    const root = makeRoot(`contexts:
  - slug: static-page
    label: Static Page
    greeting: A greeting.
    article: /soundscape
  - slug: category-hub
    label: Category Hub
    greeting: A greeting.
    article: /places
  - slug: an-article
    label: An Article
    greeting: A greeting.
    article: /guides/alpha
  - slug: no-article
    label: No Article
    greeting: A greeting.
`);
    const { html, stdout } = runOk(root);
    assert.deepEqual(cardSlugs(html), ['static-page', 'category-hub', 'an-article', 'no-article']);
    assert.equal(stdout.includes('does not resolve'), false, stdout);
  });

  test('still drops a context whose article resolves to nothing, and keeps the rest', () => {
    const root = makeRoot(`contexts:
  - slug: broken
    label: Broken
    greeting: A greeting.
    article: /guides/does-not-exist
  - slug: intact
    label: Intact
    greeting: A greeting.
    article: /guides/alpha
`);
    const { html, stderr } = runOk(root);
    assert.deepEqual(cardSlugs(html), ['intact']);
    assert.match(
      stderr,
      /context "broken" declares `article` "\/guides\/does-not-exist", which does not resolve/,
      'the drop must be reported, naming the context and the link',
    );
  });

  // An article in a directory that is not a configured category has no page, so a link
  // to it would 404 -- the same filter `[category]/[slug].astro` applies.
  test('an article outside the configured categories is not a route', () => {
    const root = makeRoot(
      `contexts:
  - slug: unconfigured
    label: Unconfigured
    greeting: A greeting.
    article: /drafts/hidden
`,
      { articles: ['Guides/alpha.md', 'Drafts/hidden.md'] },
    );
    const { code, stderr, html } = run(root);
    assert.match(
      stderr,
      /context "unconfigured" declares `article` "\/drafts\/hidden", which does not resolve/,
    );
    assert.equal(html, null, 'the only context was dropped, so no sheet is written');
    assert.equal(code, 1, 'and every declared context being dropped is a failure, not an empty OK');
  });

  // With no `src/pages` the route set cannot be derived at all. That is NOT the same
  // claim as "this article resolves to nothing", so every card must still print with
  // its link omitted -- the failure mode is a missing link, never a missing code.
  test('an underivable route set omits links and still prints every card', () => {
    const root = makeRoot(
      `contexts:
  - slug: first
    label: First
    greeting: A greeting.
    article: /guides/alpha
  - slug: second
    label: Second
    greeting: A greeting.
    article: /soundscape
`,
      { pages: [] },
    );
    rmSync(join(root, 'src/pages'), { recursive: true, force: true });
    const { html, stderr } = runOk(root);
    assert.deepEqual(cardSlugs(html), ['first', 'second']);
    assert.match(stderr, /could not be derived/, 'the reader must say why the links are gone');
    assert.equal(html.includes('/guides/alpha'), false, 'an unverifiable link is omitted');
  });
});

describe('what the CLI writes', () => {
  test('one card per context, carrying the encoded URL and the label', () => {
    const root = makeRoot(`contexts:
  - slug: north-dock
    label: North Dock
    greeting: A greeting.
`);
    const { html, stdout } = runOk(root);
    assert.deepEqual(cardSlugs(html), ['north-dock']);
    assert.ok(html.includes('https://example.invalid/chat?ctx=north-dock'), 'the URL is on the card');
    assert.ok(html.includes('North Dock'));
    assert.ok(html.includes('<svg'), 'the code is inline');
    assert.match(stdout, /OK: sheet written to qr-sheet\.html/);
  });

  test('--domain overrides the configured domain', () => {
    const root = makeRoot(`contexts:
  - slug: north-dock
    label: North Dock
    greeting: A greeting.
`);
    const { html } = runOk(root, ['--domain', 'staging.example.invalid']);
    assert.ok(html.includes('https://staging.example.invalid/chat?ctx=north-dock'));
    assert.equal(html.includes('https://example.invalid/chat'), false);
  });

  test('--out writes somewhere else and leaves the default path alone', () => {
    const root = makeRoot(`contexts:
  - slug: north-dock
    label: North Dock
    greeting: A greeting.
`);
    runOk(root, ['--out', 'reports/codes.html']);
    assert.equal(existsSync(join(root, 'qr-sheet.html')), false);
    assert.ok(readFileSync(join(root, 'reports/codes.html'), 'utf8').includes('north-dock'));
  });
});

describe('the states that are not failures', () => {
  test('no manifest exits 0 saying no contexts are declared, and writes nothing', () => {
    const root = makeRoot(null);
    const { stdout, html } = runOk(root);
    assert.match(stdout, /no contexts declared/);
    assert.equal(html, null);
  });

  test('a manifest declaring an empty list writes nothing rather than an empty sheet', () => {
    const root = makeRoot('contexts: []\n');
    const { stdout, html } = runOk(root);
    assert.match(stdout, /no contexts declared/);
    assert.equal(html, null);
  });
});

describe('the states that are failures', () => {
  // An empty sheet from a manifest somebody wrote is not the same state as an empty
  // sheet from a manifest that declares nothing, and the summary line is what the
  // operator reads -- the per-context warnings above it scroll past.
  test('a manifest whose contexts are all dropped fails, naming how many, rather than reporting none declared', () => {
    const root = makeRoot(
      'contexts:\n' +
        '  - slug: NOT-A-SLUG\n    label: One\n    greeting: Ask.\n' +
        '  - slug: two\n    label: Two\n    greeting: Ask.\n    article: /nowhere\n',
    );

    const { code, stdout, stderr, html } = run(root);
    assert.equal(code, 1);
    assert.match(stderr, /all 2 context\(s\) declared .* were dropped by validation/);
    assert.doesNotMatch(stdout, /no contexts declared/, 'they were declared, and then rejected');
    assert.equal(html, null);
  });

  test('an unknown flag is refused rather than ignored', () => {
    const root = makeRoot('contexts: []\n');
    const { code, stderr } = run(root, ['--topics', 'public/kb/topics.json']);
    assert.equal(code, 1);
    assert.match(stderr, /unknown argument "--topics"/, 'a flag this CLI does not have must not be silently dropped');
  });

  test('a flag with no value is refused', () => {
    const root = makeRoot('contexts: []\n');
    const { code, stderr } = run(root, ['--domain']);
    assert.equal(code, 1);
    assert.match(stderr, /--domain needs a value/);
  });
});
