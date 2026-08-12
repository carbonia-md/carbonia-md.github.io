// soundscape-manifest.test.mjs -- run with
// `node --experimental-strip-types --test tests/soundscape-manifest.test.mjs`.
//
// src/lib/sounds.ts is the whole read side of the soundscape page: it turns a
// hand-edited knowledge/sounds/_manifest.md into the list the page renders. The
// page has no player library and no server, so every degradation the DoD names
// has to happen here -- an absent manifest, an empty list, and an entry whose
// audio file was never committed all have to leave the build green while the
// remaining entries still render, and every skipped entry has to say so loudly
// enough to appear in an `astro build` transcript.
//
// The manifest has two accepted shapes: a flat top-level `sounds:` list (what
// shipped first) and a `categories:` list. Both normalize into the same
// `categories` array, so the flat shape must keep rendering forever -- an
// adopter's manifest is theirs, and an upgrade may not break it.
//
// These suites are written against the published contract only. Fixtures are
// real directory trees under the OS temp dir, never the repository's own
// knowledge/ or public/.
//
// This file lives under tests/, which both machine gates scan: its source is
// pure ASCII and carries no denylisted place term.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  CATEGORY_OPTIONAL_FIELDS,
  CATEGORY_REQUIRED_FIELDS,
  IMPLICIT_CATEGORY_ID,
  MANIFEST_PATH,
  RECORDING_OPTIONAL_FIELDS,
  RECORDING_REQUIRED_FIELDS,
  WISHLIST_REQUIRED_FIELDS,
  readSoundscape,
} from '../src/lib/sounds.ts';

/* ------------------------------------------------------------------ fixtures */

const MADE = [];

after(() => {
  for (const dir of MADE) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway site root. Nothing here touches the repository tree. */
function makeRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'sekai-soundscape-'));
  MADE.push(dir);
  return dir;
}

/** Write the manifest at the contract's path, creating knowledge/sounds/. */
function writeManifest(root, source) {
  const file = join(root, 'knowledge', 'sounds', '_manifest.md');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  return file;
}

/** Place a byte-blob where a site-root-absolute `file` value resolves. */
function writeAudio(root, sitePath) {
  const file = join(root, 'public', sitePath.replace(/^\/+/, ''));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'not really audio, never parsed');
  return file;
}

/** `---` frontmatter + free-form body, the shape a human edits. */
const withFrontmatter = (frontmatter, body = '') => `---\n${frontmatter}\n---\n${body}`;

/** One YAML list item from `key: value` lines. */
const item = (...lines) => lines.map((line, i) => (i === 0 ? `  - ${line}` : `    ${line}`)).join('\n');

/** A `sounds:` list from item() blocks. */
const sounds = (...items) => ['sounds:', ...items].join('\n');

/**
 * A complete, valid entry. Values are deliberately place-neutral and mostly
 * digit-free so that an index assertion cannot match fixture text by accident.
 */
function validItem(overrides = {}) {
  const fields = {
    title: 'Clip One',
    location: 'Site A',
    credit: 'Recorded by Contributor A',
    file: '/media/sounds/one.mp3',
    ...overrides,
  };
  return item(...Object.entries(fields).map(([key, value]) => `${key}: ${value}`));
}

/** A `wishlist:` list from item() blocks. */
const wishlist = (...items) => ['wishlist:', ...items].join('\n');

/** Indent a whole YAML block, so a `sounds:`/`wishlist:` block can nest in a category. */
const indentBlock = (block, pad = '    ') =>
  block
    .split('\n')
    .map((line) => (line === '' ? line : pad + line))
    .join('\n');

/**
 * One `categories:` list item. `fields` become `key: value` lines; `nested.sounds`
 * and `nested.wishlist` are whole blocks (from sounds()/wishlist()) indented under
 * the item. A scalar `sounds`/`wishlist` goes through `fields` instead, which is how
 * the "present but not a list" cases are written.
 */
function categoryItem(fields = {}, nested = {}) {
  const parts = [item(...Object.entries(fields).map(([key, value]) => `${key}: ${value}`))];
  for (const key of ['sounds', 'wishlist']) {
    if (nested[key] !== undefined) parts.push(indentBlock(nested[key]));
  }
  return parts.join('\n');
}

/** A `categories:` list from categoryItem() blocks. */
const categories = (...items) => ['categories:', ...items].join('\n');

/** A complete, valid category header. Ids are word-only so an index assertion cannot match one. */
function validCategory(overrides = {}, nested = {}) {
  return categoryItem({ id: 'alphagroup', icon: 'A', title: 'Group Alpha', ...overrides }, nested);
}

/** The whole SoundEntry shape: the four required values plus every optional, defaulted to null. */
function expectedEntry(overrides = {}) {
  return {
    title: 'Clip One',
    location: 'Site A',
    credit: 'Recorded by Contributor A',
    file: '/media/sounds/one.mp3',
    description: null,
    icon: null,
    contributor: null,
    contributorUrl: null,
    date: null,
    ...overrides,
  };
}

/** The category a flat manifest normalizes into: an anchor, no heading, no extras. */
const implicitCategory = (entries) => ({
  id: IMPLICIT_CATEGORY_ID,
  title: null,
  icon: null,
  article: null,
  wishlist: [],
  entries,
});

/**
 * Call the module with console.warn swapped out, so clause 11 is asserted
 * rather than dumped into the test transcript. Passing no argument exercises
 * the `root` default.
 */
function call(...args) {
  const original = console.warn;
  const logged = [];
  console.warn = (...parts) => {
    logged.push(parts.map((part) => (typeof part === 'string' ? part : String(part))).join(' '));
  };
  try {
    return { result: readSoundscape(...args), logged };
  } finally {
    console.warn = original;
  }
}

/** Clause 11: whatever is in `warnings` also reached the build transcript. */
function assertWarningsWereLogged({ result, logged }) {
  for (const warning of result.warnings) {
    assert.ok(
      logged.some((line) => line.includes(warning)),
      `expected console.warn to carry the warning: ${warning}\nlogged: ${JSON.stringify(logged)}`,
    );
  }
}

/** Clause 11 fixes the order too: the transcript carries the warnings in `warnings` order. */
function assertWarningOrder({ result, logged }) {
  let cursor = -1;
  for (const warning of result.warnings) {
    const at = logged.findIndex((line, i) => i > cursor && line.includes(warning));
    assert.ok(
      at > cursor,
      `expected "${warning}" on the transcript after line ${cursor}\nlogged: ${JSON.stringify(logged)}`,
    );
    cursor = at;
  }
}

/** One warning, its text returned for further assertions. */
function onlyWarning(call_) {
  assert.equal(
    call_.result.warnings.length,
    1,
    `expected exactly one warning, got ${JSON.stringify(call_.result.warnings)}`,
  );
  assertWarningsWereLogged(call_);
  return call_.result.warnings[0];
}

const titles = (result) => result.entries.map((entry) => entry.title);

/* ---------------------------------------------------------------- the suites */

describe('MANIFEST_PATH', () => {
  test('is the underscore-prefixed path the knowledge scanners skip', () => {
    // The `_` prefix is mandatory: three knowledge/ scanners skip `_`-prefixed
    // files, so a rename to `manifest.md` would publish the manifest as an
    // article.
    assert.equal(MANIFEST_PATH, 'knowledge/sounds/_manifest.md');
  });

  test('a manifest written without the underscore is not read', () => {
    const root = makeRoot();
    const stray = join(root, 'knowledge', 'sounds', 'manifest.md');
    mkdirSync(dirname(stray), { recursive: true });
    writeFileSync(stray, withFrontmatter(sounds(validItem()), 'body'));
    writeAudio(root, '/media/sounds/one.mp3');

    const { result } = call(root);
    // Updated for the categories array: the empty result now carries it too.
    assert.deepEqual(result, { categories: [], entries: [], notes: '', warnings: [] });
  });
});

describe('a well-formed manifest (clauses 1, 9, 10)', () => {
  test('returns every declared field of an entry, and nothing else', () => {
    const root = makeRoot();
    // The date is unquoted, the form a human actually writes, so the expected
    // value is the normalized ISO string of clause 7.
    writeManifest(root, withFrontmatter(sounds(validItem({ date: '2026-03-14' })), 'Notes for a human.\n'));
    writeAudio(root, '/media/sounds/one.mp3');

    const { result, logged } = call(root);
    // Updated for the five optional recording fields: an undeclared optional is
    // null, and "nothing else" now means exactly the nine SoundEntry keys.
    assert.deepEqual(result.entries, [expectedEntry({ date: '2026-03-14T00:00:00.000Z' })]);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(logged, [], 'a clean manifest must not warn at all');
  });

  test('resolves a declared file under <root>/public/', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(sounds(validItem({ file: '/media/sounds/nested/deep/one.mp3' }))));
    writeAudio(root, '/media/sounds/nested/deep/one.mp3');

    const { result } = call(root);
    assert.deepEqual(titles(result), ['Clip One']);
  });

  test('resolves against the root it was given, not another tree', () => {
    // The audio exists, but under a different site root. Resolving relative to
    // anything other than `root` would let this entry through.
    const elsewhere = makeRoot();
    writeAudio(elsewhere, '/media/sounds/one.mp3');
    const root = makeRoot();
    writeManifest(root, withFrontmatter(sounds(validItem())));

    const { result } = call(root);
    assert.deepEqual(result.entries, []);
    assert.equal(result.warnings.length, 1);
  });

  test('root defaults to process.cwd()', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(sounds(validItem()), 'Body from cwd.\n'));
    writeAudio(root, '/media/sounds/one.mp3');

    const before = process.cwd();
    let call_;
    try {
      process.chdir(root);
      call_ = call();
    } finally {
      process.chdir(before);
    }
    assert.deepEqual(titles(call_.result), ['Clip One']);
    assert.equal(call_.result.notes, 'Body from cwd.');
  });

  test('preserves manifest order among the entries that survive', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        sounds(
          validItem({ title: 'Clip One', file: '/media/sounds/one.mp3' }),
          validItem({ title: 'Clip Two', file: '/media/sounds/two.mp3' }),
          validItem({ title: 'Clip Three', file: '/media/sounds/three.mp3' }),
          validItem({ title: 'Clip Four', file: '/media/sounds/four.mp3' }),
        ),
      ),
    );
    // Two survive, and they are not adjacent in the manifest.
    writeAudio(root, '/media/sounds/one.mp3');
    writeAudio(root, '/media/sounds/three.mp3');

    const { result } = call(root);
    assert.deepEqual(titles(result), ['Clip One', 'Clip Three']);
  });

  test('notes is the body, trimmed', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(sounds(validItem()), '\n\nHow these were recorded.\n\nSecond paragraph.\n\n\n'),
    );
    writeAudio(root, '/media/sounds/one.mp3');

    const { result } = call(root);
    assert.equal(result.notes, 'How these were recorded.\n\nSecond paragraph.');
  });

  test('notes is the empty string when the body is empty or whitespace', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(sounds(validItem()), '   \n\n'));
    writeAudio(root, '/media/sounds/one.mp3');

    assert.equal(call(root).result.notes, '');
  });
});

describe('DoD 3(a): the manifest is absent (clause 2)', () => {
  // Updated for the categories array; the three absent-safe cases are otherwise
  // unchanged, exactly as the DoD requires.
  const empty = { categories: [], entries: [], notes: '', warnings: [] };

  test('no knowledge/ directory at all', () => {
    const root = makeRoot();
    const { result, logged } = call(root);
    assert.deepEqual(result, empty);
    assert.deepEqual(logged, []);
  });

  test('knowledge/sounds/ exists but holds no manifest', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'knowledge', 'sounds'), { recursive: true });
    const { result, logged } = call(root);
    assert.deepEqual(result, empty);
    assert.deepEqual(logged, []);
  });

  test('the manifest path is unreadable', () => {
    // A directory where the file should be: readFileSync throws EISDIR. The
    // contract puts an unreadable manifest in the same bucket as an absent one,
    // warnings included.
    const root = makeRoot();
    mkdirSync(join(root, 'knowledge', 'sounds', '_manifest.md'), { recursive: true });
    const { result, logged } = call(root);
    assert.deepEqual(result, empty);
    assert.deepEqual(logged, []);
  });

  test('an absent manifest never throws', () => {
    assert.doesNotThrow(() => readSoundscape(makeRoot()));
  });
});

describe('DoD 3(b): the list is empty or missing (clause 3)', () => {
  const cases = [
    ['no frontmatter at all', ''],
    ['frontmatter without a sounds key', 'title: Soundscape'],
    ['an explicitly empty inline list', 'sounds: []'],
    ['a sounds key with a null value', 'sounds:'],
  ];

  for (const [what, frontmatter] of cases) {
    test(`${what} yields no entries and no warnings`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(frontmatter, 'Human notes survive.\n'));

      const { result, logged } = call(root);
      assert.deepEqual(result.entries, []);
      // No entry survives, so no implicit category is created either.
      assert.deepEqual(result.categories, []);
      assert.deepEqual(result.warnings, [], 'an empty list is a supported state, not a defect');
      assert.deepEqual(logged, []);
      assert.equal(result.notes, 'Human notes survive.');
    });
  }
});

describe('sounds is present but not a list (clause 4)', () => {
  const cases = [
    ['a scalar string', 'sounds: not a list', /string/i],
    ['a number', 'sounds: 4', /number/i],
    ['a mapping', 'sounds:\n  one: /media/sounds/one.mp3', /object|map/i],
  ];

  for (const [what, frontmatter, typeMatch] of cases) {
    test(`${what} is reported once, naming the manifest path and the type`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(frontmatter));

      const call_ = call(root);
      assert.deepEqual(call_.result.entries, []);
      assert.deepEqual(call_.result.categories, []);
      const warning = onlyWarning(call_);
      assert.ok(
        warning.includes(MANIFEST_PATH),
        `expected the warning to name ${MANIFEST_PATH}, got: ${warning}`,
      );
      assert.match(warning, typeMatch);
    });
  }
});

describe('an item with a missing or non-string required field (clause 5)', () => {
  const required = ['title', 'location', 'credit', 'file'];

  for (const field of required) {
    test(`a missing ${field} skips the item and names the field`, () => {
      const root = makeRoot();
      const fields = { title: 'Clip One', location: 'Site A', credit: 'Recorded by Contributor A', file: '/media/sounds/one.mp3' };
      delete fields[field];
      writeManifest(root, withFrontmatter(sounds(item(...Object.entries(fields).map(([k, v]) => `${k}: ${v}`)))));
      writeAudio(root, '/media/sounds/one.mp3');

      const call_ = call(root);
      assert.deepEqual(call_.result.entries, []);
      const warning = onlyWarning(call_);
      assert.ok(warning.includes(field), `expected the warning to name "${field}", got: ${warning}`);
      assert.match(warning, /\b0\b/, `expected the warning to name index 0, got: ${warning}`);
    });

    test(`a non-string ${field} skips the item and names the field`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(sounds(validItem({ [field]: '\n      - a nested list' }))));
      writeAudio(root, '/media/sounds/one.mp3');

      const call_ = call(root);
      assert.deepEqual(call_.result.entries, []);
      const warning = onlyWarning(call_);
      assert.ok(warning.includes(field), `expected the warning to name "${field}", got: ${warning}`);
    });

    test(`an empty-string ${field} skips the item and names the field`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(sounds(validItem({ [field]: '""' }))));
      writeAudio(root, '/media/sounds/one.mp3');

      const call_ = call(root);
      assert.deepEqual(call_.result.entries, []);
      const warning = onlyWarning(call_);
      assert.ok(warning.includes(field), `expected the warning to name "${field}", got: ${warning}`);
    });
  }

  test('one warning names every field the item got wrong', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(sounds(item('location: Site A', 'file: /media/sounds/one.mp3'))),
    );
    writeAudio(root, '/media/sounds/one.mp3');

    const call_ = call(root);
    assert.deepEqual(call_.result.entries, []);
    const warning = onlyWarning(call_);
    assert.ok(warning.includes('title'), `expected the warning to name "title", got: ${warning}`);
    assert.ok(warning.includes('credit'), `expected the warning to name "credit", got: ${warning}`);
  });

  test('the warning names the offending item by its 0-based index', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        sounds(
          validItem({ title: 'Clip One', file: '/media/sounds/one.mp3' }),
          item('title: Clip Two', 'location: Site A', 'file: /media/sounds/two.mp3'),
          validItem({ title: 'Clip Three', file: '/media/sounds/three.mp3' }),
        ),
      ),
    );
    writeAudio(root, '/media/sounds/one.mp3');
    writeAudio(root, '/media/sounds/two.mp3');
    writeAudio(root, '/media/sounds/three.mp3');

    const call_ = call(root);
    assert.deepEqual(titles(call_.result), ['Clip One', 'Clip Three']);
    const warning = onlyWarning(call_);
    assert.match(warning, /\b1\b/, `expected the warning to name index 1, got: ${warning}`);
  });

  for (const [what, yaml] of [
    ['a bare string', '  - /media/sounds/one.mp3'],
    ['a number', '  - 7'],
    ['a nested list', '  - - title: Clip One'],
    ['a null hole', '  -'],
  ]) {
    test(`${what} in place of an item is skipped with a warning naming its index`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(['sounds:', yaml].join('\n')));

      const call_ = call(root);
      assert.deepEqual(call_.result.entries, []);
      const warning = onlyWarning(call_);
      assert.match(warning, /\b0\b/, `expected the warning to name index 0, got: ${warning}`);
    });
  }
});

describe('the file value must be a safe site-root-absolute path (clause 6)', () => {
  for (const [what, file] of [
    ['a root-relative path with no leading slash', 'media/sounds/one.mp3'],
    ['a bare filename', 'one.mp3'],
    ['a parent-directory escape', '/../secrets.mp3'],
    ['a parent-directory segment in the middle', '/media/../../etc/hosts.mp3'],
    ['a parent segment that resolves back inside public/', '/media/sounds/../sounds/one.mp3'],
  ]) {
    test(`${what} is rejected, naming the title and the value`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(sounds(validItem({ file }))));
      // The path a naive existence check would resolve to is really there, so a
      // passing run proves the value was rejected on its shape, not its absence.
      writeAudio(root, '/media/sounds/one.mp3');

      const call_ = call(root);
      assert.deepEqual(call_.result.entries, []);
      const warning = onlyWarning(call_);
      assert.ok(warning.includes('Clip One'), `expected the warning to name the title, got: ${warning}`);
      assert.ok(warning.includes(file), `expected the warning to name "${file}", got: ${warning}`);
    });
  }

  // `path.join` treats `\` as a separator on Windows, so `/media\..\..\x.mp3`
  // resolves outside public/ there, while a `/`-only split sees one harmless
  // segment and lets it through. The fixture writes the file at the literal name
  // a POSIX run resolves, so a value that is merely *missing* would not produce
  // this warning -- the assertion only passes if the shape itself was rejected.
  for (const [what, file] of [
    ['a backslash parent-directory escape', '/media\\..\\..\\secrets.mp3'],
    ['a backslash parent segment in the middle', '/media\\..\\sounds\\one.mp3'],
  ]) {
    test(`${what} is rejected on its shape, on every platform`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(sounds(validItem({ file }))));
      writeAudio(root, file);

      const call_ = call(root);
      assert.deepEqual(call_.result.entries, []);
      const warning = onlyWarning(call_);
      assert.ok(
        warning.includes('site-root-absolute'),
        `expected rejection on shape, not on absence, got: ${warning}`,
      );
      assert.ok(warning.includes(file), `expected the warning to name "${file}", got: ${warning}`);
    });
  }

  test('a filename that merely contains two dots is not a parent segment', () => {
    // `..` is rejected as a path *segment*. A dotted filename is legal, and a
    // substring test for '..' would wrongly drop this entry.
    const root = makeRoot();
    const file = '/media/sounds/take..one.mp3';
    writeManifest(root, withFrontmatter(sounds(validItem({ file }))));
    writeAudio(root, file);

    const { result, logged } = call(root);
    assert.deepEqual(titles(result), ['Clip One']);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(logged, []);
  });

  test('a rejected path does not take the rest of the list with it', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        sounds(
          validItem({ title: 'Clip One', file: 'media/sounds/one.mp3' }),
          validItem({ title: 'Clip Two', file: '/media/sounds/two.mp3' }),
        ),
      ),
    );
    writeAudio(root, '/media/sounds/one.mp3');
    writeAudio(root, '/media/sounds/two.mp3');

    const call_ = call(root);
    assert.deepEqual(titles(call_.result), ['Clip Two']);
    onlyWarning(call_);
  });
});

describe('date normalization (clause 7)', () => {
  /** Read one entry back out of a manifest whose single item carries `date`. */
  function dateOf(dateLine) {
    const root = makeRoot();
    const fields = dateLine === null ? {} : { date: dateLine };
    writeManifest(root, withFrontmatter(sounds(validItem(fields))));
    writeAudio(root, '/media/sounds/one.mp3');
    const call_ = call(root);
    assert.deepEqual(titles(call_.result), ['Clip One'], 'a date must never skip an entry');
    assert.deepEqual(call_.result.warnings, [], 'a date must never produce a warning');
    return call_.result.entries[0].date;
  }

  test('an unquoted YAML date becomes an ISO-8601 string, not String(Date)', () => {
    // gray-matter hands back a JS Date here. String(date) yields a
    // locale-dependent form like "Sat Mar 14 2026 00:00:00 GMT-0700" that breaks
    // sort and .slice(0, 10); only toISOString() satisfies this assertion.
    const value = dateOf('2026-03-14');
    assert.match(value, /^\d{4}-\d{2}-\d{2}T/, `expected an ISO-8601 date, got: ${value}`);
    assert.equal(value, '2026-03-14T00:00:00.000Z');
  });

  test('an unquoted YAML timestamp keeps its time of day', () => {
    assert.equal(dateOf('2026-03-14T09:30:00Z'), '2026-03-14T09:30:00.000Z');
  });

  test('a quoted date string is carried through unchanged', () => {
    assert.equal(dateOf('"2026-03-14"'), '2026-03-14');
  });

  test('a truthy non-string becomes its String() form', () => {
    assert.equal(dateOf('2026'), '2026');
  });

  test('an absent date is null', () => {
    assert.equal(dateOf(null), null);
  });

  test('an empty date key is null', () => {
    assert.equal(dateOf(''), null);
  });

  test('an empty-string date is null', () => {
    assert.equal(dateOf('""'), null);
  });

  test('an unparseable date string is kept, and never skips the entry', () => {
    assert.equal(dateOf('"sometime last winter"'), 'sometime last winter');
  });
});

describe('DoD 3(c): a declared file missing from public/ (clause 8)', () => {
  test('the entry is skipped and the warning names the title and the file', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(sounds(validItem({ title: 'Clip One', file: '/media/sounds/gone.mp3' }))));
    mkdirSync(join(root, 'public', 'media', 'sounds'), { recursive: true });

    const call_ = call(root);
    assert.deepEqual(call_.result.entries, []);
    const warning = onlyWarning(call_);
    assert.ok(warning.includes('Clip One'), `expected the warning to name the title, got: ${warning}`);
    assert.ok(
      warning.includes('/media/sounds/gone.mp3'),
      `expected the warning to name the declared file, got: ${warning}`,
    );
  });

  test('no public/ directory at all is the same case, not a crash', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(sounds(validItem())));

    const call_ = call(root);
    assert.deepEqual(call_.result.entries, []);
    onlyWarning(call_);
  });

  test('the remaining entries still render, in manifest order', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        sounds(
          validItem({ title: 'Clip One', file: '/media/sounds/one.mp3' }),
          validItem({ title: 'Clip Two', file: '/media/sounds/two.mp3' }),
          validItem({ title: 'Clip Three', file: '/media/sounds/three.mp3' }),
        ),
        'Notes stay.\n',
      ),
    );
    writeAudio(root, '/media/sounds/one.mp3');
    writeAudio(root, '/media/sounds/three.mp3');

    const call_ = call(root);
    assert.deepEqual(titles(call_.result), ['Clip One', 'Clip Three']);
    assert.equal(call_.result.notes, 'Notes stay.');
    const warning = onlyWarning(call_);
    assert.ok(warning.includes('Clip Two'), `expected the warning to name the skipped title, got: ${warning}`);
  });

  test('one warning per missing file, all of them on the build transcript', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        sounds(
          validItem({ title: 'Clip One', file: '/media/sounds/one.mp3' }),
          validItem({ title: 'Clip Two', file: '/media/sounds/two.mp3' }),
        ),
      ),
    );

    const call_ = call(root);
    assert.deepEqual(call_.result.entries, []);
    assert.equal(call_.result.warnings.length, 2);
    assertWarningsWereLogged(call_);
  });
});

describe('warnings reach the build transcript (clause 11)', () => {
  test('every warning is emitted through console.warn during the call', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        sounds(
          validItem({ title: 'Clip One', file: '/media/sounds/gone.mp3' }),
          item('location: Site A', 'credit: Recorded by Contributor A', 'file: /media/sounds/two.mp3'),
          validItem({ title: 'Clip Three', file: 'media/sounds/three.mp3' }),
        ),
      ),
    );

    const call_ = call(root);
    assert.deepEqual(call_.result.entries, []);
    assert.equal(call_.result.warnings.length, 3, JSON.stringify(call_.result.warnings));
    assertWarningsWereLogged(call_);
  });

  test('a clean manifest emits nothing at all', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(sounds(validItem()), 'Notes.\n'));
    writeAudio(root, '/media/sounds/one.mp3');

    const { result, logged } = call(root);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(logged, []);
  });
});

describe('malformed YAML frontmatter (clause 12)', () => {
  test('is treated as an unreadable manifest, with one warning naming the path', () => {
    const root = makeRoot();
    // An unterminated double-quoted scalar: gray-matter propagates a
    // YAMLException that readSoundscape must absorb.
    writeManifest(root, withFrontmatter('sounds: []\ntitle: "unterminated', 'Body.\n'));

    const call_ = call(root);
    assert.deepEqual(call_.result.entries, []);
    assert.equal(call_.result.notes, '');
    const warning = onlyWarning(call_);
    assert.ok(
      warning.includes(MANIFEST_PATH),
      `expected the warning to name ${MANIFEST_PATH}, got: ${warning}`,
    );
  });
});

describe('readSoundscape never throws (clause 12)', () => {
  const hostile = [
    ['an empty file', ''],
    ['a body with no frontmatter', 'Just notes, no fences.\n'],
    ['an unterminated quoted scalar', withFrontmatter('sounds: "[', 'Body.\n')],
    ['a mapping value where a key belongs', withFrontmatter('sounds: a: b: c')],
    ['a tab-indented item', withFrontmatter('sounds:\n\t- title: Clip One')],
    ['frontmatter fences with nothing between them', '---\n---\n'],
    ['a list of nulls', withFrontmatter('sounds:\n  -\n  -\n  -')],
    ['deeply nested junk', withFrontmatter('sounds:\n  - title:\n      nested:\n        deeper: [1, 2, 3]')],
    ['a file value that is a list', withFrontmatter(sounds(validItem({ file: '\n      - /media/sounds/one.mp3' })))],
    ['a title that is a mapping', withFrontmatter(sounds(validItem({ title: '\n      inner: value' })))],
    ['a date that is a mapping', withFrontmatter(sounds(validItem({ date: '\n      inner: value' })))],
    ['a very long file value', withFrontmatter(sounds(validItem({ file: `/media/sounds/${'x'.repeat(4000)}.mp3` })))],
    ['a categories key with a null value', withFrontmatter('categories:')],
    ['a categories list of nulls', withFrontmatter('categories:\n  -\n  -')],
    ['a category whose id is a mapping', withFrontmatter(categories(validCategory({ id: '\n      inner: value' })))],
    ['a category whose sounds value is a mapping', withFrontmatter(categories(validCategory({ sounds: '\n      one: two' })))],
    ['a category whose wishlist value is a scalar', withFrontmatter(categories(validCategory({ wishlist: 'not a list' })))],
    ['a wishlist of nulls', withFrontmatter(categories(validCategory({}, { wishlist: wishlist('  -', '  -') })))],
    ['deeply nested category junk', withFrontmatter('categories:\n  - id:\n      nested:\n        deeper: [1, 2, 3]')],
    ['both shapes, both broken', withFrontmatter(['categories: 3', 'sounds: 4'].join('\n'))],
  ];

  for (const [what, source] of hostile) {
    test(`${what} returns a well-formed result instead of throwing`, () => {
      const root = makeRoot();
      writeManifest(root, source);

      let call_;
      assert.doesNotThrow(() => {
        call_ = call(root);
      });
      assert.ok(Array.isArray(call_.result.categories), 'categories must be an array');
      assert.ok(Array.isArray(call_.result.entries), 'entries must be an array');
      assert.ok(Array.isArray(call_.result.warnings), 'warnings must be an array');
      assert.equal(typeof call_.result.notes, 'string', 'notes must be a string');
      assertWarningsWereLogged(call_);
    });
  }

  for (const [what, options] of [
    ['a null knownRoutes', { knownRoutes: null }],
    ['a number knownRoutes', { knownRoutes: 7 }],
    ['a mapping knownRoutes', { knownRoutes: { one: '/routes/alpha' } }],
    ['an empty options object', {}],
  ]) {
    test(`${what} returns a well-formed result instead of throwing`, () => {
      // "readSoundscape never throws, for any input" covers the options argument
      // too; what a non-iterable route set resolves to is unspecified, so only
      // the shape of the result is asserted here.
      const root = makeRoot();
      writeManifest(root, withFrontmatter(categories(validCategory({ article: '/routes/alpha' }, { sounds: sounds(validItem()) }))));
      writeAudio(root, '/media/sounds/one.mp3');

      let call_;
      assert.doesNotThrow(() => {
        call_ = call(root, options);
      });
      assert.ok(Array.isArray(call_.result.categories), 'categories must be an array');
      assert.ok(Array.isArray(call_.result.entries), 'entries must be an array');
      assert.ok(Array.isArray(call_.result.warnings), 'warnings must be an array');
    });
  }
});

/* ---------------------------------------------- DoD 1: the published schema */

describe('DoD 1: the field-name constants are the published schema', () => {
  test('a recording requires exactly title, location, credit and file', () => {
    assert.deepEqual([...RECORDING_REQUIRED_FIELDS], ['title', 'location', 'credit', 'file']);
  });

  test('a recording accepts exactly five optional fields', () => {
    assert.deepEqual(
      [...RECORDING_OPTIONAL_FIELDS],
      ['description', 'icon', 'contributor', 'contributorUrl', 'date'],
    );
  });

  test('a category requires exactly id, icon and title', () => {
    assert.deepEqual([...CATEGORY_REQUIRED_FIELDS], ['id', 'icon', 'title']);
  });

  test('a category accepts exactly one optional field, article', () => {
    assert.deepEqual([...CATEGORY_OPTIONAL_FIELDS], ['article']);
  });

  test('a wishlist item requires exactly icon and text', () => {
    assert.deepEqual([...WISHLIST_REQUIRED_FIELDS], ['icon', 'text']);
  });

  test('the implicit category id is the anchor a flat manifest normalizes into', () => {
    assert.equal(IMPLICIT_CATEGORY_ID, 'recordings');
  });
});

describe('DoD 1: the optional recording fields', () => {
  test('every optional field is returned, trimmed', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        sounds(
          validItem({
            description: '"  A short note about the clip  "',
            icon: '"  B  "',
            contributor: '"  Contributor B  "',
            contributorUrl: '"  https://example.invalid/contributor  "',
            // `date` is the one optional field the contract exempts: its
            // normalization is "unchanged", and the clause-7 suite above owns it,
            // so this fixture declares it unpadded and asserts carry-through only.
            date: '"2026-03-14"',
          }),
        ),
      ),
    );
    writeAudio(root, '/media/sounds/one.mp3');

    const { result, logged } = call(root);
    assert.deepEqual(result.entries, [
      expectedEntry({
        description: 'A short note about the clip',
        icon: 'B',
        contributor: 'Contributor B',
        contributorUrl: 'https://example.invalid/contributor',
        date: '2026-03-14',
      }),
    ]);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(logged, []);
  });

  for (const field of ['description', 'icon', 'contributor', 'contributorUrl']) {
    for (const [what, yamlValue] of [
      ['an empty-string', '""'],
      ['a whitespace-only', '"   "'],
      ['a non-string', '\n      inner: value'],
    ]) {
      test(`${what} ${field} becomes null, and never skips the entry or warns`, () => {
        const root = makeRoot();
        writeManifest(root, withFrontmatter(sounds(validItem({ [field]: yamlValue }))));
        writeAudio(root, '/media/sounds/one.mp3');

        const { result, logged } = call(root);
        assert.deepEqual(titles(result), ['Clip One'], 'an optional field must never skip an entry');
        assert.equal(result.entries[0][field], null);
        assert.deepEqual(result.warnings, [], 'an optional field must never warn');
        assert.deepEqual(logged, []);
      });
    }

    test(`an absent ${field} becomes null`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(sounds(validItem())));
      writeAudio(root, '/media/sounds/one.mp3');

      const { result } = call(root);
      assert.equal(result.entries[0][field], null);
    });
  }
});

/* ------------------------- DoD 2: the flat shape and the implicit category */

describe('DoD 2: a flat manifest normalizes into one implicit category', () => {
  test('the single category carries the anchor id and renders no heading', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(sounds(validItem())));
    writeAudio(root, '/media/sounds/one.mp3');

    const { result, logged } = call(root);
    assert.deepEqual(result.categories, [implicitCategory([expectedEntry()])]);
    assert.equal(result.categories[0].title, null, 'the implicit category renders no heading');
    assert.equal(result.categories[0].icon, null);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(logged, []);
  });

  test('the top-level entries array mirrors the implicit category, in manifest order', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        sounds(
          validItem({ title: 'Clip One', file: '/media/sounds/one.mp3' }),
          validItem({ title: 'Clip Two', file: '/media/sounds/two.mp3' }),
        ),
      ),
    );
    writeAudio(root, '/media/sounds/one.mp3');
    writeAudio(root, '/media/sounds/two.mp3');

    const { result } = call(root);
    assert.equal(result.categories.length, 1);
    assert.deepEqual(result.categories[0].entries, result.entries);
    assert.deepEqual(titles(result), ['Clip One', 'Clip Two']);
  });

  test('no implicit category is created when every entry is skipped', () => {
    // The implicit category exists only to hold surviving entries; an empty one
    // would render a heading-less empty section on the page.
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        sounds(
          validItem({ title: 'Clip One', file: '/media/sounds/gone.mp3' }),
          validItem({ title: 'Clip Two', file: '/media/sounds/also-gone.mp3' }),
        ),
      ),
    );

    const call_ = call(root);
    assert.deepEqual(call_.result.entries, []);
    assert.deepEqual(call_.result.categories, []);
    assert.equal(call_.result.warnings.length, 2);
    assertWarningsWereLogged(call_);
  });

  test('a flat manifest keeps its wishlist empty and its article null', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(sounds(validItem())));
    writeAudio(root, '/media/sounds/one.mp3');

    const { result } = call(root);
    assert.deepEqual(result.categories[0].wishlist, []);
    assert.equal(result.categories[0].article, null);
  });
});

describe('DoD 2: the manifest shipped before this change still renders', () => {
  // The structure shipped at commit 72f2895: a top-level `sounds:` list of three
  // items, each carrying the four required fields plus an unquoted `date`, all
  // three sharing one credit string. The literals here are neutral stand-ins --
  // tests/ is scanned by the place-name gate -- but the shape is the shipped one.
  const SHIPPED_CREDIT = 'Synthesized demo clip generated for the template. Not a field recording.';
  const SHIPPED_FILES = ['/media/sounds/one.mp3', '/media/sounds/two.mp3', '/media/sounds/three.mp3'];
  const SHIPPED_TITLES = ['Clip One', 'Clip Two', 'Clip Three'];
  const SHIPPED_FRONTMATTER = sounds(
    ...SHIPPED_TITLES.map((title, i) =>
      item(
        `title: ${title}`,
        `location: Site ${String.fromCharCode(65 + i)}`,
        `credit: ${SHIPPED_CREDIT}`,
        `file: ${SHIPPED_FILES[i]}`,
        'date: 2026-07-30',
      ),
    ),
  );

  /** The shipped manifest, with all three clips present under public/. */
  function shippedRoot() {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(SHIPPED_FRONTMATTER, 'How these were made.\n'));
    for (const file of SHIPPED_FILES) writeAudio(root, file);
    return root;
  }

  test('it normalizes to exactly one implicit category with no heading', () => {
    const { result } = call(shippedRoot());
    assert.equal(result.categories.length, 1);
    assert.equal(result.categories[0].id, IMPLICIT_CATEGORY_ID);
    assert.equal(result.categories[0].title, null);
    assert.equal(result.categories[0].icon, null);
    assert.equal(result.categories[0].article, null);
    assert.deepEqual(result.categories[0].wishlist, []);
  });

  test('the same three recordings survive, in order', () => {
    const { result } = call(shippedRoot());
    assert.deepEqual(titles(result), SHIPPED_TITLES);
    assert.deepEqual(result.entries.map((entry) => entry.file), SHIPPED_FILES);
    assert.deepEqual(result.categories[0].entries, result.entries);
  });

  test('each recording keeps its credit and its normalized date', () => {
    const { result } = call(shippedRoot());
    for (const entry of result.entries) {
      assert.equal(entry.credit, SHIPPED_CREDIT);
      assert.equal(entry.date, '2026-07-30T00:00:00.000Z');
    }
  });

  test('the new optional fields it never declared are null, not missing keys', () => {
    const { result } = call(shippedRoot());
    for (const entry of result.entries) {
      for (const field of ['description', 'icon', 'contributor', 'contributorUrl']) {
        assert.ok(field in entry, `expected the entry to carry the key "${field}"`);
        assert.equal(entry[field], null);
      }
    }
  });

  test('it renders with no warning at all, and keeps its notes', () => {
    const { result, logged } = call(shippedRoot());
    assert.deepEqual(result.warnings, [], 'the shipped manifest must not warn under the new reader');
    assert.deepEqual(logged, []);
    assert.equal(result.notes, 'How these were made.');
  });
});

/* ------------------------------------- DoD 1, DoD 3: the categorized shape */

describe('DoD 1: a categorized manifest', () => {
  /** Two categories, two clips each, all four audio files present. */
  function twoCategories(root) {
    writeManifest(
      root,
      withFrontmatter(
        categories(
          validCategory(
            { id: 'alphagroup', icon: 'A', title: 'Group Alpha', article: '/routes/alpha' },
            {
              sounds: sounds(
                validItem({ title: 'Clip One', file: '/media/sounds/one.mp3' }),
                validItem({ title: 'Clip Two', file: '/media/sounds/two.mp3' }),
              ),
              wishlist: wishlist(item('icon: W', 'text: A sound still wanted')),
            },
          ),
          validCategory(
            { id: 'betagroup', icon: 'B', title: 'Group Beta' },
            {
              sounds: sounds(
                validItem({ title: 'Clip Three', file: '/media/sounds/three.mp3' }),
                validItem({ title: 'Clip Four', file: '/media/sounds/four.mp3' }),
              ),
            },
          ),
        ),
        'How these were made.\n',
      ),
    );
    for (const name of ['one', 'two', 'three', 'four']) writeAudio(root, `/media/sounds/${name}.mp3`);
    return root;
  }

  test('each declared category keeps its id, icon, title and article', () => {
    const call_ = call(twoCategories(makeRoot()), { knownRoutes: ['/routes/alpha'] });
    assert.deepEqual(
      call_.result.categories.map(({ id, icon, title, article }) => ({ id, icon, title, article })),
      [
        { id: 'alphagroup', icon: 'A', title: 'Group Alpha', article: '/routes/alpha' },
        { id: 'betagroup', icon: 'B', title: 'Group Beta', article: null },
      ],
    );
    assert.deepEqual(call_.result.warnings, []);
    assert.deepEqual(call_.logged, []);
  });

  test('each category holds its own entries, and its wishlist', () => {
    const { result } = call(twoCategories(makeRoot()), { knownRoutes: ['/routes/alpha'] });
    assert.deepEqual(result.categories[0].entries.map((entry) => entry.title), ['Clip One', 'Clip Two']);
    assert.deepEqual(result.categories[1].entries.map((entry) => entry.title), ['Clip Three', 'Clip Four']);
    assert.deepEqual(result.categories[0].wishlist, [{ icon: 'W', text: 'A sound still wanted' }]);
    assert.deepEqual(result.categories[1].wishlist, []);
  });

  test('the top-level entries array is every surviving entry, in manifest order', () => {
    const { result } = call(twoCategories(makeRoot()), { knownRoutes: ['/routes/alpha'] });
    assert.deepEqual(titles(result), ['Clip One', 'Clip Two', 'Clip Three', 'Clip Four']);
  });

  test('a later category entry follows an earlier one even when earlier entries are skipped', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        categories(
          validCategory(
            { id: 'alphagroup', icon: 'A', title: 'Group Alpha' },
            {
              sounds: sounds(
                validItem({ title: 'Clip One', file: '/media/sounds/gone.mp3' }),
                validItem({ title: 'Clip Two', file: '/media/sounds/two.mp3' }),
              ),
            },
          ),
          validCategory(
            { id: 'betagroup', icon: 'B', title: 'Group Beta' },
            { sounds: sounds(validItem({ title: 'Clip Three', file: '/media/sounds/three.mp3' })) },
          ),
        ),
      ),
    );
    writeAudio(root, '/media/sounds/two.mp3');
    writeAudio(root, '/media/sounds/three.mp3');

    const call_ = call(root);
    assert.deepEqual(titles(call_.result), ['Clip Two', 'Clip Three']);
    assert.deepEqual(call_.result.categories[0].entries.map((entry) => entry.title), ['Clip Two']);
    onlyWarning(call_);
  });

  test('notes still come from the body', () => {
    const { result } = call(twoCategories(makeRoot()), { knownRoutes: ['/routes/alpha'] });
    assert.equal(result.notes, 'How these were made.');
  });

  test('a declared category with no surviving entries is kept, unlike the implicit one', () => {
    // The page renders a per-category empty state, so the category has to exist.
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        categories(
          validCategory(
            { id: 'alphagroup', icon: 'A', title: 'Group Alpha' },
            { sounds: sounds(validItem({ title: 'Clip One', file: '/media/sounds/gone.mp3' })) },
          ),
        ),
      ),
    );

    const call_ = call(root);
    assert.equal(call_.result.categories.length, 1, 'a declared category is kept even when empty');
    assert.deepEqual(call_.result.categories[0].entries, []);
    assert.deepEqual(call_.result.entries, []);
    onlyWarning(call_);
  });

  test('a declared category with no sounds key at all is kept, with no warning', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(categories(validCategory())));

    const { result, logged } = call(root);
    assert.equal(result.categories.length, 1);
    assert.deepEqual(result.categories[0].entries, []);
    assert.deepEqual(result.categories[0].wishlist, []);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(logged, []);
  });

  test('an empty categories list yields no categories and no warning', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter('categories: []', 'Human notes survive.\n'));

    const { result, logged } = call(root);
    assert.deepEqual(result.categories, []);
    assert.deepEqual(result.entries, []);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(logged, []);
    assert.equal(result.notes, 'Human notes survive.');
  });
});

describe('both manifest shapes declared at once', () => {
  test('a top-level sounds list is ignored, with one warning naming the manifest', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        [
          categories(
            validCategory(
              { id: 'alphagroup', icon: 'A', title: 'Group Alpha' },
              { sounds: sounds(validItem({ title: 'Clip One', file: '/media/sounds/one.mp3' })) },
            ),
          ),
          sounds(validItem({ title: 'Clip Flat', file: '/media/sounds/flat.mp3' })),
        ].join('\n'),
      ),
    );
    // Both files exist, so a missing asset cannot explain the flat entry's absence.
    writeAudio(root, '/media/sounds/one.mp3');
    writeAudio(root, '/media/sounds/flat.mp3');

    const call_ = call(root);
    assert.deepEqual(titles(call_.result), ['Clip One'], 'the top-level list must not render');
    assert.equal(call_.result.categories.length, 1);
    const warning = onlyWarning(call_);
    assert.ok(
      warning.includes(MANIFEST_PATH),
      `expected the warning to name ${MANIFEST_PATH}, got: ${warning}`,
    );
    assert.ok(warning.includes('categories'), `expected the warning to name categories, got: ${warning}`);
    assert.match(warning, /ignor/i, `expected the warning to say the list was ignored, got: ${warning}`);
  });
});

describe('categories present but not a list falls back to the flat shape', () => {
  const cases = [
    ['a scalar string', 'categories: not a list', /string/i],
    ['a number', 'categories: 4', /number/i],
    ['a mapping', 'categories:\n  one: Group Alpha', /object|map/i],
  ];

  for (const [what, broken, typeMatch] of cases) {
    test(`${what} is reported once, naming the manifest path and the type`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter([broken, sounds(validItem())].join('\n')));
      writeAudio(root, '/media/sounds/one.mp3');

      const call_ = call(root);
      const warning = onlyWarning(call_);
      assert.ok(
        warning.includes(MANIFEST_PATH),
        `expected the warning to name ${MANIFEST_PATH}, got: ${warning}`,
      );
      assert.match(warning, typeMatch);
    });

    test(`${what} still lets the top-level sounds list render`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter([broken, sounds(validItem())].join('\n')));
      writeAudio(root, '/media/sounds/one.mp3');

      const { result } = call(root);
      assert.deepEqual(titles(result), ['Clip One']);
      assert.deepEqual(result.categories, [implicitCategory([expectedEntry()])]);
    });
  }
});

describe('DoD 3: category validation', () => {
  const required = ['id', 'icon', 'title'];

  for (const field of required) {
    test(`a missing ${field} skips the whole category, naming the field and the index`, () => {
      const root = makeRoot();
      const fields = { id: 'alphagroup', icon: 'A', title: 'Group Alpha' };
      delete fields[field];
      writeManifest(
        root,
        withFrontmatter(
          categories(
            categoryItem(fields, {
              sounds: sounds(validItem()),
              wishlist: wishlist(item('icon: W', 'text: A sound still wanted')),
            }),
          ),
        ),
      );
      writeAudio(root, '/media/sounds/one.mp3');

      const call_ = call(root);
      assert.deepEqual(call_.result.categories, [], 'a malformed category is skipped whole');
      assert.deepEqual(call_.result.entries, [], 'its entries do not render either');
      const warning = onlyWarning(call_);
      assert.ok(warning.includes(field), `expected the warning to name "${field}", got: ${warning}`);
      assert.match(warning, /\b0\b/, `expected the warning to name index 0, got: ${warning}`);
    });

    test(`an empty-string ${field} skips the whole category`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(categories(validCategory({ [field]: '""' }))));

      const call_ = call(root);
      assert.deepEqual(call_.result.categories, []);
      const warning = onlyWarning(call_);
      assert.ok(warning.includes(field), `expected the warning to name "${field}", got: ${warning}`);
    });

    test(`a non-string ${field} skips the whole category`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(categories(validCategory({ [field]: '\n      - a nested list' }))));

      const call_ = call(root);
      assert.deepEqual(call_.result.categories, []);
      const warning = onlyWarning(call_);
      assert.ok(warning.includes(field), `expected the warning to name "${field}", got: ${warning}`);
    });
  }

  test('one warning names every field the category got wrong', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(categories(categoryItem({ id: 'alphagroup' }))));

    const call_ = call(root);
    assert.deepEqual(call_.result.categories, []);
    const warning = onlyWarning(call_);
    assert.ok(warning.includes('icon'), `expected the warning to name "icon", got: ${warning}`);
    assert.ok(warning.includes('title'), `expected the warning to name "title", got: ${warning}`);
  });

  test('the warning names the offending category by its 0-based index', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        categories(
          validCategory({ id: 'alphagroup', icon: 'A', title: 'Group Alpha' }),
          categoryItem({ id: 'betagroup', icon: 'B' }),
          validCategory({ id: 'gammagroup', icon: 'C', title: 'Group Gamma' }),
        ),
      ),
    );

    const call_ = call(root);
    assert.deepEqual(call_.result.categories.map((category) => category.id), ['alphagroup', 'gammagroup']);
    const warning = onlyWarning(call_);
    assert.match(warning, /\b1\b/, `expected the warning to name index 1, got: ${warning}`);
  });

  for (const [what, yaml] of [
    ['a bare string', '  - Group Alpha'],
    ['a number', '  - 7'],
    ['a nested list', '  - - id: alphagroup'],
    ['a null hole', '  -'],
  ]) {
    test(`${what} in place of a category is skipped with a warning naming its index`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(['categories:', yaml].join('\n')));

      const call_ = call(root);
      assert.deepEqual(call_.result.categories, []);
      const warning = onlyWarning(call_);
      assert.match(warning, /\b0\b/, `expected the warning to name index 0, got: ${warning}`);
    });
  }

  test('a duplicate id skips the later category, naming the duplicated id', () => {
    // Ids are anchors on the page; two sections cannot share one.
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        categories(
          validCategory(
            { id: 'twice', icon: 'A', title: 'Group Alpha' },
            { sounds: sounds(validItem({ title: 'Clip One', file: '/media/sounds/one.mp3' })) },
          ),
          validCategory(
            { id: 'twice', icon: 'B', title: 'Group Beta' },
            { sounds: sounds(validItem({ title: 'Clip Two', file: '/media/sounds/two.mp3' })) },
          ),
        ),
      ),
    );
    writeAudio(root, '/media/sounds/one.mp3');
    writeAudio(root, '/media/sounds/two.mp3');

    const call_ = call(root);
    assert.equal(call_.result.categories.length, 1, 'the first use of an id wins');
    assert.equal(call_.result.categories[0].title, 'Group Alpha');
    assert.deepEqual(titles(call_.result), ['Clip One']);
    const warning = onlyWarning(call_);
    assert.ok(warning.includes('twice'), `expected the warning to name the duplicated id, got: ${warning}`);
  });

  test('a skipped category does not take the other categories with it', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        categories(
          categoryItem({ icon: 'A', title: 'Group Alpha' }, { sounds: sounds(validItem({ title: 'Clip One', file: '/media/sounds/one.mp3' })) }),
          validCategory(
            { id: 'betagroup', icon: 'B', title: 'Group Beta' },
            { sounds: sounds(validItem({ title: 'Clip Two', file: '/media/sounds/two.mp3' })) },
          ),
        ),
      ),
    );
    writeAudio(root, '/media/sounds/one.mp3');
    writeAudio(root, '/media/sounds/two.mp3');

    const call_ = call(root);
    assert.deepEqual(call_.result.categories.map((category) => category.id), ['betagroup']);
    assert.deepEqual(titles(call_.result), ['Clip Two']);
    onlyWarning(call_);
  });

  for (const [what, fields, nested] of [
    ['absent', {}, {}],
    ['null', { sounds: '' }, {}],
    ['an empty list', { sounds: '[]' }, {}],
  ]) {
    test(`a category whose sounds is ${what} yields no entries and no warning`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(categories(validCategory(fields, nested))));

      const { result, logged } = call(root);
      assert.equal(result.categories.length, 1);
      assert.deepEqual(result.categories[0].entries, []);
      assert.deepEqual(result.warnings, []);
      assert.deepEqual(logged, []);
    });
  }

  for (const [what, value] of [
    ['a scalar string', 'not a list'],
    ['a number', '4'],
    ['a mapping', '\n      one: /media/sounds/one.mp3'],
  ]) {
    test(`a category whose sounds is ${what} warns, naming the category id`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(categories(validCategory({ sounds: value }))));

      const call_ = call(root);
      assert.equal(call_.result.categories.length, 1, 'the category itself is still valid');
      assert.deepEqual(call_.result.categories[0].entries, []);
      const warning = onlyWarning(call_);
      assert.ok(warning.includes('alphagroup'), `expected the warning to name the category id, got: ${warning}`);
    });
  }

  for (const [what, fields] of [
    ['absent', {}],
    ['null', { wishlist: '' }],
    ['an empty list', { wishlist: '[]' }],
  ]) {
    test(`a category whose wishlist is ${what} yields no wishlist and no warning`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(categories(validCategory(fields))));

      const { result, logged } = call(root);
      assert.equal(result.categories.length, 1);
      assert.deepEqual(result.categories[0].wishlist, []);
      assert.deepEqual(result.warnings, []);
      assert.deepEqual(logged, []);
    });
  }

  for (const [what, value] of [
    ['a scalar string', 'not a list'],
    ['a number', '4'],
    ['a mapping', '\n      one: A sound still wanted'],
  ]) {
    test(`a category whose wishlist is ${what} warns, naming the category id`, () => {
      const root = makeRoot();
      writeManifest(
        root,
        withFrontmatter(categories(validCategory({ wishlist: value }, { sounds: sounds(validItem()) }))),
      );
      writeAudio(root, '/media/sounds/one.mp3');

      const call_ = call(root);
      assert.equal(call_.result.categories.length, 1);
      assert.deepEqual(call_.result.categories[0].wishlist, []);
      assert.deepEqual(titles(call_.result), ['Clip One'], 'a broken wishlist must not drop the recordings');
      const warning = onlyWarning(call_);
      assert.ok(warning.includes('alphagroup'), `expected the warning to name the category id, got: ${warning}`);
    });
  }
});

describe('DoD 1, DoD 3: wishlist entries', () => {
  test('a well-formed wishlist is returned as icon and text, in manifest order', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        categories(
          validCategory(
            {},
            {
              wishlist: wishlist(
                item('icon: W', 'text: A sound still wanted'),
                item('icon: X', 'text: Another sound still wanted'),
              ),
            },
          ),
        ),
      ),
    );

    const { result, logged } = call(root);
    assert.deepEqual(result.categories[0].wishlist, [
      { icon: 'W', text: 'A sound still wanted' },
      { icon: 'X', text: 'Another sound still wanted' },
    ]);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(logged, []);
  });

  for (const field of ['icon', 'text']) {
    for (const [what, mutate] of [
      ['a missing', (fields) => { delete fields[field]; }],
      ['an empty-string', (fields) => { fields[field] = '""'; }],
      ['a non-string', (fields) => { fields[field] = '\n        - a nested list'; }],
    ]) {
      test(`${what} ${field} skips that wishlist item alone`, () => {
        const root = makeRoot();
        const fields = { icon: 'W', text: 'A sound still wanted' };
        mutate(fields);
        writeManifest(
          root,
          withFrontmatter(
            categories(
              validCategory(
                {},
                {
                  sounds: sounds(validItem()),
                  wishlist: wishlist(
                    item(...Object.entries(fields).map(([key, value]) => `${key}: ${value}`)),
                    item('icon: X', 'text: Another sound still wanted'),
                  ),
                },
              ),
            ),
          ),
        );
        writeAudio(root, '/media/sounds/one.mp3');

        const call_ = call(root);
        assert.deepEqual(
          call_.result.categories[0].wishlist,
          [{ icon: 'X', text: 'Another sound still wanted' }],
          'the other wishlist items still render',
        );
        assert.deepEqual(titles(call_.result), ['Clip One'], 'the recordings still render');
        const warning = onlyWarning(call_);
        assert.ok(warning.includes('alphagroup'), `expected the warning to name the category id, got: ${warning}`);
        assert.match(warning, /\b0\b/, `expected the warning to name index 0, got: ${warning}`);
      });
    }
  }

  for (const [what, yaml] of [
    ['a bare string', '  - A sound still wanted'],
    ['a number', '  - 7'],
    ['a nested list', '  - - icon: W'],
    ['a null hole', '  -'],
  ]) {
    test(`${what} in place of a wishlist item is skipped, naming the category and the index`, () => {
      const root = makeRoot();
      writeManifest(
        root,
        withFrontmatter(categories(validCategory({}, { wishlist: ['wishlist:', yaml].join('\n') }))),
      );

      const call_ = call(root);
      assert.deepEqual(call_.result.categories[0].wishlist, []);
      const warning = onlyWarning(call_);
      assert.ok(warning.includes('alphagroup'), `expected the warning to name the category id, got: ${warning}`);
      assert.match(warning, /\b0\b/, `expected the warning to name index 0, got: ${warning}`);
    });
  }

  test('the warning names the offending wishlist item by its 0-based index', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        categories(
          validCategory(
            {},
            {
              wishlist: wishlist(
                item('icon: W', 'text: A sound still wanted'),
                item('icon: X'),
                item('icon: Y', 'text: A third sound still wanted'),
              ),
            },
          ),
        ),
      ),
    );

    const call_ = call(root);
    assert.deepEqual(call_.result.categories[0].wishlist.map((entry) => entry.icon), ['W', 'Y']);
    const warning = onlyWarning(call_);
    assert.match(warning, /\b1\b/, `expected the warning to name index 1, got: ${warning}`);
  });
});

describe('DoD 3: a skipped recording inside a declared category names the category', () => {
  test('the warning carries the category id as well as the field', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        categories(
          validCategory(
            { id: 'alphagroup', icon: 'A', title: 'Group Alpha' },
            { sounds: sounds(item('title: Clip One', 'location: Site A', 'file: /media/sounds/one.mp3')) },
          ),
        ),
      ),
    );
    writeAudio(root, '/media/sounds/one.mp3');

    const call_ = call(root);
    assert.deepEqual(call_.result.entries, []);
    const warning = onlyWarning(call_);
    assert.ok(warning.includes('alphagroup'), `expected the warning to name the category id, got: ${warning}`);
    assert.ok(warning.includes('credit'), `expected the warning to name the missing field, got: ${warning}`);
  });

  test('a missing asset inside a category names the category, the title and the file', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        categories(
          validCategory(
            { id: 'alphagroup', icon: 'A', title: 'Group Alpha' },
            { sounds: sounds(validItem({ title: 'Clip One', file: '/media/sounds/gone.mp3' })) },
          ),
        ),
      ),
    );

    const call_ = call(root);
    const warning = onlyWarning(call_);
    assert.ok(warning.includes('alphagroup'), `expected the warning to name the category id, got: ${warning}`);
    assert.ok(warning.includes('Clip One'), `expected the warning to name the title, got: ${warning}`);
    assert.ok(
      warning.includes('/media/sounds/gone.mp3'),
      `expected the warning to name the declared file, got: ${warning}`,
    );
  });

  test('the index in the warning counts within the entry own category list', () => {
    // Two good entries in the first category, then a bad entry at position 0 of
    // the second: a reader counting across the whole manifest would say 2.
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        categories(
          validCategory(
            { id: 'alphagroup', icon: 'A', title: 'Group Alpha' },
            {
              sounds: sounds(
                validItem({ title: 'Clip One', file: '/media/sounds/one.mp3' }),
                validItem({ title: 'Clip Two', file: '/media/sounds/two.mp3' }),
              ),
            },
          ),
          validCategory(
            { id: 'betagroup', icon: 'B', title: 'Group Beta' },
            { sounds: sounds(item('location: Site A', 'credit: Recorded by Contributor A', 'file: /media/sounds/three.mp3')) },
          ),
        ),
      ),
    );
    for (const name of ['one', 'two', 'three']) writeAudio(root, `/media/sounds/${name}.mp3`);

    const call_ = call(root);
    assert.deepEqual(titles(call_.result), ['Clip One', 'Clip Two']);
    const warning = onlyWarning(call_);
    assert.ok(warning.includes('betagroup'), `expected the warning to name the category id, got: ${warning}`);
    assert.match(warning, /\b0\b/, `expected the warning to name index 0, got: ${warning}`);
    assert.ok(!/\b2\b/.test(warning), `expected a per-category index, not a manifest-wide one, got: ${warning}`);
  });
});

/* --------------------------------- DoD 4: article route validation */

describe('DoD 4: a category article is proven against the built routes', () => {
  /** A one-category manifest with one valid recording; `yamlValue` is raw YAML, null for no key. */
  function articleRoot(yamlValue) {
    const root = makeRoot();
    const fields = { id: 'alphagroup', icon: 'A', title: 'Group Alpha' };
    if (yamlValue !== null) fields.article = yamlValue;
    writeManifest(root, withFrontmatter(categories(categoryItem(fields, { sounds: sounds(validItem()) }))));
    writeAudio(root, '/media/sounds/one.mp3');
    return root;
  }

  const articleOf = (call_) => call_.result.categories[0].article;

  test('a declared route this build produces is kept, with no warning', () => {
    const call_ = call(articleRoot('"/routes/alpha"'), { knownRoutes: ['/routes/alpha'] });
    assert.equal(articleOf(call_), '/routes/alpha');
    assert.deepEqual(call_.result.warnings, []);
    assert.deepEqual(call_.logged, []);
  });

  test('a trailing slash on the declared value still matches the route', () => {
    const call_ = call(articleRoot('"/routes/alpha/"'), { knownRoutes: ['/routes/alpha'] });
    assert.equal(articleOf(call_), '/routes/alpha/', 'the declared form is what gets linked');
    assert.deepEqual(call_.result.warnings, []);
  });

  test('a trailing slash on the known route still matches the declared value', () => {
    const call_ = call(articleRoot('"/routes/alpha"'), { knownRoutes: ['/routes/alpha/'] });
    assert.equal(articleOf(call_), '/routes/alpha');
    assert.deepEqual(call_.result.warnings, []);
  });

  test('a fragment is ignored when matching and preserved in the link', () => {
    const call_ = call(articleRoot('"/routes/alpha#recordings"'), { knownRoutes: ['/routes/alpha'] });
    assert.equal(articleOf(call_), '/routes/alpha#recordings');
    assert.deepEqual(call_.result.warnings, []);
  });

  test('a query is ignored when matching and preserved in the link', () => {
    const call_ = call(articleRoot('"/routes/alpha?from=soundscape"'), { knownRoutes: ['/routes/alpha'] });
    assert.equal(articleOf(call_), '/routes/alpha?from=soundscape');
    assert.deepEqual(call_.result.warnings, []);
  });

  test('the declared value is trimmed before it is matched and before it is linked', () => {
    const call_ = call(articleRoot('"  /routes/alpha  "'), { knownRoutes: ['/routes/alpha'] });
    assert.equal(articleOf(call_), '/routes/alpha');
    assert.deepEqual(call_.result.warnings, []);
  });

  test('knownRoutes may be any iterable, not only an array', () => {
    const call_ = call(articleRoot('"/routes/alpha"'), { knownRoutes: new Set(['/routes/alpha']) });
    assert.equal(articleOf(call_), '/routes/alpha');
    assert.deepEqual(call_.result.warnings, []);
  });

  test('a route this build does not produce is omitted rather than shipped as a 404', () => {
    const call_ = call(articleRoot('"/routes/alpha"'), { knownRoutes: ['/routes/beta'] });
    assert.equal(articleOf(call_), null, 'the link is omitted, not shipped');
    assert.deepEqual(titles(call_.result), ['Clip One'], 'the category still renders its recordings');
    const warning = onlyWarning(call_);
    assert.ok(warning.includes('alphagroup'), `expected the warning to name the category, got: ${warning}`);
    assert.ok(warning.includes('/routes/alpha'), `expected the warning to name the declared value, got: ${warning}`);
  });

  test('a fragment-only difference does not rescue an unbuilt route', () => {
    const call_ = call(articleRoot('"/routes/alpha#recordings"'), { knownRoutes: ['/routes/beta'] });
    assert.equal(articleOf(call_), null);
    onlyWarning(call_);
  });

  for (const [what, yamlValue, declared] of [
    ['a root-relative path', '"routes/alpha"', 'routes/alpha'],
    ['a bare slug', '"alpha"', 'alpha'],
    ['an absolute URL', '"https://example.invalid/routes/alpha"', 'https://example.invalid/routes/alpha'],
  ]) {
    test(`${what} is not site-root-absolute, so the link is omitted`, () => {
      // The declared value is planted in knownRoutes, so a pass proves the value
      // was rejected on its shape rather than merely missing from the route set.
      const call_ = call(articleRoot(yamlValue), { knownRoutes: ['/routes/alpha', declared] });
      assert.equal(articleOf(call_), null);
      const warning = onlyWarning(call_);
      assert.ok(warning.includes('alphagroup'), `expected the warning to name the category, got: ${warning}`);
      assert.ok(warning.includes(declared), `expected the warning to name the declared value, got: ${warning}`);
    });
  }

  test('a protocol-relative URL is not a route this build produces, so the link is omitted', () => {
    // `//host/path` carries a leading slash, so the contract's shape test alone
    // does not settle it; what does settle it is that no build ever produces such
    // a route, so it can never be proven and can never ship.
    const call_ = call(articleRoot('"//example.invalid/routes/alpha"'), { knownRoutes: ['/routes/alpha'] });
    assert.equal(articleOf(call_), null, 'an off-site link must never ship from a category article');
    const warning = onlyWarning(call_);
    assert.ok(warning.includes('alphagroup'), `expected the warning to name the category, got: ${warning}`);
  });

  for (const [what, yamlValue] of [
    ['an empty-string', '""'],
    ['a whitespace-only', '"   "'],
    ['a non-string', '\n      - /routes/alpha'],
  ]) {
    test(`${what} article is omitted, with a warning naming the category`, () => {
      const call_ = call(articleRoot(yamlValue), { knownRoutes: ['/routes/alpha'] });
      assert.equal(articleOf(call_), null);
      assert.deepEqual(titles(call_.result), ['Clip One'], 'a bad article must not drop the recordings');
      const warning = onlyWarning(call_);
      assert.ok(warning.includes('alphagroup'), `expected the warning to name the category, got: ${warning}`);
    });
  }

  test('an absent article is null, with no warning', () => {
    const call_ = call(articleRoot(null), { knownRoutes: ['/routes/alpha'] });
    assert.equal(articleOf(call_), null);
    assert.deepEqual(call_.result.warnings, []);
    assert.deepEqual(call_.logged, []);
  });

  test('an empty knownRoutes is a supplied route set: every article misses it', () => {
    const call_ = call(articleRoot('"/routes/alpha"'), { knownRoutes: [] });
    assert.equal(articleOf(call_), null);
    const warning = onlyWarning(call_);
    assert.ok(warning.includes('alphagroup'), `expected the warning to name the category, got: ${warning}`);
    assert.ok(warning.includes('/routes/alpha'), `expected the warning to name the declared value, got: ${warning}`);
  });

  test('no knownRoutes at all fails closed: the link is omitted, not assumed good', () => {
    const call_ = call(articleRoot('"/routes/alpha"'));
    assert.equal(articleOf(call_), null, 'an unprovable link must not ship');
    assert.deepEqual(titles(call_.result), ['Clip One']);
    const warning = onlyWarning(call_);
    assert.ok(warning.includes('alphagroup'), `expected the warning to name the category, got: ${warning}`);
    // The contract words this warning as "no route set was supplied"; the exact
    // sentence is the implementation's, so only the word "route" is asserted here,
    // plus the distinctness test below.
    assert.match(warning, /route/i, `expected the warning to talk about the route set, got: ${warning}`);
  });

  test('the fail-closed warning is a different message from the does-not-resolve one', () => {
    // Both cases omit the link, so the transcript text is the only thing that
    // tells a maintainer "you forgot to pass the route set" apart from
    // "that article does not exist".
    const unsupplied = onlyWarning(call(articleRoot('"/routes/alpha"')));
    const unresolved = onlyWarning(call(articleRoot('"/routes/alpha"'), { knownRoutes: ['/routes/beta'] }));
    assert.notEqual(unsupplied, unresolved);
  });

  test('a manifest with no article anywhere never warns about routes', () => {
    const { result, logged } = call(articleRoot(null));
    assert.deepEqual(result.warnings, [], 'fail-closed must not fire when nothing declares an article');
    assert.deepEqual(logged, []);
  });

  test('a flat manifest never warns about routes either', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(sounds(validItem())));
    writeAudio(root, '/media/sounds/one.mp3');

    const { result, logged } = call(root);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(logged, []);
  });

  test('one fail-closed warning per category that declares an article, and no more', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        categories(
          validCategory({ id: 'alphagroup', icon: 'A', title: 'Group Alpha', article: '"/routes/alpha"' }),
          validCategory({ id: 'betagroup', icon: 'B', title: 'Group Beta', article: '"/routes/beta"' }),
          validCategory({ id: 'gammagroup', icon: 'C', title: 'Group Gamma' }),
        ),
      ),
    );

    const call_ = call(root);
    assert.deepEqual(call_.result.categories.map((category) => category.article), [null, null, null]);
    assert.equal(call_.result.warnings.length, 2, JSON.stringify(call_.result.warnings));
    assert.ok(call_.result.warnings[0].includes('alphagroup'));
    assert.ok(call_.result.warnings[1].includes('betagroup'));
    assertWarningsWereLogged(call_);
  });

  test('a skipped category produces no article warning at all', () => {
    // The category never survives validation, so there is nothing to link.
    const root = makeRoot();
    writeManifest(root, withFrontmatter(categories(categoryItem({ id: 'alphagroup', icon: 'A', article: '/routes/alpha' }))));

    const call_ = call(root, { knownRoutes: [] });
    assert.deepEqual(call_.result.categories, []);
    const warning = onlyWarning(call_);
    assert.ok(warning.includes('title'), `expected the one warning to be the category one, got: ${warning}`);
  });
});

describe('warnings reach the build transcript in order (clause 11)', () => {
  test('a categorized manifest logs its warnings in the order warnings carries them', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        categories(
          validCategory(
            { id: 'alphagroup', icon: 'A', title: 'Group Alpha', article: '"/routes/alpha"' },
            {
              sounds: sounds(validItem({ title: 'Clip One', file: '/media/sounds/gone.mp3' })),
              wishlist: wishlist(item('icon: W')),
            },
          ),
          categoryItem({ id: 'betagroup', icon: 'B' }),
        ),
      ),
    );

    const call_ = call(root, { knownRoutes: [] });
    assert.ok(call_.result.warnings.length >= 3, JSON.stringify(call_.result.warnings));
    assertWarningsWereLogged(call_);
    assertWarningOrder(call_);
  });
});

test('DoD 11: the soundscape page is centered like the visual reference', () => {
  const template = readFileSync(
    new URL('../src/templates/soundscape.template.astro', import.meta.url),
    'utf8',
  );

  assert.match(template, /\.soundscape\s*\{[^}]*max-width:\s*900px;[^}]*margin:\s*0 auto;/s);
  assert.match(template, /\.hero\s*\{[^}]*text-align:\s*center;/s);
  assert.match(template, /\.hero-subtitle\s*\{[^}]*margin:\s*0\.6rem auto 0;/s);
  assert.match(template, /\.stats\s*\{[^}]*justify-content:\s*center;/s);
});
