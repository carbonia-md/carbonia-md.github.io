// The evaluation set's reader, its verdicts, and the runner's exit codes.
//
// Two properties matter most and both are here: an ABSENT manifest is a supported
// state that exits 0, and a manifest that is present but broken is a loud failure
// rather than a quiet zero-question success. The difference between those is what
// stops a typo from turning the Phase 7 feature proof into a vacuous pass.
//
// Every fixture is synthetic. tests/ is framework code that ships to every adopter,
// so nothing here may assume the demo corpus or any place name; the real manifest is
// never read, and question counts are never asserted against it.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

import {
  EVAL_MANIFEST_PATH,
  answerDelta,
  judge,
  knownRoutes,
  readEvalSet,
} from '../scripts/lib/chat-eval.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(REPO, 'scripts/tools/chat-eval.mjs');

const temps = [];
function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'chat-eval-'));
  temps.push(dir);
  return dir;
}
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** Writes a manifest with the given frontmatter body into a fresh root. */
function withManifest(frontmatter) {
  const root = tempRoot();
  mkdirSync(join(root, 'knowledge/chat'), { recursive: true });
  writeFileSync(join(root, EVAL_MANIFEST_PATH), `---\n${frontmatter}\n---\n\nNotes.\n`, 'utf8');
  return root;
}

const GOOD_MANIFEST = `
questions:
  - question: What does the alpha guide cover?
    expectSlugs: [guides/alpha]
    expect: sources
  - question: What does a guide that does not exist cover?
    expectSlugs: []
    expect: no-citations
  - question: What are the opening hours?
    expectSlugs: []
    expect: refusal-in-answer
`.trim();

/* -- reader ----------------------------------------------------------------- */

test('an absent manifest is a supported state, not an error', () => {
  const result = readEvalSet(tempRoot());
  assert.equal(result.present, false);
  assert.deepEqual(result.questions, []);
  assert.deepEqual(result.warnings, []);
});

test('a well-formed manifest parses every question with its verdict kind', () => {
  const result = readEvalSet(withManifest(GOOD_MANIFEST));
  assert.equal(result.present, true);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.questions.length, 3);
  assert.deepEqual(
    result.questions.map((q) => q.expect),
    ['sources', 'no-citations', 'refusal-in-answer'],
  );
  assert.deepEqual(result.questions[0], {
    index: 1,
    question: 'What does the alpha guide cover?',
    expectSlugs: ['guides/alpha'],
    expect: 'sources',
    note: null,
  });
  assert.equal(result.notes, 'Notes.');
});

test('an optional note is carried through', () => {
  const result = readEvalSet(
    withManifest(
      'questions:\n  - question: Q\n    expectSlugs: [guides/alpha]\n    expect: sources\n    note: why this one',
    ),
  );
  assert.equal(result.questions[0].note, 'why this one');
});

test('a present but empty or non-list questions key warns rather than reading nothing silently', () => {
  for (const body of ['title: no questions here', 'questions: not-a-list']) {
    const result = readEvalSet(withManifest(body));
    assert.equal(result.present, true, 'the file exists, so it is present');
    assert.deepEqual(result.questions, []);
    assert.equal(result.warnings.length, 1, `expected one warning for: ${body}`);
  }
});

test('each malformed question is skipped alone, with a warning naming it', () => {
  const cases = [
    ['not a mapping', '  - just a string'],
    ['no question text', '  - expectSlugs: []\n    expect: no-citations'],
    ['blank question text', '  - question: "   "\n    expectSlugs: []\n    expect: no-citations'],
    ['expectSlugs missing', '  - question: Q\n    expect: sources'],
    ['expectSlugs not a list', '  - question: Q\n    expectSlugs: guides/alpha\n    expect: sources'],
    ['unknown expect', '  - question: Q\n    expectSlugs: [guides/alpha]\n    expect: maybe'],
    ['expect missing', '  - question: Q\n    expectSlugs: [guides/alpha]'],
    // A refusal that names expected articles contradicts itself.
    ['refusal naming slugs', '  - question: Q\n    expectSlugs: [guides/alpha]\n    expect: no-citations'],
    // And an answerable question naming none has no expectation to review against.
    ['sources naming none', '  - question: Q\n    expectSlugs: []\n    expect: sources'],
  ];

  for (const [label, entry] of cases) {
    const result = readEvalSet(withManifest(`questions:\n${entry}`));
    assert.deepEqual(result.questions, [], `${label} must be skipped`);
    assert.equal(result.warnings.length >= 1, true, `${label} must warn`);
  }
});

test('a surviving question keeps its place when a sibling is skipped', () => {
  const result = readEvalSet(
    withManifest(
      'questions:\n  - just a string\n  - question: Good\n    expectSlugs: [guides/alpha]\n    expect: sources',
    ),
  );
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].index, 1, 'indexes number the surviving questions');
  assert.equal(result.warnings.length, 1);
});

test('unparseable frontmatter warns and yields no questions', () => {
  const root = tempRoot();
  mkdirSync(join(root, 'knowledge/chat'), { recursive: true });
  writeFileSync(join(root, EVAL_MANIFEST_PATH), '---\nquestions: [\n---\n', 'utf8');
  const result = readEvalSet(root);
  assert.equal(result.present, true);
  assert.deepEqual(result.questions, []);
  assert.equal(result.warnings.length, 1);
});

/* -- routes ----------------------------------------------------------------- */

test('knownRoutes indexes published article URLs and tolerates junk', () => {
  const routes = knownRoutes([
    { url: '/guides/alpha' },
    { url: '/guides/bravo/' },
    { url: '' },
    {},
    null,
  ]);
  assert.equal(routes.has('/guides/alpha'), true);
  assert.equal(routes.has('/guides/bravo'), true, 'a trailing slash is the same route');
  assert.equal(routes.size, 2);
  assert.equal(knownRoutes(null).size, 0);
});

/* -- frame shapes ----------------------------------------------------------- */

// Both shapes are real: `{response}` is the documented Workers AI streaming form, and
// the OpenAI-compatible form is what the current generation model actually emits.
// Reading only the first is what made a deployed run report ten empty answers while
// every citation resolved, so both are pinned here.
test('answerDelta reads the documented and the OpenAI-compatible frame shapes', () => {
  assert.equal(answerDelta({ response: 'plain' }), 'plain');
  assert.equal(answerDelta({ choices: [{ delta: { content: 'chunked' } }] }), 'chunked');
  assert.equal(answerDelta({ choices: [{ delta: { content: '' } }] }), '');
});

test('answerDelta never reads a reasoning stream as answer text', () => {
  // A reasoning model streams its private chain of thought an order of magnitude
  // longer than the answer. Rendering it would present unreviewed speculation as the
  // cited answer.
  assert.equal(answerDelta({ choices: [{ delta: { reasoning: 'thinking out loud' } }] }), '');
  assert.equal(
    answerDelta({ choices: [{ delta: { reasoning_content: 'thinking out loud' } }] }),
    '',
  );
  assert.equal(
    answerDelta({ choices: [{ delta: { content: 'said', reasoning: 'thought' } }] }),
    'said',
    'only the content half of a mixed frame is the answer',
  );
});

test('answerDelta tolerates frames it does not model', () => {
  for (const frame of [null, undefined, 'string', 42, {}, { choices: [] }, { choices: [{}] }]) {
    assert.equal(answerDelta(frame), '');
  }
});

/* -- verdicts --------------------------------------------------------------- */

const ROUTES = knownRoutes([{ url: '/guides/alpha' }, { url: '/guides/bravo' }]);
const sourcesQ = { expect: 'sources', expectSlugs: ['guides/alpha'] };
const machineRefusalQ = { expect: 'no-citations', expectSlugs: [] };
const humanRefusalQ = { expect: 'refusal-in-answer', expectSlugs: [] };

test('a resolvable citation passes', () => {
  const result = { answer: 'a', citations: [{ title: 'Alpha', url: '/guides/alpha' }] };
  assert.deepEqual(judge(sourcesQ, result, ROUTES), []);
});

test('a citation absent from the published index fails', () => {
  const result = { answer: 'a', citations: [{ title: 'Ghost', url: '/guides/ghost' }] };
  const failures = judge(sourcesQ, result, ROUTES);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /\/guides\/ghost/);
});

test('a citation with no URL fails rather than being skipped', () => {
  const failures = judge(sourcesQ, { answer: 'a', citations: [{ title: 'Alpha' }] }, ROUTES);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /no URL/i);
});

test('a no-citations question fails when anything is cited, and passes when nothing is', () => {
  const cited = { answer: 'I do not know.', citations: [{ title: 'Alpha', url: '/guides/alpha' }] };
  const failures = judge(machineRefusalQ, cited, ROUTES);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /must refuse with no citations/);

  assert.deepEqual(judge(machineRefusalQ, { answer: 'I do not know.', citations: [] }, ROUTES), []);
});

// The distinction the measurement forced: retrieval cannot tell a plausible-but-absent
// subject from an answerable one, so near-neighbours here are expected, not a defect.
test('a refusal-in-answer question is exempt from the citation verdict', () => {
  const cited = {
    answer: 'The knowledge base does not cover that.',
    citations: [{ title: 'Alpha', url: '/guides/alpha' }],
  };
  assert.deepEqual(judge(humanRefusalQ, cited, ROUTES), []);
});

test('a refusal-in-answer question still fails on an unresolvable citation', () => {
  const cited = { answer: 'No.', citations: [{ title: 'Ghost', url: '/guides/ghost' }] };
  assert.equal(judge(humanRefusalQ, cited, ROUTES).length, 1);
});

test('a request error fails and short-circuits the citation checks', () => {
  const failures = judge(sourcesQ, { error: 'HTTP 503' }, ROUTES);
  assert.deepEqual(failures, ['request failed: HTTP 503']);
});

/* -- the runner ------------------------------------------------------------- */

/**
 * Async on purpose. The stub worker below listens in THIS process, so a synchronous
 * spawn would block the event loop that has to answer the child's requests, and the
 * run would deadlock rather than fail.
 */
function runCli(root, args = []) {
  return new Promise((done) => {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', CLI, '--root', root, ...args],
      { cwd: REPO },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => done({ status, stdout, stderr }));
  });
}

test('an absent manifest exits 0 and says so', async () => {
  const result = await runCli(tempRoot());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no evaluation set/);
});

test('a present but unusable manifest exits nonzero rather than passing vacuously', async () => {
  const result = await runCli(withManifest('questions: []'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /present and unreadable|no usable question/);
});

/**
 * A stub worker: one SSE response per question, keyed by the order asked. Serves
 * topics.json too, so the runner exercises its real remote-index path.
 */
function stubWorker(responses) {
  let asked = 0;
  const server = createServer((req, res) => {
    if (req.url.startsWith('/kb/topics.json')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{ url: '/guides/alpha' }, { url: '/guides/bravo' }]));
      return;
    }
    const body = responses[Math.min(asked, responses.length - 1)];
    asked += 1;
    if (typeof body === 'number') {
      res.writeHead(body, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'stub' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(body);
  });
  return server;
}

const sse = (answer, citations) =>
  `data: ${JSON.stringify({ response: answer })}\n\n` +
  `event: citations\ndata: ${JSON.stringify({ citations })}\n\n`;

/** The shape the deployed generation model actually streams, reasoning included. */
const openAiSse = (answer, citations) =>
  `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'private thinking' } }] })}\n\n` +
  `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n` +
  `event: citations\ndata: ${JSON.stringify({ citations })}\n\n`;

async function withStub(responses, run) {
  const server = stubWorker(responses);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((done) => server.close(done));
  }
}

test('a clean run exits 0 and writes the report', async () => {
  const root = withManifest(GOOD_MANIFEST);
  await withStub(
    [
      sse('Alpha covers alpha.', [{ title: 'Alpha', url: '/guides/alpha' }]),
      sse('The knowledge base does not cover that.', []),
      sse('The knowledge base does not cover that.', [{ title: 'Alpha', url: '/guides/alpha' }]),
    ],
    async (base) => {
      const result = await runCli(root, ['--endpoint', base, '--origin', base, '--topics', `${base}/kb/topics.json`]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /3 question\(s\) parsed/);
      assert.match(result.stdout, /3\/3 question\(s\) passed/);

      const report = readFileSync(join(root, 'reports/chat-eval.md'), 'utf8');
      assert.match(report, /# Chat evaluation report/);
      assert.match(report, /Alpha covers alpha\./, 'the report must carry each answer');
      assert.match(report, /\[Alpha\]\(\/guides\/alpha\)/, 'the report must carry each citation set');
      assert.match(report, /\(nothing cited\)/, 'an empty citation set must be visible as such');
    },
  );
});

test('the report carries the answer when the model streams OpenAI-compatible frames', async () => {
  const root = withManifest(GOOD_MANIFEST);
  await withStub(
    [
      openAiSse('Alpha covers alpha.', [{ title: 'Alpha', url: '/guides/alpha' }]),
      openAiSse('The knowledge base does not cover that.', []),
      openAiSse('The knowledge base does not cover that.', []),
    ],
    async (base) => {
      const result = await runCli(root, [
        '--endpoint',
        base,
        '--origin',
        base,
        '--topics',
        `${base}/kb/topics.json`,
      ]);
      assert.equal(result.status, 0, result.stderr);
      const report = readFileSync(join(root, 'reports/chat-eval.md'), 'utf8');
      assert.match(report, /Alpha covers alpha\./, 'the answer must reach the report');
      assert.equal(
        report.includes('private thinking'),
        false,
        'the reasoning stream must never reach the human review',
      );
      assert.equal(
        report.includes('(empty answer)'),
        false,
        'no question may report an empty answer when content frames arrived',
      );
    },
  );
});

test('a citation that resolves to no article fails the run', async () => {
  const root = withManifest(GOOD_MANIFEST);
  await withStub(
    [
      sse('Invented.', [{ title: 'Ghost', url: '/guides/ghost' }]),
      sse('No.', []),
      sse('No.', []),
    ],
    async (base) => {
      const result = await runCli(root, ['--endpoint', base, '--origin', base, '--topics', `${base}/kb/topics.json`]);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout, /not an article this site publishes/);
    },
  );
});

test('a no-citations question that cites anything fails the run', async () => {
  const root = withManifest(GOOD_MANIFEST);
  await withStub(
    [
      sse('Alpha covers alpha.', [{ title: 'Alpha', url: '/guides/alpha' }]),
      sse('I am not sure.', [{ title: 'Alpha', url: '/guides/alpha' }]),
      sse('No.', []),
    ],
    async (base) => {
      const result = await runCli(root, ['--endpoint', base, '--origin', base, '--topics', `${base}/kb/topics.json`]);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout, /must refuse with no citations/);
    },
  );
});

test('a worker error fails the run', async () => {
  const root = withManifest(GOOD_MANIFEST);
  await withStub([503], async (base) => {
    const result = await runCli(root, ['--endpoint', base, '--origin', base, '--topics', `${base}/kb/topics.json`]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /request failed: HTTP 503/);
  });
});

// A response with no citations frame is a broken contract. Treating it as "cited
// nothing" would silently pass every refusal question against a worker that has
// stopped emitting the payload at all.
test('a response carrying no citations frame fails the run', async () => {
  const root = withManifest(GOOD_MANIFEST);
  await withStub([`data: ${JSON.stringify({ response: 'bare' })}\n\n`], async (base) => {
    const result = await runCli(root, ['--endpoint', base, '--origin', base, '--topics', `${base}/kb/topics.json`]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /no citations frame/);
  });
});

test('a missing endpoint is an actionable failure, not a skip', async () => {
  const result = await runCli(withManifest(GOOD_MANIFEST), ['--origin', 'https://example.invalid']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no chat endpoint/);
});
