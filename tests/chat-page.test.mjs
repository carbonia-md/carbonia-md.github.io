// The /chat client: SSE consumption, citation cards, session history, and failure.
//
// The script under test is extracted from src/templates/chat.template.astro and run
// in a real browser against a real streaming HTTP server, both served from one
// origin. A server rather than request interception, because two of the properties
// here are about timing: text must render frame by frame as it arrives, and a stream
// that dies mid-answer must keep what already landed.
//
// The fixture's message strings are DERIVED from the template's own `data-msg-*`
// attributes, so a renamed or added message cannot leave this suite testing a form
// the page no longer renders.
//
// tests/ is framework code that ships to every adopter: every fixture here is
// synthetic and carries no place name.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';

import { chromium } from 'playwright';

const templateSource = readFileSync(
  new URL('../src/templates/chat.template.astro', import.meta.url),
  'utf8',
);

const scriptMatch = templateSource.match(/const CHAT_SCRIPT = `([\s\S]*?)\n`;\n---/);
assert.ok(scriptMatch, 'chat.template.astro must expose its inline client as CHAT_SCRIPT');

// CHAT_SCRIPT is a template literal, so what reaches the browser is its EVALUATED
// value, not its source: `\\n` in the file is a one-character newline escape in the
// emitted script. Reading the raw source would test a script whose SSE frame
// splitting is on the literal characters backslash-n, which is not the page that
// ships. Evaluating it here reproduces exactly what Astro emits.
assert.equal(
  scriptMatch[1].includes('${'),
  false,
  'CHAT_SCRIPT must stay interpolation-free so this suite can evaluate it standalone',
);
const chatScript = new Function(`return \`${scriptMatch[1]}\`;`)();

// Every message the template hands the client, by attribute name. The fixture sets
// each to its own name, so an assertion can say which message surfaced.
const MSG_NAMES = [...templateSource.matchAll(/data-msg-([a-z-]+)=\{t\('[^']+'\)\}/g)].map(
  (match) => match[1],
);
assert.ok(MSG_NAMES.includes('no-sources'), 'the template must pass a no-sources message');
assert.ok(MSG_NAMES.includes('rate-limited'), 'the template must pass a rate-limited message');
assert.ok(MSG_NAMES.includes('unavailable'), 'the template must pass an unavailable message');
assert.ok(MSG_NAMES.includes('error'), 'the template must pass a generic error message');
assert.ok(MSG_NAMES.includes('empty-answer'), 'the template must pass an empty-answer message');
assert.ok(MSG_NAMES.includes('empty-answer-no-sources'), 'the template must pass an empty-answer-no-sources message');

const msgAttrs = MSG_NAMES.map((name) => `data-msg-${name}="${name}"`).join('\n            ');

// `?ctx=` contexts are baked into the page as one attribute at build time (an
// attribute rather than a JSON island, so Astro's own escaping is the only escaping
// rule). Omitting it is what an instance with no `knowledge/chat/_contexts.md`
// ships, and every context test below drives the same script the no-context tests do.
const CONTEXTS = [
  {
    slug: 'north-dock',
    label: 'North Dock',
    greeting: 'You are at the north dock. Ask about the boats.',
    hint: 'the north dock and the water around it',
    article: '/guides/alpha',
  },
  {
    slug: 'ridge-gate',
    label: 'Ridge Gate',
    greeting: 'You are at the ridge gate.',
    hint: null,
    article: null,
  },
];

function fixtureHtml(endpoint, contexts) {
  const contextAttr = contexts
    ? `\n            data-contexts="${JSON.stringify(contexts).replace(/"/g, '&quot;')}"`
    : '';
  return `<!doctype html>
<html>
  <body>
    <section data-chat>
      <div class="log" data-chat-log role="log" aria-live="polite">
        <p class="log-empty" data-chat-empty>Ask a question to start.</p>
      </div>
      <form
            data-chat-form
            data-endpoint="${endpoint}"
            ${msgAttrs}${contextAttr}
      >
        <textarea data-chat-input rows="2" required maxlength="1000"></textarea>
        <button type="submit">send</button>
      </form>
      <script>${chatScript}</script>
    </section>
  </body>
</html>`;
}

const frame = (text) => `data: ${JSON.stringify({ response: text })}\n\n`;
const citationsFrame = (citations) =>
  `event: citations\ndata: ${JSON.stringify({ citations })}\n\n`;

let browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});

/**
 * Serves the fixture page and one POST endpoint from a single origin, runs `body`
 * against a fresh page, and tears everything down.
 *
 * `respond(res, requestBody)` owns the endpoint response, so a test can stream,
 * stall, or destroy the connection as it needs.
 */
async function withPage(respond, body, { contexts = null, search = '' } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fixtureHtml('/ask', contexts));
      return;
    }
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      requests.push(JSON.parse(raw));
      respond(res, requests.at(-1));
    });
  });

  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/${search}`);
    return await body(page, requests);
  } finally {
    await context.close();
    await new Promise((done) => server.close(done));
  }
}

/** Streams an SSE answer and its citation payload, then closes. */
const streamAnswer = (text, citations) => (res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  res.write(frame(text));
  res.write(citationsFrame(citations));
  res.end();
};

async function ask(page, question = 'What does alpha cover?') {
  await page.locator('[data-chat-input]').fill(question);
  await page.locator('[data-chat-form] button[type="submit"]').click();
}

const settled = (page) =>
  page.waitForFunction(() => {
    const button = document.querySelector('[data-chat-form] button[type="submit"]');
    return button && !button.disabled;
  });

/* -- transcript 1: an answer with citations --------------------------------- */

test('an answer with citations renders linked cards, one per article', async () => {
  await withPage(
    streamAnswer('Alpha covers alpha.', [
      { title: 'Alpha Guide', url: '/guides/alpha' },
      // Retrieval returns chunks, so one article can appear several times. A reader
      // wants one card per article.
      { title: 'Alpha Guide', url: '/guides/alpha' },
      { title: 'Bravo Guide', url: '/guides/bravo' },
    ]),
    async (page) => {
      await ask(page);
      await settled(page);

      assert.equal(
        await page.locator('[data-turn="assistant"] [data-turn-body]').textContent(),
        'Alpha covers alpha.',
      );

      const cards = page.locator('[data-chat-sources] .source-card');
      assert.equal(await cards.count(), 2, 'duplicate URLs collapse into one card');
      assert.deepEqual(await cards.allTextContents(), ['Alpha Guide', 'Bravo Guide']);
      assert.deepEqual(
        await page.locator('[data-chat-sources] a.source-card').evaluateAll((links) =>
          links.map((link) => link.getAttribute('href')),
        ),
        ['/guides/alpha', '/guides/bravo'],
      );

      assert.equal(await page.locator('[data-chat-empty]').isVisible(), false);
      // The speaker label and the question, in that order, from the `you` message.
      assert.equal(
        await page.locator('[data-turn="user"]').textContent(),
        'youWhat does alpha cover?',
      );
    },
  );
});

/* -- transcript 2: an answer with no citations ------------------------------ */

test('an empty citation payload renders the no-sources state, not a bare answer', async () => {
  await withPage(streamAnswer('The knowledge base does not cover that.', []), async (page) => {
    await ask(page);
    await settled(page);

    const sources = page.locator('[data-chat-sources]');
    assert.equal(await sources.count(), 1, 'the sources block still renders');
    assert.equal(await sources.getAttribute('data-empty'), '');
    assert.equal(await sources.textContent(), 'no-sources');
    assert.equal(
      await page.locator('[data-chat-sources] .source-card').count(),
      0,
      'nothing may be presented as a source',
    );
  });
});

/* -- transcript 3: the stream dies mid-answer ------------------------------- */

test('a stream that dies mid-answer keeps the partial text and reports inline', async () => {
  await withPage(
    (res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(frame('Partial answer'));
      // No citations frame, no clean end: the socket goes away.
      setTimeout(() => res.destroy(), 50);
    },
    async (page) => {
      await ask(page);
      await settled(page);

      assert.equal(
        await page.locator('[data-turn="assistant"] [data-turn-body]').textContent(),
        'Partial answer',
        'text that already arrived must survive the failure',
      );
      assert.equal(await page.locator('[data-chat-error]').textContent(), 'error');
      assert.equal(
        await page.locator('[data-turn="user"]').count(),
        1,
        'the transcript must be preserved',
      );
    },
  );
});

/* -- worker failure statuses ------------------------------------------------ */

for (const [status, expected] of [
  [429, 'rate-limited'],
  [503, 'unavailable'],
  [500, 'error'],
]) {
  test(`a ${status} renders the ${expected} message inline and preserves the transcript`, async () => {
    await withPage(
      (res) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'nope' }));
      },
      async (page) => {
        await ask(page, 'A question that fails.');
        await settled(page);

        assert.equal(await page.locator('[data-chat-error]').textContent(), expected);
        assert.equal(await page.locator('[data-turn="user"]').textContent(), `youA question that fails.`);
        assert.equal(
          await page.locator('[data-chat-form] button[type="submit"]').isDisabled(),
          false,
          'the composer must be usable again',
        );
      },
    );
  });
}

/* -- progressive rendering -------------------------------------------------- */

test('answer text renders frame by frame rather than after the stream closes', async () => {
  await withPage(
    (res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(frame('first '));
      setTimeout(() => {
        res.write(frame('second'));
        res.write(citationsFrame([{ title: 'Alpha Guide', url: '/guides/alpha' }]));
        res.end();
      }, 400);
    },
    async (page) => {
      await ask(page);

      // Observable before the stream closes: the whole point of streaming.
      await page.waitForFunction(
        () =>
          document.querySelector('[data-turn="assistant"] [data-turn-body]')?.textContent ===
          'first ',
      );
      assert.equal(
        await page.locator('[data-chat-sources]').count(),
        0,
        'citations must not render until the payload arrives',
      );

      await settled(page);
      assert.equal(
        await page.locator('[data-turn="assistant"] [data-turn-body]').textContent(),
        'first second',
      );
      assert.equal(await page.locator('[data-chat-sources] .source-card').count(), 1);
    },
  );
});

/* -- upstream frame shapes -------------------------------------------------- */

// The generation model streams OpenAI-compatible chunks, not the documented
// `{response}` form. Reading only the latter rendered a blank answer under a full set
// of citations against the real deployed worker, which is the defect these pin.
test('an OpenAI-compatible content frame renders as the answer', async () => {
  await withPage(
    (res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Chunked ' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'answer.' } }] })}\n\n`);
      res.write(citationsFrame([{ title: 'Alpha Guide', url: '/guides/alpha' }]));
      res.end();
    },
    async (page) => {
      await ask(page);
      await settled(page);
      assert.equal(
        await page.locator('[data-turn="assistant"] [data-turn-body]').textContent(),
        'Chunked answer.',
      );
    },
  );
});

test('a reasoning stream is never rendered as the answer', async () => {
  await withPage(
    (res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // A reasoning model emits far more of this than of the answer itself.
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'Let me think about ' } }] })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'the question.' } }] })}\n\n`,
      );
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'The answer.' } }] })}\n\n`);
      res.write(citationsFrame([{ title: 'Alpha Guide', url: '/guides/alpha' }]));
      res.end();
    },
    async (page) => {
      await ask(page);
      await settled(page);
      const body = await page.locator('[data-turn="assistant"] [data-turn-body]').textContent();
      assert.equal(body, 'The answer.');
      assert.equal(body.includes('think'), false, 'private reasoning must not reach the reader');
    },
  );
});

/* -- citations come only from the payload ----------------------------------- */

test('a URL written in the answer prose never becomes a source card', async () => {
  await withPage(
    streamAnswer('See /guides/invented and https://example.invalid/page for more.', []),
    async (page) => {
      await ask(page);
      await settled(page);
      assert.equal(
        await page.locator('[data-chat-sources] .source-card').count(),
        0,
        'the renderer must ignore prose entirely',
      );
      assert.equal(await page.locator('[data-chat-sources]').getAttribute('data-empty'), '');
    },
  );
});

// Every one of these looks site-root-absolute to a leading-character test, and every
// one of them resolves off-origin in a real URL parser: a backslash is a slash for
// http(s), and a tab is stripped before parsing rather than encoded.
test('a citation URL that is not site-root-absolute renders as text, never as a link', async () => {
  await withPage(
    streamAnswer('Answer.', [
      { title: 'Script', url: 'javascript:alert(1)' },
      { title: 'Offsite', url: '//evil.example.invalid/x' },
      { title: 'Backslash', url: '/\\evil.example.invalid/x' },
      { title: 'Double backslash', url: '\\\\evil.example.invalid/x' },
      { title: 'Tab', url: '/\t/evil.example.invalid/x' },
      { title: 'Real', url: '/guides/alpha' },
    ]),
    async (page) => {
      await ask(page);
      await settled(page);
      const hrefs = await page
        .locator('[data-chat-sources] a.source-card')
        .evaluateAll((links) => links.map((link) => link.href));
      assert.equal(hrefs.length, 1, 'only a site-root-absolute URL may become a link');
      assert.equal(new URL(hrefs[0]).pathname, '/guides/alpha');
      assert.equal(
        hrefs.every((href) => new URL(href).origin === new URL(page.url()).origin),
        true,
        'no rendered link may resolve off this origin',
      );
      assert.equal(await page.locator('[data-chat-sources] span.source-card').count(), 5);
    },
  );
});

/* -- the citations frame is a contract, not an optional trailer -------------- */

test('a clean close with no citations frame reports an error rather than "no sources"', async () => {
  await withPage(
    (res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(frame('An answer that arrived.'));
      // No citations frame, but a clean end: the source list never came, which is not
      // the same claim as "this answer rests on nothing".
      res.end();
    },
    async (page) => {
      await ask(page);
      await settled(page);

      assert.equal(
        await page.locator('[data-turn="assistant"] [data-turn-body]').textContent(),
        'An answer that arrived.',
        'the answer that did arrive must survive',
      );
      assert.equal(await page.locator('[data-chat-error]').textContent(), 'error');
      assert.equal(
        await page.locator('[data-chat-sources]').count(),
        0,
        'a missing payload must not be rendered as an empty one',
      );
    },
  );
});

/* -- session history -------------------------------------------------------- */

test('history lives in sessionStorage and never in localStorage', async () => {
  await withPage(streamAnswer('Alpha covers alpha.', []), async (page) => {
    await ask(page, 'First question.');
    await settled(page);

    const stored = await page.evaluate(() => ({
      session: sessionStorage.getItem('chat-history'),
      local: localStorage.getItem('chat-history'),
      localKeys: localStorage.length,
    }));
    assert.equal(stored.local, null, 'nothing may persist past the tab');
    assert.equal(stored.localKeys, 0);
    assert.deepEqual(JSON.parse(stored.session), [
      { role: 'user', content: 'First question.' },
      { role: 'assistant', content: 'Alpha covers alpha.' },
    ]);
  });
});

// Four MESSAGES, which is two prior exchanges: a question and its answer are one
// entry each, and `workers/chat/` applies the same window to what it receives.
test('only the last four history messages are sent to the worker', async () => {
  await withPage(streamAnswer('Answer.', []), async (page, requests) => {
    await page.evaluate(() => {
      const history = [];
      for (let i = 1; i <= 3; i += 1) {
        history.push({ role: 'user', content: `question ${i}` });
        history.push({ role: 'assistant', content: `answer ${i}` });
      }
      sessionStorage.setItem('chat-history', JSON.stringify(history));
    });

    await ask(page, 'The newest question.');
    await settled(page);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].message, 'The newest question.');
    assert.deepEqual(
      requests[0].history,
      [
        { role: 'user', content: 'question 2' },
        { role: 'assistant', content: 'answer 2' },
        { role: 'user', content: 'question 3' },
        { role: 'assistant', content: 'answer 3' },
      ],
      'six stored messages must be cut to the last four on the way out',
    );
  });
});

// The store is the window sent to the worker, and `workers/chat/` answers a blank
// history entry with a 400. A refused request appends nothing, so an unusable entry
// written once would never age out of the window: every later question in the tab
// would fail until the tab was closed. Both directions of that are pinned here.
test('a turn with no answer text is not stored, so the next question still works', async () => {
  let turn = 0;
  await withPage(
    (res) => {
      turn += 1;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // Turn 1 is the shape the deployed worker produced: private reasoning, a normal
      // citations frame, and no answer text at all.
      if (turn === 1) {
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'Thinking.' } }] })}\n\n`,
        );
      } else {
        res.write(frame('The second answer.'));
      }
      res.write(citationsFrame([{ title: 'Alpha Guide', url: '/guides/alpha' }]));
      res.end();
    },
    async (page, requests) => {
      await ask(page, 'First question.');
      await settled(page);

      assert.equal(
        await page.locator('[data-turn="assistant"] [data-turn-body]').textContent(),
        '',
        'the turn itself renders, empty, with its sources',
      );
      assert.equal(
        await page.evaluate(() => sessionStorage.getItem('chat-history')),
        null,
        'a turn the worker would refuse is never written to the store',
      );

      await ask(page, 'Second question.');
      await settled(page);

      assert.equal(requests.length, 2, 'the second question must reach the worker');
      assert.deepEqual(requests[1].history, [], 'no blank entry may be sent');
      assert.deepEqual(
        JSON.parse(await page.evaluate(() => sessionStorage.getItem('chat-history'))),
        [
          { role: 'user', content: 'Second question.' },
          { role: 'assistant', content: 'The second answer.' },
        ],
        'the turn that did answer is stored normally',
      );
    },
  );
});

// Dropping the turn is only half of what the reader needs. Left alone, the same stream
// renders the speaker label, an empty body and a row of source cards, which reads as an
// answer the model declined to give rather than one that never arrived -- and says
// nothing about the retry being free.
test('an answer with no text renders an inline note beside the sources that did arrive', async () => {
  await withPage(
    (res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'Thinking.' } }] })}\n\n`,
      );
      res.write(citationsFrame([{ title: 'Alpha Guide', url: '/guides/alpha' }]));
      res.end();
    },
    async (page) => {
      await ask(page);
      await settled(page);

      assert.equal(
        await page.locator('[data-turn="assistant"] [data-turn-body]').textContent(),
        '',
        'there is no answer text to render',
      );
      assert.equal(
        await page.locator('[data-chat-empty-answer]').textContent(),
        'empty-answer',
        'the reader must be told the answer never arrived',
      );
      assert.equal(
        await page.locator('[data-chat-sources] .source-card').count(),
        1,
        'the sources that did arrive still render',
      );
      assert.equal(
        await page.locator('[data-chat-error]').count(),
        0,
        'the citations frame arrived, so the broken-contract note must not also fire',
      );
    },
  );
});

// When the citations payload is empty and the answer is also empty, the note must not
// claim sources were found: the "no sources found" text is already rendered above it.
test('an empty-answer note with no citations uses copy that does not claim sources arrived', async () => {
  await withPage(
    (res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'Thinking.' } }] })}\n\n`,
      );
      res.write(citationsFrame([]));
      res.end();
    },
    async (page) => {
      await ask(page);
      await settled(page);

      assert.equal(
        await page.locator('[data-chat-empty-answer]').textContent(),
        'empty-answer-no-sources',
        'the no-sources variant must be used when citations are empty',
      );
      assert.equal(
        await page.locator('[data-chat-sources]').getAttribute('data-empty'),
        '',
        'the sources block shows the empty state',
      );
    },
  );
});

// The two unanswered-turn states are distinct and a turn gets one note, never both:
// this stream broke its citations contract as well, and the generic error is the more
// accurate thing to say about it.
test('a turn with neither answer text nor a citations frame reports only the error', async () => {
  await withPage(
    (res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'Thinking.' } }] })}\n\n`,
      );
      res.end();
    },
    async (page) => {
      await ask(page);
      await settled(page);

      assert.equal(await page.locator('[data-chat-error]').textContent(), 'error');
      assert.equal(
        await page.locator('[data-chat-empty-answer]').count(),
        0,
        'one note per turn: the error already covers this state',
      );
    },
  );
});

test('a blank history entry already in the store is dropped rather than sent', async () => {
  await withPage(streamAnswer('Answer.', []), async (page, requests) => {
    await page.evaluate(() =>
      sessionStorage.setItem(
        'chat-history',
        JSON.stringify([
          { role: 'user', content: 'an earlier question' },
          { role: 'assistant', content: '   ' },
          { role: 'moderator', content: 'a role the worker does not model' },
        ]),
      ),
    );

    await ask(page, 'The newest question.');
    await settled(page);

    assert.deepEqual(
      requests[0].history,
      [{ role: 'user', content: 'an earlier question' }],
      'only entries the worker accepts may be sent',
    );
    assert.deepEqual(
      JSON.parse(await page.evaluate(() => sessionStorage.getItem('chat-history'))),
      [
        { role: 'user', content: 'an earlier question' },
        { role: 'user', content: 'The newest question.' },
        { role: 'assistant', content: 'Answer.' },
      ],
      'the store is rewritten without the unusable entries',
    );
  });
});

test('a corrupt session store is ignored rather than breaking the conversation', async () => {
  await withPage(streamAnswer('Answer.', []), async (page, requests) => {
    await page.evaluate(() => sessionStorage.setItem('chat-history', 'not json'));
    await ask(page);
    await settled(page);
    assert.deepEqual(requests[0].history, []);
    assert.equal(
      await page.locator('[data-turn="assistant"] [data-turn-body]').textContent(),
      'Answer.',
    );
  });
});

/* -- ?ctx= location contexts (the QR flow) ---------------------------------- */

test('a known ctx opens with that context greeting and links its article', async () => {
  await withPage(
    streamAnswer('Answer.', []),
    async (page) => {
      const greeting = page.locator('[data-chat-greeting]');
      assert.equal(await greeting.getAttribute('data-chat-greeting'), 'north-dock');
      assert.equal(
        await greeting.locator('[data-turn-body]').textContent(),
        CONTEXTS[0].greeting,
      );
      assert.equal(
        await page.locator('[data-chat-empty]').isVisible(),
        false,
        'the transcript has an opening message, so the empty state must be gone',
      );
      assert.equal(
        await page.locator('[data-chat-greeting-article]').getAttribute('href'),
        '/guides/alpha',
      );
    },
    { contexts: CONTEXTS, search: '?ctx=north-dock' },
  );
});

test('a context greeting sends its hint with the first question and with no other', async () => {
  await withPage(
    streamAnswer('Answer.', []),
    async (page, requests) => {
      await ask(page, 'First question.');
      await settled(page);
      assert.equal(requests[0].hint, CONTEXTS[0].hint, 'the first question carries the hint');

      await ask(page, 'Second question.');
      await settled(page);
      assert.equal(requests.length, 2);
      assert.equal(
        'hint' in requests[1],
        false,
        'a hint aims retrieval at one place; by the second question the reader has moved on',
      );
    },
    { contexts: CONTEXTS, search: '?ctx=north-dock' },
  );
});

// The hint is spent when the worker takes the question, not when the request is built.
// Clearing it on send would let a first question that 503s burn it, leaving the reader's
// first ANSWERED question -- the one they scanned the code to ask -- unbiased.
test('a first question the worker refuses does not spend the hint', async () => {
  let attempt = 0;
  await withPage(
    (res) => {
      attempt += 1;
      if (attempt === 1) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'generation_unavailable' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ response: 'Answer.' })}\n\n`);
      res.write(`event: citations\ndata: ${JSON.stringify({ citations: [] })}\n\n`);
      res.end();
    },
    async (page, requests) => {
      await ask(page, 'First question.');
      await settled(page);
      assert.equal(await page.locator('[data-chat-error]').textContent(), 'unavailable');
      assert.equal(requests[0].hint, CONTEXTS[0].hint);

      await ask(page, 'Second question.');
      await settled(page);
      assert.equal(
        requests[1].hint,
        CONTEXTS[0].hint,
        'the retry is still the first question that reaches the worker',
      );

      await ask(page, 'Third question.');
      await settled(page);
      assert.equal('hint' in requests[2], false, 'now it is spent');
    },
    { contexts: CONTEXTS, search: '?ctx=north-dock' },
  );
});

test('a context with no hint and no article greets and sends no hint field', async () => {
  await withPage(
    streamAnswer('Answer.', []),
    async (page, requests) => {
      assert.equal(
        await page.locator('[data-chat-greeting] [data-turn-body]').textContent(),
        CONTEXTS[1].greeting,
      );
      assert.equal(await page.locator('[data-chat-greeting-article]').count(), 0);

      await ask(page);
      await settled(page);
      assert.equal('hint' in requests[0], false);
    },
    { contexts: CONTEXTS, search: '?ctx=ridge-gate' },
  );
});

// A printed code outlives the manifest entry that made it. A reader standing in front
// of a retired sign gets the ordinary page, never an error about a slug they have no
// way to understand.
for (const [label, search] of [
  ['an unknown ctx', '?ctx=nowhere-at-all'],
  ['an empty ctx', '?ctx='],
  ['no ctx at all', ''],
]) {
  test(`${label} renders the default greeting with no error and sends no hint`, async () => {
    await withPage(
      streamAnswer('Answer.', []),
      async (page, requests) => {
        assert.equal(await page.locator('[data-chat-greeting]').count(), 0);
        assert.equal(
          await page.locator('[data-chat-empty]').isVisible(),
          true,
          'the default empty-state greeting stands',
        );
        assert.equal(await page.locator('[data-chat-error]').count(), 0);

        await ask(page);
        await settled(page);
        assert.equal('hint' in requests[0], false);
      },
      { contexts: CONTEXTS, search },
    );
  });
}

// An instance with no knowledge/chat/_contexts.md ships no attribute at all. The page
// then behaves exactly as it did before contexts existed, ctx or no ctx.
test('a page built with no contexts ignores ctx entirely', async () => {
  await withPage(
    streamAnswer('Answer.', []),
    async (page, requests) => {
      assert.equal(
        await page.locator('[data-chat-form]').getAttribute('data-contexts'),
        null,
        'no manifest means no attribute, not an empty one',
      );
      assert.equal(await page.locator('[data-chat-greeting]').count(), 0);
      assert.equal(await page.locator('[data-chat-empty]').isVisible(), true);
      assert.equal(await page.locator('[data-chat-error]').count(), 0);

      await ask(page);
      await settled(page);
      assert.equal('hint' in requests[0], false);
      assert.equal(
        await page.locator('[data-turn="assistant"] [data-turn-body]').textContent(),
        'Answer.',
      );
    },
    { search: '?ctx=north-dock' },
  );
});

test('a malformed contexts attribute is ignored rather than breaking the page', async () => {
  await withPage(
    streamAnswer('Answer.', []),
    async (page, requests) => {
      assert.equal(await page.locator('[data-chat-greeting]').count(), 0);
      await ask(page);
      await settled(page);
      assert.equal(
        await page.locator('[data-turn="assistant"] [data-turn-body]').textContent(),
        'Answer.',
        'the conversation still works',
      );
      assert.equal('hint' in requests[0], false);
    },
    { contexts: 'not-an-array', search: '?ctx=north-dock' },
  );
});

// A greeting is prose an adopter writes, and prose contains angle brackets. The value
// travels as an attribute, so the browser's own attribute parsing is the escaping --
// there is no second rule to get wrong, and nothing in a greeting can become markup.
test('a greeting containing markup renders as text, never as markup', async () => {
  const hostile = [
    {
      slug: 'north-dock',
      label: 'North Dock',
      greeting: 'Ask about the <script>alert(1)</script> boats & the birds.',
      hint: null,
      article: null,
    },
  ];
  await withPage(
    streamAnswer('Answer.', []),
    async (page) => {
      assert.equal(
        await page.locator('[data-chat-greeting] [data-turn-body]').textContent(),
        hostile[0].greeting,
      );
      assert.equal(
        await page.evaluate(() => document.querySelectorAll('[data-chat-log] script').length),
        0,
        'nothing in a greeting may become an element',
      );
    },
    { contexts: hostile, search: '?ctx=north-dock' },
  );
});

test('an empty question is not sent', async () => {
  await withPage(streamAnswer('Answer.', []), async (page, requests) => {
    await page.locator('[data-chat-input]').fill('   ');
    await page.locator('[data-chat-form] button[type="submit"]').click();
    await page.waitForTimeout(200);
    assert.equal(requests.length, 0);
  });
});
