// chat-contexts.test.mjs -- run with
// `node --experimental-strip-types --test tests/chat-contexts.test.mjs`.
//
// src/lib/chat-contexts.ts is the read side of the printed-QR flow: it turns a
// hand-edited knowledge/chat/_contexts.md into the list of scannable entry
// points. Every value it returns ends up in a printed URL query string or on a
// sheet nobody can re-issue after it is on a wall, so the reader's whole job is
// to drop what it cannot vouch for and say why, without ever failing the build.
//
// The three properties this suite exists to pin:
//   1. An absent manifest is a supported state -- zero contexts, zero warnings.
//   2. The reader never throws, whatever is in the file.
//   3. A claim the reader cannot check is not the same as a claim it checked and
//      rejected: with no route set supplied, an `article` link is omitted and the
//      context survives; with a route set supplied, an unresolvable link takes
//      the whole context with it.
//
// Written against the published contract only. Fixtures are real directory trees
// under the OS temp dir, never the repository's own knowledge/.
//
// This file lives under tests/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  CONTEXT_HINT_MAX_CHARS,
  CONTEXT_MANIFEST_PATH,
  CONTEXT_OPTIONAL_FIELDS,
  CONTEXT_REQUIRED_FIELDS,
  readChatContexts,
} from '../src/lib/chat-contexts.ts';

/* ------------------------------------------------------------------ fixtures */

const MADE = [];

after(() => {
  for (const dir of MADE) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway site root. Nothing here touches the repository tree. */
function makeRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'sekai-chat-contexts-'));
  MADE.push(dir);
  return dir;
}

/** Write the manifest at the contract's path, creating the directories it needs. */
function writeManifest(root, source) {
  const file = join(root, CONTEXT_MANIFEST_PATH);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  return file;
}

/** `---` frontmatter + free-form body, the shape a human edits. */
const withFrontmatter = (frontmatter, body = '') => `---\n${frontmatter}\n---\n${body}`;

/** One YAML list item from `key: value` lines. */
const item = (...lines) => lines.map((line, i) => (i === 0 ? `  - ${line}` : `    ${line}`)).join('\n');

/** A `contexts:` list from item() blocks. */
const contexts = (...items) => ['contexts:', ...items].join('\n');

/**
 * A complete, valid entry. Values are deliberately place-neutral: tests/ is
 * scanned by the place-name gate, so a fixture may not name a real place.
 */
function validItem(overrides = {}) {
  const fields = {
    slug: 'alpha',
    label: 'Example Landmark',
    greeting: 'Ask about this spot.',
    ...overrides,
  };
  return item(
    ...Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}: ${value}`),
  );
}

/** The whole ChatContext shape: the three required values plus both optionals, defaulted to null. */
function expectedContext(overrides = {}) {
  return {
    slug: 'alpha',
    label: 'Example Landmark',
    greeting: 'Ask about this spot.',
    hint: null,
    article: null,
    ...overrides,
  };
}

/**
 * Call the module with console.warn swapped out, so the transcript clause is
 * asserted rather than dumped into the test output. Passing no argument
 * exercises the `root` default.
 */
function call(...args) {
  const original = console.warn;
  const logged = [];
  console.warn = (...parts) => {
    logged.push(parts.map((part) => (typeof part === 'string' ? part : String(part))).join(' '));
  };
  try {
    return { result: readChatContexts(...args), logged };
  } finally {
    console.warn = original;
  }
}

/** Whatever is in `warnings` also reached the build transcript. */
function assertWarningsWereLogged({ result, logged }) {
  for (const warning of result.warnings) {
    assert.ok(
      logged.some((line) => line.includes(warning)),
      `expected console.warn to carry the warning: ${warning}\nlogged: ${JSON.stringify(logged)}`,
    );
  }
}

/** Exactly one warning, its text returned for further assertions. */
function onlyWarning(call_) {
  assert.equal(
    call_.result.warnings.length,
    1,
    `expected exactly one warning, got ${JSON.stringify(call_.result.warnings)}`,
  );
  assertWarningsWereLogged(call_);
  return call_.result.warnings[0];
}

const slugs = (result) => result.contexts.map((context) => context.slug);

/** A root whose manifest holds the given item blocks. */
function rootWith(...items) {
  const root = makeRoot();
  writeManifest(root, withFrontmatter(contexts(...items)));
  return root;
}

/* ------------------------------------------------- the published field lists */

describe('the published schema constants', () => {
  test('the manifest path is the underscore-prefixed file the knowledge scanners skip', () => {
    // The `_` prefix is what keeps the manifest out of the article scanners; a
    // rename to `contexts.md` would publish it as an article.
    assert.equal(CONTEXT_MANIFEST_PATH, 'knowledge/chat/_contexts.md');
  });

  test('a context requires exactly slug, label and greeting', () => {
    // A documentation gate derives its expected prose from these arrays, so their
    // contents are contract, not an implementation detail.
    assert.deepEqual([...CONTEXT_REQUIRED_FIELDS], ['slug', 'label', 'greeting']);
  });

  test('a context accepts exactly two optional fields, hint and article', () => {
    assert.deepEqual([...CONTEXT_OPTIONAL_FIELDS], ['hint', 'article']);
  });

  test('a manifest written without the underscore is not read', () => {
    const root = makeRoot();
    const stray = join(root, 'knowledge', 'chat', 'contexts.md');
    mkdirSync(dirname(stray), { recursive: true });
    writeFileSync(stray, withFrontmatter(contexts(validItem()), 'body'));

    const { result } = call(root);
    assert.deepEqual(result, { contexts: [], declared: 0, notes: '', warnings: [] });
  });
});

/* ------------------------------------------------------ the well-formed case */

describe('a well-formed manifest', () => {
  test('returns every declared field of a context, and nothing else', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(contexts(validItem()), 'Notes for a human.\n'));

    const { result, logged } = call(root);
    assert.deepEqual(result.contexts, [expectedContext()]);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(logged, [], 'a clean manifest must not warn at all');
  });

  test('every required field is returned trimmed', () => {
    const root = rootWith(
      validItem({ slug: '"  north-dock  "', label: '"  Example Landmark  "', greeting: '"  Ask about this spot.  "' }),
    );

    const { result, logged } = call(root);
    assert.deepEqual(result.contexts, [expectedContext({ slug: 'north-dock' })]);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(logged, []);
  });

  test('survivors keep manifest order', () => {
    const root = rootWith(
      validItem({ slug: 'alpha' }),
      validItem({ slug: 'north-dock' }),
      validItem({ slug: 'charlie' }),
      validItem({ slug: 'delta' }),
    );

    assert.deepEqual(slugs(call(root).result), ['alpha', 'north-dock', 'charlie', 'delta']);
  });

  test('survivors keep manifest order even when entries between them are dropped', () => {
    const root = rootWith(
      validItem({ slug: 'alpha' }),
      validItem({ slug: 'bravo', label: undefined }),
      validItem({ slug: 'charlie' }),
      '  - not a mapping at all',
      validItem({ slug: 'delta' }),
    );

    const { result } = call(root);
    assert.deepEqual(slugs(result), ['alpha', 'charlie', 'delta']);
    assert.equal(result.warnings.length, 2, JSON.stringify(result.warnings));
  });

  test('root defaults to process.cwd()', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(contexts(validItem()), 'Body from cwd.\n'));

    const before = process.cwd();
    let call_;
    try {
      process.chdir(root);
      call_ = call();
    } finally {
      process.chdir(before);
    }
    assert.deepEqual(slugs(call_.result), ['alpha']);
    assert.equal(call_.result.notes, 'Body from cwd.');
  });

  test('it resolves against the root it was given, not another tree', () => {
    const elsewhere = makeRoot();
    writeManifest(elsewhere, withFrontmatter(contexts(validItem())));
    const root = makeRoot();

    const { result } = call(root);
    assert.deepEqual(result, { contexts: [], declared: 0, notes: '', warnings: [] });
  });

  test('notes is the manifest body, trimmed', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(contexts(validItem()), '\n\nHow these were chosen.\n\nSecond paragraph.\n\n\n'),
    );

    assert.equal(call(root).result.notes, 'How these were chosen.\n\nSecond paragraph.');
  });

  test('notes is the empty string when the body is empty or whitespace', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(contexts(validItem()), '   \n\n'));

    assert.equal(call(root).result.notes, '');
  });
});

/* ----------------------------------------------------- an absent manifest */

describe('the manifest is absent', () => {
  const empty = { contexts: [], declared: 0, notes: '', warnings: [] };

  test('no knowledge/ directory at all is a supported state, not a defect', () => {
    const { result, logged } = call(makeRoot());
    assert.deepEqual(result, empty);
    assert.deepEqual(logged, [], 'an absent manifest must not warn');
  });

  test('knowledge/chat/ exists but holds no manifest', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'knowledge', 'chat'), { recursive: true });

    const { result, logged } = call(root);
    assert.deepEqual(result, empty);
    assert.deepEqual(logged, []);
  });

  test('an absent manifest never throws', () => {
    assert.doesNotThrow(() => readChatContexts(makeRoot()));
  });
});

/* -------------------------------------------------- a manifest that is junk */

describe('unparseable frontmatter', () => {
  test('yields zero contexts and exactly one warning naming the file', () => {
    const root = makeRoot();
    // An unterminated double-quoted scalar: the YAML parser throws, and the
    // reader has to absorb it.
    writeManifest(root, withFrontmatter('contexts: []\ntitle: "unterminated', 'Body.\n'));

    const call_ = call(root);
    assert.deepEqual(call_.result.contexts, []);
    const warning = onlyWarning(call_);
    assert.ok(
      warning.includes(CONTEXT_MANIFEST_PATH),
      `expected the warning to name ${CONTEXT_MANIFEST_PATH}, got: ${warning}`,
    );
  });
});

describe('readChatContexts never throws', () => {
  const hostile = [
    ['an empty file', ''],
    ['a body with no frontmatter', 'Just notes, no fences.\n'],
    ['frontmatter fences with nothing between them', '---\n---\n'],
    ['an unterminated quoted scalar', withFrontmatter('contexts: "[', 'Body.\n')],
    ['a mapping value where a key belongs', withFrontmatter('contexts: a: b: c')],
    ['a tab-indented item', withFrontmatter('contexts:\n\t- slug: alpha')],
    ['a list of nulls', withFrontmatter('contexts:\n  -\n  -\n  -')],
    ['deeply nested junk', withFrontmatter('contexts:\n  - slug:\n      nested:\n        deeper: [1, 2, 3]')],
    ['a slug that is a mapping', withFrontmatter(contexts(validItem({ slug: '\n      inner: value' })))],
    ['a greeting that is a list', withFrontmatter(contexts(validItem({ greeting: '\n      - one' })))],
    ['an article that is a list', withFrontmatter(contexts(validItem({ article: '\n      - /guides/alpha' })))],
    ['a very long slug', withFrontmatter(contexts(validItem({ slug: 'x'.repeat(4000) })))],
    ['a numeric contexts key', withFrontmatter('contexts: 3')],
  ];

  for (const [what, source] of hostile) {
    test(`${what} returns a well-formed result instead of throwing`, () => {
      const root = makeRoot();
      writeManifest(root, source);

      let call_;
      assert.doesNotThrow(() => {
        call_ = call(root);
      });
      assert.ok(Array.isArray(call_.result.contexts), 'contexts must be an array');
      assert.ok(Array.isArray(call_.result.warnings), 'warnings must be an array');
      assert.equal(typeof call_.result.notes, 'string', 'notes must be a string');
      assertWarningsWereLogged(call_);
    });
  }

  for (const [what, options] of [
    ['a null knownRoutes', { knownRoutes: null }],
    ['a number knownRoutes', { knownRoutes: 7 }],
    ['a mapping knownRoutes', { knownRoutes: { one: '/guides/alpha' } }],
    ['an empty options object', {}],
  ]) {
    test(`${what} returns a well-formed result instead of throwing`, () => {
      // What a non-iterable route set resolves to is unspecified, so only the
      // shape of the result is asserted here.
      const root = rootWith(validItem({ article: '/guides/alpha' }));

      let call_;
      assert.doesNotThrow(() => {
        call_ = call(root, options);
      });
      assert.ok(Array.isArray(call_.result.contexts), 'contexts must be an array');
      assert.ok(Array.isArray(call_.result.warnings), 'warnings must be an array');
    });
  }
});

/* ------------------------------------------------- the contexts key itself */

describe('the contexts key is absent or null', () => {
  const cases = [
    ['no frontmatter at all', ''],
    ['frontmatter without a contexts key', 'title: Chat contexts'],
    ['a contexts key with a null value', 'contexts:'],
  ];

  for (const [what, frontmatter] of cases) {
    test(`${what} yields zero contexts and a warning`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(frontmatter, 'Human notes survive.\n'));

      const call_ = call(root);
      assert.deepEqual(call_.result.contexts, []);
      onlyWarning(call_);
      assert.equal(call_.result.notes, 'Human notes survive.');
    });
  }

  test('an explicitly empty list yields zero contexts without throwing', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter('contexts: []', 'Human notes survive.\n'));

    const call_ = call(root);
    assert.deepEqual(call_.result.contexts, []);
    assert.equal(call_.result.notes, 'Human notes survive.');
    assertWarningsWereLogged(call_);
  });
});

describe('the contexts key is present but not a list', () => {
  const cases = [
    ['a scalar string', 'contexts: not a list', /string/i],
    ['a number', 'contexts: 4', /number/i],
    ['a mapping', 'contexts:\n  one: Example Landmark', /object|map/i],
  ];

  for (const [what, frontmatter, typeMatch] of cases) {
    test(`${what} yields zero contexts and one warning naming the type`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(frontmatter));

      const call_ = call(root);
      assert.deepEqual(call_.result.contexts, []);
      const warning = onlyWarning(call_);
      assert.match(warning, typeMatch, `expected the warning to name the type, got: ${warning}`);
    });
  }
});

/* -------------------------------------------------------- per-entry defects */

describe('an entry that is not a mapping', () => {
  for (const [what, yaml] of [
    ['a bare string', '  - just a string'],
    ['a number', '  - 7'],
    ['a nested list', '  - - slug: alpha'],
    ['a null hole', '  -'],
  ]) {
    test(`${what} is dropped with a warning naming its index, and the rest survive`, () => {
      const root = rootWith(validItem({ slug: 'alpha' }), yaml, validItem({ slug: 'charlie' }));

      const call_ = call(root);
      assert.deepEqual(slugs(call_.result), ['alpha', 'charlie']);
      const warning = onlyWarning(call_);
      assert.match(warning, /\b1\b/, `expected the warning to name index 1, got: ${warning}`);
    });
  }
});

describe('a missing, non-string or blank required field', () => {
  for (const field of ['slug', 'label', 'greeting']) {
    const cases = [
      ['a missing', { [field]: undefined }],
      ['a non-string', { [field]: '\n      inner: value' }],
      ['an empty-string', { [field]: '""' }],
      ['a whitespace-only', { [field]: '"   "' }],
    ];

    for (const [what, overrides] of cases) {
      test(`${what} ${field} drops the entry, names the field, and leaves the rest`, () => {
        const root = rootWith(
          validItem({ slug: 'alpha' }),
          validItem({ slug: 'bravo', ...overrides }),
          validItem({ slug: 'charlie' }),
        );

        const call_ = call(root);
        assert.deepEqual(slugs(call_.result), ['alpha', 'charlie']);
        const warning = onlyWarning(call_);
        assert.ok(warning.includes(field), `expected the warning to name "${field}", got: ${warning}`);
      });
    }
  }

  test('one warning names every field the entry got wrong', () => {
    const root = rootWith(item('slug: bravo'));

    const call_ = call(root);
    assert.deepEqual(call_.result.contexts, []);
    const warning = onlyWarning(call_);
    assert.ok(warning.includes('label'), `expected the warning to name "label", got: ${warning}`);
    assert.ok(warning.includes('greeting'), `expected the warning to name "greeting", got: ${warning}`);
  });
});

/* ---------------------------------------------------------- the slug's shape */

describe('a slug must be URL-safe lowercase kebab', () => {
  // The slug is printed into a URL query string on a sheet nobody can reissue,
  // so anything needing percent-encoding, or differing only by case, is refused
  // at build time rather than mangled at scan time.
  const rejected = [
    ['a space', 'north dock'],
    ['an uppercase letter', 'North-dock'],
    ['an underscore', 'north_dock'],
    ['a slash', 'north/dock'],
    ['a question mark', 'north?dock'],
    ['a hash', 'north#dock'],
    ['an ampersand', 'north&dock'],
    ['a percent sign', 'north%20dock'],
    ['a leading hyphen', '-north'],
    ['a trailing hyphen', 'north-'],
    ['a doubled hyphen', 'north--dock'],
    ['nothing but a hyphen', '-'],
    ['a dot', 'north.dock'],
  ];

  for (const [what, slug] of rejected) {
    test(`a slug with ${what} is dropped with a warning naming it, and the rest survive`, () => {
      const root = rootWith(validItem({ slug: `"${slug}"` }), validItem({ slug: 'charlie' }));

      const call_ = call(root);
      assert.deepEqual(slugs(call_.result), ['charlie']);
      const warning = onlyWarning(call_);
      assert.ok(warning.includes(slug), `expected the warning to name the slug, got: ${warning}`);
    });
  }

  for (const slug of ['alpha', 'north-dock', 'a1', 'alpha-2-beta', '7']) {
    test(`the slug "${slug}" is accepted`, () => {
      const root = rootWith(validItem({ slug: `"${slug}"` }));

      const { result, logged } = call(root);
      assert.deepEqual(slugs(result), [slug]);
      assert.deepEqual(result.warnings, []);
      assert.deepEqual(logged, []);
    });
  }
});

describe('a duplicate slug', () => {
  test('keeps the first entry and drops the later one with a warning', () => {
    const root = rootWith(
      validItem({ slug: 'alpha', label: 'First Landmark' }),
      validItem({ slug: 'alpha', label: 'Second Landmark' }),
      validItem({ slug: 'charlie' }),
    );

    const call_ = call(root);
    assert.deepEqual(slugs(call_.result), ['alpha', 'charlie']);
    assert.equal(call_.result.contexts[0].label, 'First Landmark', 'the first declaration wins');
    const warning = onlyWarning(call_);
    assert.ok(warning.includes('alpha'), `expected the warning to name the duplicated slug, got: ${warning}`);
  });

  test('a slug that only duplicates after trimming is still a duplicate', () => {
    const root = rootWith(validItem({ slug: 'alpha' }), validItem({ slug: '"  alpha  "', label: 'Second Landmark' }));

    const call_ = call(root);
    assert.deepEqual(slugs(call_.result), ['alpha']);
    assert.equal(call_.result.contexts[0].label, 'Example Landmark');
    onlyWarning(call_);
  });
});

/* ---------------------------------------------------------- the hint field */

describe('the optional hint', () => {
  for (const [what, overrides] of [
    ['an absent', {}],
    ['a null', { hint: '' }],
    ['an empty-string', { hint: '""' }],
  ]) {
    test(`${what} hint is null, and never drops the entry or warns`, () => {
      const root = rootWith(validItem(overrides));

      const { result, logged } = call(root);
      assert.deepEqual(result.contexts, [expectedContext()]);
      assert.deepEqual(result.warnings, []);
      assert.deepEqual(logged, []);
    });
  }

  test('a declared hint is carried through', () => {
    const root = rootWith(validItem({ hint: 'Try asking about the tide.' }));

    const { result, logged } = call(root);
    assert.deepEqual(result.contexts, [expectedContext({ hint: 'Try asking about the tide.' })]);
    assert.deepEqual(logged, []);
  });

  for (const [what, value] of [
    ['a mapping', '\n      inner: value'],
    ['a list', '\n      - one'],
    ['a number', '7'],
  ]) {
    test(`${what} hint warns but keeps the entry, because a hint renders nothing to a reader`, () => {
      const root = rootWith(validItem({ hint: value }), validItem({ slug: 'charlie' }));

      const call_ = call(root);
      assert.deepEqual(slugs(call_.result), ['alpha', 'charlie'], 'a bad hint must never drop a context');
      assert.equal(call_.result.contexts[0].hint, null);
      const warning = onlyWarning(call_);
      assert.ok(warning.includes('hint'), `expected the warning to name "hint", got: ${warning}`);
    });
  }
});

/* ------------------------------------------------------- the declared count */
//
// `contexts: []` reads the same whether the manifest declared nothing or declared five
// contexts that were all rejected. Those are opposite things to tell an operator whose
// sheet came out empty, so the count of entries the list held is reported separately.

describe('the declared count', () => {
  test('counts every entry the list held, including the dropped ones', () => {
    const root = rootWith(
      validItem(),
      validItem({ slug: 'ALPHA' }), // dropped: not a lowercase-kebab slug
      validItem({ slug: 'charlie', greeting: undefined }), // dropped: missing a required field
    );

    const call_ = call(root);
    assert.deepEqual(slugs(call_.result), ['alpha']);
    assert.equal(call_.result.declared, 3);
  });

  test('is zero when nothing was declared at all', () => {
    const empty = makeRoot();
    writeManifest(empty, withFrontmatter('contexts: []'));

    assert.equal(call(empty).result.declared, 0);
    assert.equal(call(makeRoot()).result.declared, 0, 'an absent manifest declares nothing');
  });

  test('is zero when the contexts key is unusable, which is not the same as declaring entries', () => {
    for (const frontmatter of ['title: Chat contexts', 'contexts:', 'contexts: nope']) {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(frontmatter));
      assert.equal(call(root).result.declared, 0, `expected 0 declared for: ${frontmatter}`);
    }
  });
});

/* ----------------------------------------------------- the hint length bound */
//
// The bound is not cosmetic. The chat worker refuses a request whose `hint` exceeds
// its own MAX_HINT_CHARS with a 400 for the WHOLE request, so a manifest that shipped
// a longer hint would make every question asked from that context fail -- permanently,
// for anyone who scanned that printed code. Catching it here, at the same place every
// other manifest defect is caught, is what keeps it out of a build.

describe('a hint over the length bound', () => {
  const hintOf = (length) => 'x'.repeat(length);

  test('a hint exactly at the bound is kept', () => {
    const hint = hintOf(CONTEXT_HINT_MAX_CHARS);
    const root = rootWith(validItem({ hint }));

    const { result, logged } = call(root);
    assert.deepEqual(result.contexts, [expectedContext({ hint })]);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(logged, []);
  });

  test('one character over the bound loses the hint and keeps the context', () => {
    const root = rootWith(validItem({ hint: hintOf(CONTEXT_HINT_MAX_CHARS + 1) }), validItem({ slug: 'charlie' }));

    const call_ = call(root);
    assert.deepEqual(
      slugs(call_.result),
      ['alpha', 'charlie'],
      'an over-long hint must never drop a context: the code is already on a wall',
    );
    assert.equal(call_.result.contexts[0].hint, null);

    const warning = onlyWarning(call_);
    assert.ok(warning.includes('hint'), `expected the warning to name "hint", got: ${warning}`);
    assert.ok(
      warning.includes(String(CONTEXT_HINT_MAX_CHARS)),
      `expected the warning to name the ${CONTEXT_HINT_MAX_CHARS}-character bound, got: ${warning}`,
    );
  });

  test('the bound is measured after trimming, exactly as the worker measures it', () => {
    // A quoted scalar, so YAML keeps the padding a plain scalar would strip.
    const root = rootWith(validItem({ hint: `"   ${hintOf(CONTEXT_HINT_MAX_CHARS)}   "` }));

    const { result, logged } = call(root);
    assert.deepEqual(result.contexts, [expectedContext({ hint: hintOf(CONTEXT_HINT_MAX_CHARS) })]);
    assert.deepEqual(result.warnings, [], 'padding is not content and must not spend the bound');
    assert.deepEqual(logged, []);
  });
});

/* ------------------------------------------------------- the article field */

describe('an article link with a route set supplied', () => {
  const ROUTES = ['/guides/alpha', '/guides/bravo'];

  test('a resolvable link is kept as the trimmed value', () => {
    const root = rootWith(validItem({ article: '/guides/alpha' }));

    const { result, logged } = call(root, { knownRoutes: ROUTES });
    assert.deepEqual(result.contexts, [expectedContext({ article: '/guides/alpha' })]);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(logged, []);
  });

  test('a padded link is trimmed before it is matched', () => {
    const root = rootWith(validItem({ article: '"  /guides/alpha  "' }));

    const { result } = call(root, { knownRoutes: ROUTES });
    assert.deepEqual(result.contexts, [expectedContext({ article: '/guides/alpha' })]);
  });

  test('a Set of routes is accepted as well as an array', () => {
    const root = rootWith(validItem({ article: '/guides/alpha' }));

    const { result } = call(root, { knownRoutes: new Set(ROUTES) });
    assert.deepEqual(slugs(result), ['alpha']);
    assert.equal(result.contexts[0].article, '/guides/alpha');
  });

  for (const [what, article] of [
    ['a trailing slash', '/guides/alpha/'],
    ['a query string', '/guides/alpha?ref=qr'],
    ['a fragment', '/guides/alpha#section'],
    ['a trailing slash and a fragment', '/guides/alpha/#section'],
  ]) {
    test(`${what} still matches the known route, and the value is kept as written`, () => {
      const root = rootWith(validItem({ article: `"${article}"` }));

      const { result, logged } = call(root, { knownRoutes: ROUTES });
      assert.deepEqual(slugs(result), ['alpha'], `expected "${article}" to resolve`);
      assert.equal(result.contexts[0].article, article);
      assert.deepEqual(logged, []);
    });
  }

  test('a known route declared with a trailing slash matches a link written without one', () => {
    const root = rootWith(validItem({ article: '/guides/charlie' }));

    const { result } = call(root, { knownRoutes: ['/guides/charlie/'] });
    assert.deepEqual(slugs(result), ['alpha']);
    assert.equal(result.contexts[0].article, '/guides/charlie');
  });

  for (const [what, article] of [
    ['an unknown route', '/guides/ghost'],
    ['a path with no leading slash', 'guides/alpha'],
    ['a protocol-relative URL', '//host.invalid/guides/alpha'],
    ['an absolute URL', 'https://host.invalid/guides/alpha'],
    ['a bare fragment', '#section'],
  ]) {
    test(`${what} drops the whole context, naming the slug and the link`, () => {
      // A printed card that promises an article nobody can reach is worse than
      // no card, so the reader refuses the whole entry rather than the link.
      const root = rootWith(validItem({ article: `"${article}"` }), validItem({ slug: 'charlie' }));

      const call_ = call(root, { knownRoutes: ROUTES });
      assert.deepEqual(slugs(call_.result), ['charlie']);
      const warning = onlyWarning(call_);
      assert.ok(warning.includes('alpha'), `expected the warning to name the slug, got: ${warning}`);
      assert.ok(warning.includes(article), `expected the warning to name "${article}", got: ${warning}`);
    });
  }

  for (const [what, value] of [
    ['a mapping', '\n      inner: value'],
    ['a list', '\n      - /guides/alpha'],
    ['a number', '7'],
  ]) {
    test(`${what} article drops the whole context, naming the slug`, () => {
      const root = rootWith(validItem({ article: value }), validItem({ slug: 'charlie' }));

      const call_ = call(root, { knownRoutes: ROUTES });
      assert.deepEqual(slugs(call_.result), ['charlie']);
      const warning = onlyWarning(call_);
      assert.ok(warning.includes('alpha'), `expected the warning to name the slug, got: ${warning}`);
    });
  }

  test('an empty route set resolves nothing, so every linked context is dropped', () => {
    const root = rootWith(validItem({ article: '/guides/alpha' }), validItem({ slug: 'charlie' }));

    const call_ = call(root, { knownRoutes: [] });
    assert.deepEqual(slugs(call_.result), ['charlie']);
    onlyWarning(call_);
  });

  test('a context with no article is untouched by the route set', () => {
    const root = rootWith(validItem());

    const { result, logged } = call(root, { knownRoutes: ROUTES });
    assert.deepEqual(result.contexts, [expectedContext()]);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(logged, []);
  });
});

describe('an article link with no route set supplied', () => {
  // "This link resolves to no built route" is undecidable without the route set,
  // so the reader may not act on it: the context survives and the link is
  // dropped, which is the difference between a checked claim and an unchecked one.
  for (const [what, args] of [
    ['the options argument is omitted', []],
    ['the options object carries no knownRoutes', [{}]],
  ]) {
    test(`${what}, the context survives with a null article and a warning`, () => {
      const root = rootWith(validItem({ article: '/guides/alpha' }));

      const call_ = call(root, ...args);
      assert.deepEqual(call_.result.contexts, [expectedContext({ article: null })]);
      const warning = onlyWarning(call_);
      assert.ok(warning.includes('alpha'), `expected the warning to name the slug, got: ${warning}`);
      assert.match(warning, /route/i, `expected the warning to explain the missing route set, got: ${warning}`);
    });
  }

  test('an unresolvable-looking link is still not grounds to drop the context', () => {
    const root = rootWith(validItem({ article: '/guides/ghost' }), validItem({ slug: 'charlie' }));

    const call_ = call(root);
    assert.deepEqual(slugs(call_.result), ['alpha', 'charlie']);
    assert.equal(call_.result.contexts[0].article, null);
    onlyWarning(call_);
  });

  test('a manifest with no article links warns nothing at all', () => {
    const root = rootWith(validItem({ slug: 'alpha' }), validItem({ slug: 'charlie' }));

    const { result, logged } = call(root);
    assert.deepEqual(slugs(result), ['alpha', 'charlie']);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(logged, []);
  });
});

/* ---------------------------------------------- warnings reach the transcript */

describe('warnings reach the build transcript', () => {
  test('every warning is emitted through console.warn during the call', () => {
    const root = rootWith(
      validItem({ slug: 'alpha' }),
      '  - not a mapping at all',
      validItem({ slug: 'North-dock' }),
      item('slug: charlie'),
      validItem({ slug: 'delta', article: '/guides/ghost' }),
    );

    const call_ = call(root, { knownRoutes: ['/guides/alpha'] });
    assert.deepEqual(slugs(call_.result), ['alpha']);
    assert.equal(call_.result.warnings.length, 4, JSON.stringify(call_.result.warnings));
    assertWarningsWereLogged(call_);
  });

  test('a clean manifest emits nothing at all', () => {
    const root = rootWith(validItem());

    const { result, logged } = call(root);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(logged, []);
  });
});
