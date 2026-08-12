// snippet-queue.test.mjs -- `npm run test:snippet`.
//
// The queue file is a format contract: /sekai-snippet writes it, a human edits it,
// and scripts/tools/snippet/publish.mjs writes back into it. These suites pin the
// three things that make the human gate real -- only `approved` publishes, an
// over-length draft is refused rather than truncated, and a malformed file stops
// the run instead of being silently repaired.
//
// This file lives under tests/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  QueueError,
  STATUSES,
  applyPublished,
  charCount,
  isHttpUrl,
  parseQueue,
  publishApproved,
} from '../scripts/tools/snippet/queue.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Build one entry block; `text` drives `chars` so fixtures cannot drift. */
function entry({ id, slug = 'Category/article-slug', created = '2026-01-31', status, url = '', text }) {
  return [
    `## ${id}`,
    '',
    `- slug: ${slug}`,
    `- created: ${created}`,
    `- chars: ${charCount(text)}`,
    `- status: ${status}`,
    `- url:${url ? ` ${url}` : ''}`,
    '',
    '```text',
    text,
    '```',
    '',
  ].join('\n');
}

const HEADER = [
  '# Snippet Queue',
  '',
  'A worked example lives in the header, wrapped in a longer fence.',
  '',
  '````markdown',
  '## snippet-2026-01-31-example',
  '',
  '- slug: Category/article-slug',
  '- created: 2026-01-31',
  '- chars: 11',
  '- status: approved',
  '- url:',
  '',
  '```text',
  'not an entry',
  '```',
  '````',
  '',
  '## Entries',
  '',
].join('\n');

const queue = (...blocks) => HEADER + blocks.join('\n');

/**
 * Edit one entry block, then queue it. Never edit the assembled queue string:
 * the header carries a worked example with the same field lines, so a plain
 * `replace` there would mutate the example instead of the entry under test.
 */
const damaged = (block, from, to = '') => queue(block.replace(from, to));

/** An adapter that records what it was handed and never touches a network. */
function recordingAdapter(options = {}) {
  const { id = 'test', maxChars = 280, fail = null } = options;
  // Not a default parameter: `{ url: undefined }` is a case under test (an
  // adapter that resolves without a URL), and a default would silently fill it.
  const url = 'url' in options ? options.url : 'https://example.invalid/post/1';
  const seen = [];
  return {
    seen,
    id,
    maxChars,
    async publish(draft) {
      seen.push(draft);
      if (fail) throw new Error(fail);
      return { url: typeof url === 'function' ? url(draft) : url };
    },
  };
}

describe('charCount', () => {
  test('counts Unicode code points, not UTF-16 units or bytes', () => {
    assert.equal(charCount('abc'), 3);
    // An astral-plane character is one code point but two UTF-16 units; counting
    // units would let a draft that fits a platform limit be refused.
    assert.equal(charCount('a\u{1F300}b'), 3);
    assert.equal(charCount('café'), 4);
  });
});

describe('isHttpUrl', () => {
  test('accepts http and https only', () => {
    assert.equal(isHttpUrl('https://example.invalid/a'), true);
    assert.equal(isHttpUrl('http://example.invalid/a'), true);
    assert.equal(isHttpUrl('ftp://example.invalid/a'), false);
    assert.equal(isHttpUrl('file:///etc/passwd'), false);
    assert.equal(isHttpUrl('javascript:alert(1)'), false);
    assert.equal(isHttpUrl('example.invalid'), false);
    assert.equal(isHttpUrl(''), false);
  });
});

describe('parseQueue', () => {
  test('reads every field of a well-formed entry', () => {
    const { entries } = parseQueue(
      queue(entry({ id: 'snippet-2026-01-31-tide-pools', status: 'pending', text: 'A specific true thing.' })),
    );
    assert.equal(entries.length, 1);
    assert.deepEqual(
      { ...entries[0], fieldLines: undefined },
      {
        id: 'snippet-2026-01-31-tide-pools',
        slug: 'Category/article-slug',
        created: '2026-01-31',
        chars: 22,
        status: 'pending',
        url: '',
        text: 'A specific true thing.',
        fieldLines: undefined,
      },
    );
  });

  test('ignores the header example, fences and heading alike', () => {
    // The example block declares `status: approved`. If the parser read it, the
    // publish path would have an entry no human ever wrote.
    const { entries } = parseQueue(HEADER);
    assert.deepEqual(entries, []);
  });

  test('accepts a queue with no entries at all', () => {
    assert.deepEqual(parseQueue(queue()).entries, []);
  });

  test('reads multi-line post text verbatim', () => {
    const text = 'First line.\n\nThird line, after a blank one.';
    const { entries } = parseQueue(queue(entry({ id: 'snippet-a', status: 'pending', text })));
    assert.equal(entries[0].text, text);
  });

  test('every documented status parses', () => {
    const blocks = STATUSES.map((status, i) =>
      entry({
        id: `snippet-s${i}`,
        status,
        url: status === 'posted' ? 'https://example.invalid/p' : '',
        text: `status ${status}`,
      }),
    );
    assert.deepEqual(
      parseQueue(queue(...blocks)).entries.map((e) => e.status),
      STATUSES,
    );
  });

  const malformed = [
    {
      what: 'a duplicate entry id',
      source: () =>
        queue(
          entry({ id: 'snippet-dup', status: 'pending', text: 'one' }),
          entry({ id: 'snippet-dup', status: 'pending', text: 'two' }),
        ),
      expect: /duplicate entry id/,
    },
    {
      what: 'a status outside the documented set',
      source: () => queue(entry({ id: 'snippet-a', status: 'queued', text: 'one' })),
      expect: /status "queued" is not one of/,
    },
    {
      what: 'a chars field that disagrees with the text',
      source: () =>
        damaged(entry({ id: 'snippet-a', status: 'approved', text: 'twelve chars' }), '- chars: 12', '- chars: 99'),
      expect: /chars says 99 but the post text is 12/,
    },
    {
      what: 'a non-integer chars field',
      source: () => damaged(entry({ id: 'snippet-a', status: 'pending', text: 'one' }), '- chars: 3', '- chars: many'),
      expect: /chars "many" is not an integer/,
    },
    {
      what: 'a missing url field',
      source: () => damaged(entry({ id: 'snippet-a', status: 'pending', text: 'one' }), '- url:\n'),
      expect: /missing "- url:" field/,
    },
    {
      what: 'a missing slug field',
      source: () => damaged(entry({ id: 'snippet-a', status: 'pending', text: 'one' }), '- slug: Category/article-slug\n'),
      expect: /missing "- slug:" field/,
    },
    {
      what: 'a posted entry with no url',
      source: () => queue(entry({ id: 'snippet-a', status: 'posted', text: 'one' })),
      expect: /status is posted but url is empty/,
    },
    {
      what: 'a url that is not http(s)',
      source: () => queue(entry({ id: 'snippet-a', status: 'posted', url: 'ftp://example.invalid/p', text: 'one' })),
      expect: /is not an http\(s\) URL/,
    },
    {
      what: 'a created date that is not YYYY-MM-DD',
      source: () => queue(entry({ id: 'snippet-a', created: '31 Jan 2026', status: 'pending', text: 'one' })),
      expect: /created "31 Jan 2026" is not YYYY-MM-DD/,
    },
    {
      what: 'an entry with no fenced post text',
      source: () => `${HEADER}## snippet-a\n\n- slug: C/a\n- created: 2026-01-31\n- chars: 3\n- status: pending\n- url:\n`,
      expect: /no fenced post-text block/,
    },
    {
      what: 'a duplicate field within one entry',
      source: () =>
        damaged(
          entry({ id: 'snippet-a', status: 'pending', text: 'one' }),
          '- status: pending',
          '- status: pending\n- status: approved',
        ),
      expect: /duplicate field "status"/,
    },
  ];

  for (const testCase of malformed) {
    test(`rejects ${testCase.what}`, () => {
      assert.throws(() => parseQueue(testCase.source()), (err) => {
        assert.ok(err instanceof QueueError, `expected a QueueError, got ${err?.name}`);
        assert.match(err.message, testCase.expect);
        return true;
      });
    });
  }

  test('reports every problem in one throw, not one per rerun', () => {
    const source = queue(
      entry({ id: 'snippet-a', status: 'nope', text: 'one' }),
      entry({ id: 'snippet-b', created: 'yesterday', status: 'pending', text: 'two' }),
    );
    try {
      parseQueue(source);
      assert.fail('expected a QueueError');
    } catch (err) {
      assert.ok(err instanceof QueueError);
      assert.equal(err.problems.length, 2);
    }
  });
});

describe('publishApproved', () => {
  test('publishes approved entries and leaves every other status alone', async () => {
    const source = queue(
      entry({ id: 'snippet-pend', status: 'pending', text: 'pending draft' }),
      entry({ id: 'snippet-appr', status: 'approved', text: 'approved draft' }),
      entry({ id: 'snippet-rej', status: 'rejected', text: 'rejected draft' }),
      entry({ id: 'snippet-post', status: 'posted', url: 'https://example.invalid/old', text: 'posted draft' }),
    );
    const adapter = recordingAdapter({ url: 'https://example.invalid/new' });
    const result = await publishApproved(source, adapter);

    assert.deepEqual(adapter.seen.map((d) => d.id), ['snippet-appr']);
    assert.deepEqual(result.published, [
      { id: 'snippet-appr', url: 'https://example.invalid/new', text: 'approved draft' },
    ]);
    assert.deepEqual(result.refused, []);
    assert.deepEqual(
      result.skipped.map((s) => `${s.id}:${s.status}`),
      ['snippet-pend:pending', 'snippet-rej:rejected', 'snippet-post:posted'],
    );

    const after = parseQueue(result.text).entries;
    assert.deepEqual(
      after.map((e) => `${e.id}:${e.status}:${e.url}`),
      [
        'snippet-pend:pending:',
        'snippet-appr:posted:https://example.invalid/new',
        'snippet-rej:rejected:',
        'snippet-post:posted:https://example.invalid/old',
      ],
    );
  });

  test('hands the adapter the entry verbatim', async () => {
    const text = 'A specific true thing, dated 2019.';
    const source = queue(entry({ id: 'snippet-a', slug: 'History/founding', status: 'approved', text }));
    const adapter = recordingAdapter();
    await publishApproved(source, adapter);
    assert.deepEqual(adapter.seen[0], {
      id: 'snippet-a',
      slug: 'History/founding',
      created: '2026-01-31',
      chars: charCount(text),
      text,
    });
  });

  test('changes only the status and url lines of what it published', async () => {
    const source = queue(
      entry({ id: 'snippet-a', status: 'approved', text: 'approved draft' }),
      entry({ id: 'snippet-b', status: 'pending', text: 'pending draft' }),
    );
    const { text } = await publishApproved(source, recordingAdapter({ url: 'https://example.invalid/x' }));

    const before = source.split('\n');
    const after = text.split('\n');
    assert.equal(before.length, after.length);
    const changed = before.map((line, i) => [i, line, after[i]]).filter(([, b, a]) => b !== a);
    assert.deepEqual(
      changed.map(([, b, a]) => [b, a]),
      [
        ['- status: approved', '- status: posted'],
        ['- url:', '- url: https://example.invalid/x'],
      ],
    );
  });

  describe('an entry longer than the adapter accepts', () => {
    const long = 'x'.repeat(300);
    const source = () => queue(entry({ id: 'snippet-long', status: 'approved', text: long }));

    test('is refused with the entry id and the exact overage', async () => {
      const result = await publishApproved(source(), recordingAdapter({ maxChars: 280 }));
      assert.equal(result.published.length, 0);
      assert.equal(result.refused.length, 1);
      assert.equal(result.refused[0].id, 'snippet-long');
      assert.match(result.refused[0].reason, /300 chars exceeds/);
      assert.match(result.refused[0].reason, /maxChars \(280\)/);
      assert.match(result.refused[0].reason, /by 20\b/);
    });

    test('never reaches the adapter', async () => {
      const adapter = recordingAdapter({ maxChars: 280 });
      await publishApproved(source(), adapter);
      assert.deepEqual(adapter.seen, []);
    });

    test('is not truncated, and stays approved for a shortened rerun', async () => {
      const result = await publishApproved(source(), recordingAdapter({ maxChars: 280 }));
      const after = parseQueue(result.text).entries[0];
      assert.equal(after.status, 'approved');
      assert.equal(after.url, '');
      assert.equal(after.text, long);
      assert.equal(result.text, source());
    });

    test('does not block the other approved entries in the same run', async () => {
      const both = queue(
        entry({ id: 'snippet-long', status: 'approved', text: long }),
        entry({ id: 'snippet-short', status: 'approved', text: 'short enough' }),
      );
      const result = await publishApproved(both, recordingAdapter({ maxChars: 280 }));
      assert.deepEqual(result.published.map((p) => p.id), ['snippet-short']);
      assert.deepEqual(result.refused.map((r) => r.id), ['snippet-long']);
    });
  });

  test('an entry exactly at maxChars is published', async () => {
    const source = queue(entry({ id: 'snippet-edge', status: 'approved', text: 'y'.repeat(280) }));
    const result = await publishApproved(source, recordingAdapter({ maxChars: 280 }));
    assert.deepEqual(result.published.map((p) => p.id), ['snippet-edge']);
  });

  test('an adapter that throws leaves the entry approved and retryable', async () => {
    const source = queue(entry({ id: 'snippet-a', status: 'approved', text: 'draft' }));
    const result = await publishApproved(source, recordingAdapter({ fail: 'no URL supplied by the operator' }));
    assert.deepEqual(result.published, []);
    assert.equal(result.refused.length, 1);
    assert.match(result.refused[0].reason, /no URL supplied by the operator/);
    assert.equal(result.text, source);
    assert.equal(parseQueue(result.text).entries[0].status, 'approved');
  });

  for (const [what, url] of [
    ['nothing', undefined],
    ['a non-string', 42],
    ['a non-http URL', 'ftp://example.invalid/p'],
    ['an unparseable URL', 'not a url'],
  ]) {
    test(`an adapter that returns ${what} does not mark the entry posted`, async () => {
      const source = queue(entry({ id: 'snippet-a', status: 'approved', text: 'draft' }));
      const result = await publishApproved(source, recordingAdapter({ url }));
      assert.deepEqual(result.published, []);
      assert.equal(result.refused.length, 1);
      assert.match(result.refused[0].reason, /returned no http\(s\) url/);
      assert.equal(result.text, source);
    });
  }

  test('a malformed file stops the run before any adapter call', async () => {
    const adapter = recordingAdapter();
    const source = damaged(entry({ id: 'snippet-a', status: 'approved', text: 'draft' }), '- chars: 5', '- chars: 4');
    await assert.rejects(() => publishApproved(source, adapter), QueueError);
    assert.deepEqual(adapter.seen, []);
  });
});

describe('applyPublished', () => {
  // What a finished run hands back: the manual sink has already posted these,
  // so the URLs exist in the world whatever the file says.
  const published = (id, url, text) => [{ id, url, text }];

  test('re-applies onto a file that gained an entry mid-run', () => {
    const before = queue(entry({ id: 'snippet-a', status: 'approved', text: 'approved draft' }));
    const after = queue(
      entry({ id: 'snippet-a', status: 'approved', text: 'approved draft' }),
      entry({ id: 'snippet-b', status: 'pending', text: 'appended while posting' }),
    );
    const merged = applyPublished(after, published('snippet-a', 'https://example.invalid/1', 'approved draft'));

    assert.deepEqual(merged.conflicts, []);
    assert.deepEqual(
      parseQueue(merged.text).entries.map((e) => `${e.id}:${e.status}:${e.url}`),
      ['snippet-a:posted:https://example.invalid/1', 'snippet-b:pending:'],
    );
    // The entry appended during the run survives verbatim; the stale snapshot
    // that `before` represents is never what gets written.
    assert.ok(merged.text.includes('appended while posting'));
    assert.notEqual(before, merged.text);
  });

  test('touches only the status and url lines of what it published', () => {
    const source = queue(
      entry({ id: 'snippet-a', status: 'approved', text: 'approved draft' }),
      entry({ id: 'snippet-b', status: 'pending', text: 'pending draft' }),
    );
    const merged = applyPublished(source, published('snippet-a', 'https://example.invalid/1', 'approved draft'));
    const changed = source
      .split('\n')
      .map((line, i) => [line, merged.text.split('\n')[i]])
      .filter(([b, a]) => b !== a);
    assert.deepEqual(changed, [
      ['- status: approved', '- status: posted'],
      ['- url:', '- url: https://example.invalid/1'],
    ]);
  });

  test('is idempotent when the result was already recorded', () => {
    const source = queue(
      entry({ id: 'snippet-a', status: 'posted', url: 'https://example.invalid/1', text: 'approved draft' }),
    );
    const merged = applyPublished(source, published('snippet-a', 'https://example.invalid/1', 'approved draft'));
    assert.deepEqual(merged.conflicts, []);
    assert.equal(merged.text, source);
  });

  const conflicting = [
    {
      what: 'the entry was deleted during the run',
      source: () => queue(entry({ id: 'snippet-other', status: 'pending', text: 'unrelated' })),
      expect: /snippet-a: posted to https:\/\/example\.invalid\/1, but the entry is no longer in the file/,
    },
    {
      what: 'the post text was edited during the run',
      source: () => queue(entry({ id: 'snippet-a', status: 'approved', text: 'edited while posting' })),
      expect: /but its post text changed during the run/,
    },
    {
      what: 'the status was flipped to rejected during the run',
      source: () => queue(entry({ id: 'snippet-a', status: 'rejected', text: 'approved draft' })),
      expect: /but its status changed to "rejected" during the run/,
    },
    {
      what: 'the entry was posted to a different url during the run',
      source: () =>
        queue(entry({ id: 'snippet-a', status: 'posted', url: 'https://example.invalid/9', text: 'approved draft' })),
      expect: /but its status changed to "posted" during the run/,
    },
  ];

  for (const testCase of conflicting) {
    test(`refuses to overwrite when ${testCase.what}`, () => {
      const source = testCase.source();
      const merged = applyPublished(source, published('snippet-a', 'https://example.invalid/1', 'approved draft'));
      assert.equal(merged.conflicts.length, 1);
      assert.match(merged.conflicts[0], testCase.expect);
      // A conflict is a refusal, so the caller has nothing safe to write: the
      // returned text still equals the concurrent edit it was handed.
      assert.equal(merged.text, source);
    });
  }

  test('applies the clean results and reports only the conflicting one', () => {
    const source = queue(
      entry({ id: 'snippet-a', status: 'rejected', text: 'first draft' }),
      entry({ id: 'snippet-b', status: 'approved', text: 'second draft' }),
    );
    const merged = applyPublished(source, [
      { id: 'snippet-a', url: 'https://example.invalid/1', text: 'first draft' },
      { id: 'snippet-b', url: 'https://example.invalid/2', text: 'second draft' },
    ]);
    assert.equal(merged.conflicts.length, 1);
    assert.match(merged.conflicts[0], /^snippet-a: /);
    assert.deepEqual(
      parseQueue(merged.text).entries.map((e) => `${e.id}:${e.status}`),
      ['snippet-a:rejected', 'snippet-b:posted'],
    );
  });

  test('a queue edited into a malformed state throws rather than being repaired', () => {
    const source = damaged(entry({ id: 'snippet-a', status: 'approved', text: 'twelve chars' }), '- chars: 12', '- chars: 99');
    assert.throws(
      () => applyPublished(source, published('snippet-a', 'https://example.invalid/1', 'twelve chars')),
      QueueError,
    );
  });
});

describe('the queue template the skill copies', () => {
  // Adoption wipes knowledge/ and reseeds INBOX.md alone, so this template --
  // under scripts/, which survives -- is the only header a fresh instance has.
  // Every assertion below is therefore about a file that always exists.
  const source = readFileSync(join(ROOT, 'scripts', 'tools', 'snippet', 'queue-template.md'), 'utf8');

  test('parses, and its documented example is not read as an entry', () => {
    assert.deepEqual(parseQueue(source).entries, []);
  });

  test('documents every status the parser accepts', () => {
    for (const status of STATUSES) assert.match(source, new RegExp(`\`${status}\``));
  });

  test('publishing against it is a no-op', async () => {
    const adapter = recordingAdapter();
    const result = await publishApproved(source, adapter);
    assert.deepEqual(result.published, []);
    assert.deepEqual(result.refused, []);
    assert.deepEqual(adapter.seen, []);
    assert.equal(result.text, source);
  });

  test('an entry appended to a fresh copy of it parses', () => {
    const fresh = source + '\n' + entry({ id: 'snippet-2026-01-31-a', status: 'pending', text: 'A specific true thing.' });
    assert.deepEqual(
      parseQueue(fresh).entries.map((e) => `${e.id}:${e.status}`),
      ['snippet-2026-01-31-a:pending'],
    );
  });

  const demo = join(ROOT, 'knowledge', 'SNIPPET-INBOX.md');

  test('the queue file in this checkout, if any, carries that exact header', {
    // An adopted instance has no queue until its first snippet, and that is the
    // supported state -- nothing here may require the file to exist.
    skip: existsSync(demo) ? false : 'no knowledge/SNIPPET-INBOX.md in this checkout',
  }, () => {
    const header = (text) => {
      const at = text.indexOf('\n## Entries\n');
      assert.notEqual(at, -1, 'expected a "## Entries" heading');
      return text.slice(0, at);
    };
    // Two copies of one header would drift, and the copy an adopter never sees
    // is the one that would rot. This pins them.
    assert.equal(header(readFileSync(demo, 'utf8')), header(source));
  });
});
