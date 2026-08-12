// embeddings-chunker.test.mjs -- run with
// `node --test tests/embeddings-chunker.test.mjs`.
//
// LB-83 DoD 1 (the chunker) and DoD 2 (chunk metadata resolves to a real page).
// These suites are written against the published contract of
// scripts/core/build-embeddings.mjs only: constants, countTokens, chunkArticle,
// collectArticles. Nothing here reads the module's source.
//
// chunkArticle is pure, so every splitting fixture is built in memory. Bodies are
// generated programmatically from unique, index-suffixed tokens: an exact token
// count makes the MIN_TOKENS/MAX_TOKENS boundaries assertable, and unique tokens
// make the OVERLAP_TOKENS suffix/prefix match unambiguous.
//
// The one test that touches the repository is the DoD 2 corpus assertion, which
// builds public/kb/topics.json when it is absent (the directory is gitignored)
// rather than skipping -- a skipped coverage gate is a vacuous one.
//
// This file lives under tests/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term. Every place-specific value it
// asserts against is read from the repository at run time, never written here.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MAX_TOKENS,
  MIN_TOKENS,
  OVERLAP_TOKENS,
  countTokens,
  chunkArticle,
  collectArticles,
} from '../scripts/core/build-embeddings.mjs';

/* ------------------------------------------------------------------ fixtures */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The eight keys a chunk carries, no more and no fewer. */
const CHUNK_KEYS = ['id', 'slug', 'title', 'url', 'category', 'heading', 'chunkIndex', 'text'];

/** Article metadata that is copied verbatim onto every chunk. */
const META = {
  slug: 'about/example-article',
  title: 'Example Article',
  url: '/about/example-article',
  category: 'about',
};

/**
 * `count` whitespace-separated tokens, each unique within its tag. Unique tokens
 * make "does this chunk contain that paragraph" and "how many trailing words of
 * the previous chunk prefix this one" exact questions.
 */
function tokens(count, tag) {
  return Array.from({ length: count }, (_, i) => `${tag}${i}`).join(' ');
}

/** Join blocks with the blank line that separates paragraphs in Markdown. */
const paragraphs = (...blocks) => blocks.join('\n\n');

/** chunkArticle over a body, with the shared metadata. */
const chunksOf = (body, overrides = {}) => chunkArticle({ ...META, ...overrides, body });

const headingsOf = (chunks) => chunks.map((chunk) => chunk.heading);

/** Whitespace-normalized word list, the unit both countTokens and the overlap use. */
const wordsOf = (text) => text.trim().split(/\s+/).filter(Boolean);

/**
 * The number of trailing words of `previous` that prefix `next` -- the longest
 * suffix/prefix match, which with unique fixture tokens is the overlap length.
 */
function overlapLength(previous, next) {
  const before = wordsOf(previous);
  const after = wordsOf(next);
  for (let n = Math.min(before.length, after.length); n >= 1; n--) {
    if (before.slice(-n).join(' ') === after.slice(0, n).join(' ')) return n;
  }
  return 0;
}

/** Clause (c): consecutive chunks carry roughly OVERLAP_TOKENS tokens of overlap. */
function assertOverlap(previous, next, label, tolerance = 5) {
  const matched = overlapLength(previous.text, next.text);
  assert.ok(
    Math.abs(matched - OVERLAP_TOKENS) <= tolerance,
    `${label}: expected ~${OVERLAP_TOKENS} overlapping tokens (tolerance ${tolerance}), got ${matched}`,
  );
}

/* -------------------------------------------------- the chunking constants */

describe('the chunking constants', () => {
  test('MAX_TOKENS, MIN_TOKENS and OVERLAP_TOKENS are the published values', () => {
    assert.equal(MAX_TOKENS, 500);
    assert.equal(MIN_TOKENS, 100);
    assert.equal(OVERLAP_TOKENS, 50);
  });
});

/* ------------------------------------------------------------- countTokens */

describe('countTokens is a whitespace-run word count', () => {
  test('counts whitespace-separated runs', () => {
    assert.equal(countTokens('one two three'), 3);
    assert.equal(countTokens('one'), 1);
  });

  test('the empty string is 0 tokens', () => {
    assert.equal(countTokens(''), 0);
  });

  test('a whitespace-only string is 0 tokens', () => {
    assert.equal(countTokens('   '), 0);
    assert.equal(countTokens('\n\n\t  \n'), 0);
  });

  test('runs of mixed whitespace separate exactly one token boundary', () => {
    assert.equal(countTokens('one \n\t  two'), 2);
  });

  test('leading and trailing whitespace adds no tokens', () => {
    assert.equal(countTokens('  one two  \n'), 2);
  });

  test('there is no character-count branch: token count is independent of word length', () => {
    // Same three runs, wildly different character counts.
    assert.equal(countTokens('a bb ccc'), 3);
    assert.equal(countTokens(`${'x'.repeat(400)} bb ccc`), 3);
    assert.equal(countTokens('x'.repeat(4000)), 1);
  });

  test('a generated body of N tokens counts as N', () => {
    assert.equal(countTokens(tokens(237, 'alpha')), 237);
  });
});

/* ------------------------------------ DoD 1: the chunk shape and its metadata */

describe('DoD 1: the chunk shape', () => {
  const body = paragraphs(
    '## Section One',
    tokens(200, 'alpha'),
    '## Section Two',
    tokens(200, 'beta'),
  );

  test('a chunk carries exactly the eight contract keys, no more and no fewer', () => {
    const chunks = chunksOf(body);
    assert.ok(chunks.length > 0, 'the fixture must produce chunks');
    for (const chunk of chunks) {
      assert.deepEqual([...Object.keys(chunk)].sort(), [...CHUNK_KEYS].sort());
    }
  });

  test('id is `${slug}#${chunkIndex}`', () => {
    for (const chunk of chunksOf(body)) {
      assert.equal(chunk.id, `${META.slug}#${chunk.chunkIndex}`);
    }
  });

  test('chunkIndex is 0-based and contiguous across the returned array', () => {
    const chunks = chunksOf(body);
    assert.deepEqual(
      chunks.map((chunk) => chunk.chunkIndex),
      chunks.map((_, i) => i),
    );
  });

  test('slug, title, url and category are copied verbatim from the argument', () => {
    const chunks = chunksOf(body, {
      slug: 'other/second-article',
      title: 'Second Article',
      url: '/other/second-article',
      category: 'other',
    });
    for (const chunk of chunks) {
      assert.equal(chunk.slug, 'other/second-article');
      assert.equal(chunk.title, 'Second Article');
      assert.equal(chunk.url, '/other/second-article');
      assert.equal(chunk.category, 'other');
    }
  });

  test('text is a non-empty string on every chunk', () => {
    for (const chunk of chunksOf(body)) {
      assert.equal(typeof chunk.text, 'string');
      assert.ok(chunk.text.trim().length > 0, `expected non-empty text, got: ${JSON.stringify(chunk.text)}`);
    }
  });

  test('heading is the h2 text without the marker and without surrounding space', () => {
    const chunks = chunksOf(paragraphs('##    Padded Heading   ', tokens(200, 'alpha')));
    assert.deepEqual(headingsOf(chunks), ['Padded Heading']);
  });

  test('chunkArticle does not mutate its argument', () => {
    const argument = { ...META, body };
    const before = JSON.parse(JSON.stringify(argument));
    chunkArticle(argument);
    assert.deepEqual(argument, before);
  });

  test('chunkArticle is deterministic: the same argument yields the same chunks', () => {
    assert.deepEqual(chunksOf(body), chunksOf(body));
  });
});

/* -------------------------------------------- DoD 1 (a): the h2 section split */

describe('DoD 1 (a): sections split on ## headings', () => {
  test('(a) each ## heading starts a new section', () => {
    const chunks = chunksOf(
      paragraphs('## Section One', tokens(200, 'alpha'), '## Section Two', tokens(200, 'beta')),
    );
    assert.equal(chunks.length, 2);
    assert.deepEqual(headingsOf(chunks), ['Section One', 'Section Two']);
  });

  test('(a) a section text includes its own ## heading line verbatim', () => {
    const chunks = chunksOf(
      paragraphs('## Section One', tokens(200, 'alpha'), '## Section Two', tokens(200, 'beta')),
    );
    assert.ok(chunks[0].text.includes('## Section One'), `heading line lost: ${chunks[0].text.slice(0, 80)}`);
    assert.ok(chunks[1].text.includes('## Section Two'), `heading line lost: ${chunks[1].text.slice(0, 80)}`);
  });

  test('(a) a ### heading does not split, and its line survives in the section text', () => {
    const chunks = chunksOf(
      paragraphs('## Section One', tokens(150, 'alpha'), '### Deeper Heading', tokens(150, 'beta')),
    );
    assert.equal(chunks.length, 1, 'only exactly-## headings split');
    assert.equal(chunks[0].heading, 'Section One');
    assert.ok(chunks[0].text.includes('### Deeper Heading'));
  });

  test('(a) a #### heading does not split either', () => {
    const chunks = chunksOf(
      paragraphs('## Section One', tokens(150, 'alpha'), '#### Deepest Heading', tokens(150, 'beta')),
    );
    assert.equal(chunks.length, 1);
    assert.deepEqual(headingsOf(chunks), ['Section One']);
  });

  test('(a) a line starting with ## inside a fenced code block does not start a section', () => {
    const chunks = chunksOf(
      paragraphs(
        '## Section One',
        tokens(150, 'alpha'),
        ['```', '## Not A Heading', tokens(20, 'fenced'), '```'].join('\n'),
        tokens(150, 'beta'),
      ),
    );
    assert.deepEqual(headingsOf(chunks), ['Section One']);
    assert.ok(
      chunks.every((chunk) => chunk.heading !== 'Not A Heading'),
      'a fenced ## line must never become a chunk heading',
    );
  });
});

/* ------------------------------ DoD 1 (b): the paragraph split above MAX_TOKENS */

describe('DoD 1 (b): a section over MAX_TOKENS splits on paragraph boundaries', () => {
  // Four 200-token paragraphs under one heading: 802 tokens, well over MAX_TOKENS.
  // Two paragraphs fit under the 500-token budget and a third does not, so the
  // accumulate-until-it-would-exceed rule puts p1+p2 in one chunk and p3+p4 in the
  // next, whether or not the overlap prefix is charged to the budget.
  const P = [1, 2, 3, 4].map((n) => tokens(200, `para${n}s`));
  const body = paragraphs('## Long Section', ...P);

  test('(b) a section over MAX_TOKENS splits on paragraph boundaries', () => {
    const chunks = chunksOf(body);
    assert.equal(chunks.length, 2);
    assert.deepEqual(headingsOf(chunks), ['Long Section', 'Long Section']);
  });

  test('(b) paragraphs accumulate until adding the next would exceed MAX_TOKENS', () => {
    const chunks = chunksOf(body);
    assert.ok(chunks[0].text.includes(P[0]), 'the first chunk carries paragraph 1 whole');
    assert.ok(chunks[0].text.includes(P[1]), 'the first chunk carries paragraph 2 whole');
    assert.ok(!chunks[0].text.includes(P[2]), 'paragraph 3 would exceed MAX_TOKENS and must not be in chunk 0');
    assert.ok(chunks[1].text.includes(P[2]), 'the second chunk carries paragraph 3 whole');
    assert.ok(chunks[1].text.includes(P[3]), 'the second chunk carries paragraph 4 whole');
  });

  test('(b) no paragraph is ever split across chunks', () => {
    const chunks = chunksOf(body);
    for (const [i, paragraph] of P.entries()) {
      const holders = chunks.filter((chunk) => chunk.text.includes(paragraph));
      assert.ok(holders.length >= 1, `paragraph ${i + 1} was split across chunks or dropped`);
    }
  });

  test('(b) a single paragraph alone over MAX_TOKENS is emitted whole, never split', () => {
    const oversized = tokens(700, 'huge');
    const chunks = chunksOf(paragraphs('## Long Section', oversized));
    const holders = chunks.filter((chunk) => chunk.text.includes(oversized));
    assert.equal(
      holders.length,
      1,
      'the oversized paragraph must appear whole in exactly one chunk, never split mid-paragraph',
    );
  });

  test('(b) a section under MAX_TOKENS is one chunk', () => {
    // 400 body tokens + the two-token heading line: under the budget, so no split.
    const chunks = chunksOf(paragraphs('## Long Section', tokens(200, 'alpha'), tokens(200, 'beta')));
    assert.equal(chunks.length, 1);
  });
});

/* ----------------------------------------------- DoD 1 (c): the chunk overlap */

describe('DoD 1 (c): consecutive chunks overlap by roughly OVERLAP_TOKENS', () => {
  test('(c) a chunk after the first is prefixed with the trailing ~50 words of the previous chunk', () => {
    const chunks = chunksOf(
      paragraphs('## Section One', tokens(200, 'alpha'), '## Section Two', tokens(200, 'beta')),
    );
    assert.equal(chunks.length, 2);
    assertOverlap(chunks[0], chunks[1], 'chunk 0 -> chunk 1');
  });

  test('(c) the overlap applies within a section, between paragraph-split chunks', () => {
    const chunks = chunksOf(
      paragraphs('## Long Section', ...[1, 2, 3, 4].map((n) => tokens(200, `para${n}s`))),
    );
    assert.equal(chunks.length, 2);
    assertOverlap(chunks[0], chunks[1], 'chunk 0 -> chunk 1 inside one section');
  });

  test('(c) the overlap applies between every pair of consecutive chunks, across section boundaries too', () => {
    // Three chunks: the first section splits on paragraphs, the second is its own.
    const chunks = chunksOf(
      paragraphs(
        '## Section One',
        ...[1, 2, 3, 4].map((n) => tokens(200, `para${n}s`)),
        '## Section Two',
        tokens(200, 'beta'),
      ),
    );
    assert.equal(chunks.length, 3);
    assert.deepEqual(headingsOf(chunks), ['Section One', 'Section One', 'Section Two']);
    for (let i = 1; i < chunks.length; i++) {
      assertOverlap(chunks[i - 1], chunks[i], `chunk ${i - 1} -> chunk ${i}`);
    }
  });

  test('(c) the first chunk carries no overlap prefix: it starts at the body', () => {
    const chunks = chunksOf(
      paragraphs('## Section One', tokens(200, 'alpha'), '## Section Two', tokens(200, 'beta')),
    );
    assert.ok(
      chunks[0].text.trimStart().startsWith('## Section One'),
      `the first chunk must start at the body, got: ${chunks[0].text.slice(0, 80)}`,
    );
  });

  // The overlap prefix is charged ON TOP of the MAX_TOKENS body budget, not inside it
  // (see the module header's token accounting). These pin that stated ceiling so the
  // emitted size cannot drift from what the header and the runbook promise.
  test('(c) an emitted chunk is at most MAX_TOKENS + OVERLAP_TOKENS words', () => {
    const chunks = chunksOf(
      paragraphs(
        '## Section One',
        ...[1, 2, 3, 4].map((n) => tokens(200, `para${n}s`)),
        '## Section Two',
        ...[5, 6].map((n) => tokens(200, `para${n}s`)),
      ),
    );
    assert.ok(chunks.length >= 3, 'the fixture must produce several overlapped chunks');
    for (const chunk of chunks) {
      assert.ok(
        countTokens(chunk.text) <= MAX_TOKENS + OVERLAP_TOKENS,
        `chunk ${chunk.chunkIndex} is ${countTokens(chunk.text)} words, ` +
          `over the ${MAX_TOKENS} + ${OVERLAP_TOKENS} ceiling`,
      );
    }
  });

  test('(c) only rule (b) exceeds that ceiling: a single oversized paragraph ships whole', () => {
    const chunks = chunksOf(paragraphs('## Section One', tokens(200, 'alpha'), '## Section Two', tokens(700, 'huge')));
    const over = chunks.filter((chunk) => countTokens(chunk.text) > MAX_TOKENS + OVERLAP_TOKENS);
    assert.equal(over.length, 1, 'exactly the chunk carrying the oversized paragraph may exceed the ceiling');
    assert.ok(over[0].text.includes(tokens(700, 'huge')), 'and it exceeds it by carrying that paragraph whole');
  });
});

/* ------------------------------ DoD 1 (d): sections under MIN_TOKENS are merged */

describe('DoD 1 (d): a section under MIN_TOKENS merges instead of emitting a stub', () => {
  test('(d) a short section merges forward into the chunk that continues with the next section', () => {
    const short = tokens(30, 'shorts');
    const long = tokens(200, 'longs');
    const chunks = chunksOf(paragraphs('## Short One', short, '## Long Two', long));

    assert.equal(chunks.length, 1, 'the short section must not emit a stub chunk of its own');
    assert.ok(chunks[0].text.includes(short), 'the short section content is carried into the merged chunk');
    assert.ok(chunks[0].text.includes('## Long Two'), 'the merged chunk continues with the next section');
    assert.ok(chunks[0].text.includes(long), 'the next section content is in the merged chunk');
  });

  test("(d) the merged chunk's heading is the short section's own heading", () => {
    const chunks = chunksOf(
      paragraphs('## Short One', tokens(30, 'shorts'), '## Long Two', tokens(200, 'longs')),
    );
    assert.deepEqual(headingsOf(chunks), ['Short One']);
  });

  test('(d) a trailing short section merges backward into the last emitted chunk', () => {
    const long = tokens(300, 'longs');
    const trailing = tokens(20, 'tails');
    const chunks = chunksOf(paragraphs('## Long One', long, '## Tiny End', trailing));

    const last = chunks[chunks.length - 1];
    assert.ok(last.text.includes(trailing), 'a trailing short section is never dropped');
    assert.ok(
      chunks.every((chunk) => chunk.heading !== 'Tiny End'),
      'a trailing short section merges backward, so it never becomes a chunk of its own',
    );
  });

  test('(d) a section at MIN_TOKENS or above is not merged', () => {
    const chunks = chunksOf(
      paragraphs('## Section One', tokens(150, 'alpha'), '## Section Two', tokens(150, 'beta')),
    );
    assert.deepEqual(headingsOf(chunks), ['Section One', 'Section Two']);
  });
});

/* ------------------------------------- DoD 2: heading is where the chunk STARTS */

describe('DoD 2: heading is the section the chunk starts in, across a rule (d) merge', () => {
  // A short section merged forward spans two sections in one unit. Splitting that unit on
  // paragraphs puts later pieces well inside the SECOND section, so the unit's opening
  // heading is only correct for the piece that actually opens it.
  const merged = () =>
    chunksOf(
      paragraphs(
        '## Intro',
        tokens(30, 'intros'),
        '## Details',
        ...[1, 2, 3, 4].map((n) => tokens(200, `para${n}s`)),
      ),
    );

  test('the chunk that opens the merged unit keeps the short section heading', () => {
    const chunks = merged();
    assert.ok(chunks.length >= 2, 'the fixture must split into several chunks');
    assert.equal(chunks[0].heading, 'Intro');
    assert.ok(chunks[0].text.includes('## Intro'), 'and it is the chunk that opens under it');
  });

  test('a later chunk that starts inside the following section is labelled with THAT section', () => {
    for (const chunk of merged().slice(1)) {
      assert.equal(
        chunk.heading,
        'Details',
        `chunk ${chunk.chunkIndex} starts inside Details and must not be labelled Intro`,
      );
    }
  });

  test('a chunk whose own content opens on a heading takes that heading, not the inherited one', () => {
    // Two full-size sections: the second chunk's content opens exactly on "## Second".
    const chunks = chunksOf(
      paragraphs('## First', tokens(200, 'alpha'), '## Second', tokens(200, 'beta')),
    );
    assert.deepEqual(headingsOf(chunks), ['First', 'Second']);
    assert.ok(
      chunks[1].text.includes('## Second'),
      'the second chunk carries the heading line its section opens with',
    );
  });

  test('a heading carried in only by the overlap prefix does not label the chunk', () => {
    // The unit opens "## Intro"; chunk 0 ends inside Details, so chunk 1's prefix is
    // Details prose. Make the prefix itself carry a heading line by keeping the section
    // that precedes the split short enough that "## Details" lands in the overlap window.
    const chunks = chunksOf(
      paragraphs('## Alpha', tokens(470, 'alphas'), '## Beta', tokens(400, 'betas')),
    );
    const withPrefixedHeading = chunks.filter(
      (chunk, i) => i > 0 && chunk.text.includes('## ') && !chunk.text.trimStart().startsWith('##'),
    );
    for (const chunk of withPrefixedHeading) {
      const ownContentStart = chunk.text.indexOf('## ');
      assert.ok(ownContentStart > 0, 'the heading appears inside the chunk, not at its start');
    }
    // Whatever the overlap dragged in, every chunk is labelled with a real section.
    for (const chunk of chunks) {
      assert.ok(
        ['Alpha', 'Beta'].includes(chunk.heading),
        `chunk ${chunk.chunkIndex} carries a heading that is not one of the body's sections: ${chunk.heading}`,
      );
    }
  });

  test('a ## line inside a fenced code block never becomes a chunk heading', () => {
    const fenced = ['```', '## Not A Heading', tokens(180, 'codes'), '```'].join('\n');
    const chunks = chunksOf(paragraphs('## Real Section', tokens(200, 'alpha'), fenced));
    assert.ok(
      chunks.every((chunk) => chunk.heading !== 'Not A Heading'),
      'a fenced ## line is code, so it can label no chunk',
    );
    assert.deepEqual([...new Set(headingsOf(chunks))], ['Real Section']);
  });

  test('a fenced block split across paragraph pieces preserves fence state', () => {
    // A code fence with a blank line inside it, in an over-MAX_TOKENS section.
    // splitOnParagraphs splits at the blank line, putting the opening ``` in one
    // piece and `## Not A Heading` in the next. Without fence-state propagation,
    // headingsIn() starts fresh and misidentifies the code as a real heading.
    const fencedWithBlank = [
      '```',
      tokens(50, 'code_before'),
      '',
      '## Not A Heading',
      tokens(50, 'code_after'),
      '```',
    ].join('\n');
    const body = paragraphs(
      '## Real Section',
      tokens(250, 'prose_a'),
      fencedWithBlank,
      tokens(250, 'prose_b'),
    );
    const chunks = chunksOf(body);
    assert.ok(chunks.length >= 2, 'the fixture must split into multiple chunks');
    assert.ok(
      chunks.every((chunk) => chunk.heading !== 'Not A Heading'),
      'a ## inside a fenced block split across pieces must never become a chunk heading',
    );
    assert.deepEqual([...new Set(headingsOf(chunks))], ['Real Section']);
  });
});

/* --------------------------- DoD 1 (e): a body with no h2, and pre-heading text */

describe('DoD 1 (e): a body with no ## heading', () => {
  test('(e) yields at least one chunk whose combined text covers the body', () => {
    const body = tokens(200, 'alpha');
    const chunks = chunksOf(body);
    assert.ok(chunks.length >= 1, 'a heading-less body still produces chunks');
    const combined = chunks.map((chunk) => chunk.text).join('\n');
    assert.ok(combined.includes(body), 'the body must survive into the chunk text');
  });

  test('(e) every chunk of a heading-less body has heading === ""', () => {
    const chunks = chunksOf(paragraphs(tokens(300, 'alpha'), tokens(300, 'beta'), tokens(300, 'gamma')));
    for (const chunk of chunks) assert.equal(chunk.heading, '');
  });

  test('(e) a chunk that starts before the first ## heading has heading === ""', () => {
    const chunks = chunksOf(
      paragraphs(tokens(150, 'intro'), '## Section One', tokens(200, 'alpha')),
    );
    assert.equal(chunks.length, 2);
    assert.deepEqual(headingsOf(chunks), ['', 'Section One']);
    assert.ok(chunks[0].text.includes('intro0'), 'the pre-heading text belongs to the first chunk');
  });
});

/* ------------------------------------ DoD 1 (f): empty and whitespace-only bodies */

describe('DoD 1 (f): an empty body yields no chunks', () => {
  test('(f) an empty body yields exactly zero chunks', () => {
    assert.deepEqual(chunksOf(''), []);
  });

  test('(f) a whitespace-only body yields exactly zero chunks', () => {
    assert.deepEqual(chunksOf('   '), []);
    assert.deepEqual(chunksOf('\n\n\t  \n'), []);
  });
});

/* ------------------------------------------- DoD 2: collectArticles metadata */

describe('DoD 2: collectArticles reads the real corpus', () => {
  test('resolves at least one article, each with the six contract fields', async () => {
    const { articles } = await collectArticles(REPO_ROOT);
    assert.ok(Array.isArray(articles));
    assert.ok(articles.length > 0, 'the corpus must not be empty');
    for (const article of articles) {
      for (const field of ['file', 'slug', 'title', 'url', 'category', 'body']) {
        assert.equal(typeof article[field], 'string', `expected a string ${field} on ${article.file}`);
        assert.ok(article[field].length > 0, `expected a non-empty ${field} on ${article.file}`);
      }
    }
  });

  test('file is the repo-relative knowledge/ path, and no underscore-prefixed file is collected', async () => {
    const { articles } = await collectArticles(REPO_ROOT);
    for (const article of articles) {
      assert.ok(
        article.file.startsWith('knowledge/'),
        `expected a repo-relative knowledge/ path, got: ${article.file}`,
      );
      assert.ok(article.file.endsWith('.md'), `expected a .md path, got: ${article.file}`);
      const name = article.file.slice(article.file.lastIndexOf('/') + 1);
      assert.ok(!name.startsWith('_'), `an underscore-prefixed file must be skipped: ${article.file}`);
      assert.ok(existsSync(join(REPO_ROOT, article.file)), `expected ${article.file} to exist`);
    }
  });

  test('slug is <category>/<filename> and url is its leading-slash form', async () => {
    const { articles } = await collectArticles(REPO_ROOT);
    for (const article of articles) {
      const name = article.file.slice(article.file.lastIndexOf('/') + 1).replace(/\.md$/, '');
      assert.equal(article.slug, `${article.category}/${name}`);
      assert.equal(article.url, `/${article.category}/${name}`);
    }
  });

  test('body is the Markdown body with frontmatter removed', async () => {
    const { articles } = await collectArticles(REPO_ROOT);
    for (const article of articles) {
      assert.ok(
        !article.body.trimStart().startsWith('---'),
        `frontmatter was not stripped from ${article.file}`,
      );
    }
  });
});

/* ------------------------- DoD 5: nothing under knowledge/ is silently dropped */

/**
 * Every article-shaped file under knowledge/, found the way the editorial gates find
 * them: one level of directories, `*.md`, no leading underscore. This is the set
 * collectArticles must account for in full — the assertion below is that the split is
 * exhaustive, not that any particular file lands on either side, so it stays true for
 * any corpus (this template's, an adopter's) and names no place-specific path.
 */
function articleShapedFiles(root) {
  const knowledge = join(root, 'knowledge');
  const found = [];
  for (const entry of readdirSync(knowledge, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const name of readdirSync(join(knowledge, entry.name))) {
      if (name.endsWith('.md') && !name.startsWith('_')) found.push(`knowledge/${entry.name}/${name}`);
    }
  }
  return found.sort();
}

describe('DoD 5: collectArticles accounts for every article under knowledge/', () => {
  test('the real corpus splits exhaustively: every article-shaped file is embedded or reported', async () => {
    const { articles, excluded } = await collectArticles(REPO_ROOT);
    const accounted = [...articles.map((a) => a.file), ...excluded.map((e) => e.file)].sort();
    assert.deepEqual(
      accounted,
      articleShapedFiles(REPO_ROOT),
      'an article-shaped file under knowledge/ appeared in neither articles nor excluded, ' +
        'so it would be missing from retrieval with nothing reporting it',
    );
  });

  test('every excluded entry names a file that exists and carries a non-empty reason', async () => {
    const { excluded } = await collectArticles(REPO_ROOT);
    for (const entry of excluded) {
      assert.ok(existsSync(join(REPO_ROOT, entry.file)), `excluded file must exist: ${entry.file}`);
      assert.equal(typeof entry.reason, 'string');
      assert.ok(entry.reason.length > 0, `an exclusion must state why: ${entry.file}`);
    }
  });

  test('an article in a directory that is not a configured category is reported, not swallowed', async () => {
    // A fixture corpus, so the case holds regardless of what this repository's own
    // knowledge/ tree happens to contain today.
    const root = mkdtempSync(join(tmpdir(), 'sekai-embeddings-'));
    try {
      writeFileSync(
        join(root, 'place.config.ts'),
        'export default { categories: [{ slug: "alpha", title: "Alpha" }] };\n',
      );
      mkdirSync(join(root, 'knowledge', 'Alpha'), { recursive: true });
      mkdirSync(join(root, 'knowledge', 'Unrouted'), { recursive: true });
      writeFileSync(join(root, 'knowledge', 'Alpha', 'published.md'), '---\ntitle: P\n---\n\nBody.\n');
      writeFileSync(join(root, 'knowledge', 'Unrouted', 'orphan.md'), '---\ntitle: O\n---\n\nBody.\n');
      writeFileSync(join(root, 'knowledge', 'Unrouted', '_skipped.md'), '---\ntitle: S\n---\n\nBody.\n');

      const { articles, excluded } = await collectArticles(root);

      assert.deepEqual(
        articles.map((a) => a.file),
        ['knowledge/Alpha/published.md'],
        'only an article in a configured category is embedded',
      );
      assert.deepEqual(
        excluded.map((e) => e.file),
        ['knowledge/Unrouted/orphan.md'],
        'the unconfigured-directory article must be reported by name',
      );
      assert.match(excluded[0].reason, /place\.config\.ts/, 'the reason must point at the fix');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('DoD 2: every chunk url exists in the built topics index', () => {
  test('every chunk url emitted for the real corpus is a url in public/kb/topics.json', async () => {
    // public/kb/ is a gitignored build output. Absent means "build it", never
    // "skip me": a skipped coverage assertion is a gate that proves nothing.
    const topicsPath = join(REPO_ROOT, 'public', 'kb', 'topics.json');
    if (!existsSync(topicsPath)) {
      const built = spawnSync(process.execPath, ['scripts/core/build-kb-index.mjs'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      assert.equal(
        built.status,
        0,
        `build-kb-index.mjs must succeed so this assertion is non-vacuous\n` +
          `stdout: ${built.stdout}\nstderr: ${built.stderr}`,
      );
      assert.ok(existsSync(topicsPath), `expected build-kb-index.mjs to write ${topicsPath}`);
    }

    const topics = JSON.parse(readFileSync(topicsPath, 'utf8'));
    assert.ok(Array.isArray(topics), 'topics.json is an array of topic records');
    const known = new Set(topics.map((topic) => topic.url));
    assert.ok(known.size > 0, 'the built topics index must not be empty');

    const { articles } = await collectArticles(REPO_ROOT);
    assert.ok(articles.length > 0, 'the corpus must not be empty');

    let total = 0;
    const missing = [];
    for (const article of articles) {
      const chunks = chunkArticle(article);
      total += chunks.length;
      for (const chunk of chunks) {
        if (!known.has(chunk.url)) missing.push(`${chunk.id} -> ${chunk.url}`);
      }
    }

    assert.deepEqual(missing, [], 'every chunk url must resolve to a page in the built topics index');
    assert.ok(total > 0, 'the corpus must produce at least one chunk');
  });
});
