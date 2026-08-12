import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';

import { chromium } from 'playwright';

const ENDPOINT = 'https://feedback.example.invalid/submit';
const componentSource = readFileSync(
  new URL('../src/components/FeedbackWidget.astro', import.meta.url),
  'utf8',
);

const submitScriptMatch = componentSource.match(
  /const SUBMIT_SCRIPT = `([\s\S]*?)`;\n---/,
);
assert.ok(submitScriptMatch, 'FeedbackWidget.astro must expose its inline submit script');
const submitScript = submitScriptMatch[1];

const messageFieldMatch = componentSource.match(
  /<textarea[\s\S]*?name="message"[\s\S]*?<\/textarea>/,
);
assert.ok(messageFieldMatch, 'FeedbackWidget.astro must render the message textarea');
assert.match(messageFieldMatch[0], /minlength="10"/);
assert.match(messageFieldMatch[0], /maxlength="4000"/);
assert.match(
  messageFieldMatch[0],
  /aria-describedby="feedback-message-requirement"/,
);
assert.match(
  componentSource,
  /id="feedback-message-requirement"[\s\S]*?t\('feedback\.message\.requirement'\)/,
  'the component must render the message requirement as accessible help text',
);

const noscriptMatch = componentSource.match(/<noscript>([\s\S]*?)<\/noscript>/);
assert.ok(noscriptMatch, 'FeedbackWidget.astro must carry a noscript fallback');
assert.match(
  noscriptMatch[1],
  /href=\{`mailto:\$\{links\.email\}`\}/,
  'the noscript fallback must link to links.email',
);
const noscriptCssMatch = noscriptMatch[1].match(
  /<style is:inline>([\s\S]*?)<\/style>/,
);
assert.ok(noscriptCssMatch, 'the noscript fallback must hide the JavaScript controls');
const noscriptCss = noscriptCssMatch[1];

function widgetHtml() {
  return `<!doctype html>
<html>
  <body>
    <section data-feedback-widget>
      <button type="button" data-feedback-open>Give feedback</button>
      <noscript>
        <style>${noscriptCss}</style>
        <a data-feedback-email href="mailto:feedback@example.invalid">Email feedback</a>
      </noscript>
      <dialog
        data-feedback-dialog
        aria-labelledby="feedback-heading"
        aria-describedby="feedback-intro"
      >
        <h2 id="feedback-heading">Something wrong on this page?</h2>
        <p id="feedback-intro">Feedback introduction</p>
        <button
          type="button"
          data-feedback-close
          aria-label="Close feedback form"
          autofocus
        >Close</button>
        <form
          data-feedback-form
          data-endpoint="${ENDPOINT}"
          data-page="/history/example"
          data-msg-sending="Sending..."
          data-msg-success="Thank you. Your feedback was received."
          data-msg-invalid="Please check the {field} field and try again."
          data-msg-rate-limited="Too many submissions from this network. Please try again later."
          data-msg-error="Could not send your feedback. Please try again later."
          data-msg-message-requirement="Enter 10 to 4,000 characters."
        >
          <select name="category"><option value="correction">Correction</option></select>
          <textarea
            name="message"
            required
            minlength="10"
            maxlength="4000"
            aria-describedby="feedback-message-requirement"
          ></textarea>
          <p id="feedback-message-requirement">Enter 10 to 4,000 characters.</p>
          <input name="contact" value="">
          <input name="website" value="">
          <button type="submit">Send feedback</button>
          <p data-feedback-status hidden></p>
        </form>
      </dialog>
      <script>${submitScript}</script>
    </section>
  </body>
</html>`;
}

let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

async function submitWith(response) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let payload;

  await page.route(ENDPOINT, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
      return;
    }

    payload = JSON.parse(request.postData());
    if (response === 'network-failure') {
      await route.abort('connectionfailed');
      return;
    }

    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(response.body),
    });
  });

  await page.setContent(widgetHtml());
  await page.locator('[data-feedback-open]').click();
  await page.locator('textarea[name="message"]').fill('This date needs a correction.');
  await page.locator('input[name="contact"]').fill('reader@example.invalid');
  await page.locator('[data-feedback-form] button[type="submit"]').click();
  const status = page.locator('[data-feedback-status]');
  await status.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-feedback-status]');
    return element?.getAttribute('data-state') !== 'pending';
  });

  return {
    context,
    page,
    payload,
    state: await status.getAttribute('data-state'),
    text: await status.textContent(),
  };
}

test('the article-bottom button opens an accessible modal and both close paths restore focus', async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent(widgetHtml());

    const opener = page.locator('[data-feedback-open]');
    const dialog = page.locator('[data-feedback-dialog]');
    const closer = page.locator('[data-feedback-close]');

    assert.equal(await opener.isVisible(), true);
    assert.equal(await dialog.isVisible(), false);
    assert.equal(await page.locator('[data-feedback-form]').isVisible(), false);
    assert.equal(
      await dialog.getAttribute('aria-labelledby'),
      'feedback-heading',
    );
    assert.equal(
      await dialog.getAttribute('aria-describedby'),
      'feedback-intro',
    );
    assert.equal(
      await closer.getAttribute('aria-label'),
      'Close feedback form',
    );

    await opener.click();
    assert.equal(await dialog.isVisible(), true);
    assert.equal(
      await closer.evaluate((element) => document.activeElement === element),
      true,
    );

    await closer.click();
    assert.equal(await dialog.isVisible(), false);
    assert.equal(
      await opener.evaluate((element) => document.activeElement === element),
      true,
    );

    await opener.click();
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), false);
    assert.equal(
      await opener.evaluate((element) => document.activeElement === element),
      true,
    );
  } finally {
    await context.close();
  }
});

test('the message requirement is visible and invalid lengths are blocked before fetch', async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    let requestCount = 0;
    await page.route(ENDPOINT, async (route) => {
      requestCount += 1;
      await route.fulfill({ status: 200, body: '{}' });
    });
    await page.setContent(widgetHtml());
    await page.locator('[data-feedback-open]').click();

    const message = page.locator('textarea[name="message"]');
    const requirement = page.locator('#feedback-message-requirement');
    assert.equal(await requirement.isVisible(), true);
    assert.equal(await requirement.textContent(), 'Enter 10 to 4,000 characters.');
    assert.equal(await message.getAttribute('minlength'), '10');
    assert.equal(await message.getAttribute('maxlength'), '4000');
    assert.equal(
      await message.getAttribute('aria-describedby'),
      'feedback-message-requirement',
    );

    await message.fill('short');
    await page.locator('[data-feedback-form] button[type="submit"]').click();
    assert.equal(requestCount, 0);
    assert.notEqual(await message.evaluate((element) => element.validationMessage), '');

    await message.fill('          ');
    await page.locator('[data-feedback-form] button[type="submit"]').click();
    assert.equal(requestCount, 0);
    assert.equal(
      await message.evaluate((element) => element.validationMessage),
      'Enter 10 to 4,000 characters.',
    );
  } finally {
    await context.close();
  }
});

test('success posts the worker payload, reports success, and clears the form', async () => {
  const result = await submitWith({ status: 200, body: { ok: true, id: 'feedback-id' } });
  try {
    assert.deepEqual(result.payload, {
      page: '/history/example',
      category: 'correction',
      message: 'This date needs a correction.',
      contact: 'reader@example.invalid',
      website: '',
    });
    assert.equal(result.state, 'success');
    assert.equal(result.text, 'Thank you. Your feedback was received.');
    assert.equal(await result.page.locator('textarea[name="message"]').inputValue(), '');
  } finally {
    await result.context.close();
  }
});

test('a 400 names the rejected field and preserves the message', async () => {
  const result = await submitWith({
    status: 400,
    body: { error: 'too_short', field: 'message' },
  });
  try {
    assert.equal(result.state, 'error');
    assert.equal(result.text, 'Please check the message field and try again.');
    assert.equal(
      await result.page.locator('textarea[name="message"]').inputValue(),
      'This date needs a correction.',
    );
  } finally {
    await result.context.close();
  }
});

test('a 429 reports the rate-limited state', async () => {
  const result = await submitWith({ status: 429, body: { error: 'rate_limited' } });
  try {
    assert.equal(result.state, 'error');
    assert.equal(
      result.text,
      'Too many submissions from this network. Please try again later.',
    );
  } finally {
    await result.context.close();
  }
});

test('a network failure reports the catch-all failure state', async () => {
  const result = await submitWith('network-failure');
  try {
    assert.equal(result.state, 'error');
    assert.equal(result.text, 'Could not send your feedback. Please try again later.');
  } finally {
    await result.context.close();
  }
});

test('JavaScript disabled hides the trigger and dialog and leaves only the email fallback', async () => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.setContent(widgetHtml());

    assert.equal(
      await page
        .locator('[data-feedback-open]')
        .evaluate((opener) => getComputedStyle(opener).display),
      'none',
    );
    assert.equal(
      await page
        .locator('[data-feedback-dialog]')
        .evaluate((dialog) => getComputedStyle(dialog).display),
      'none',
    );
    assert.equal(await page.locator('[data-feedback-form]').isVisible(), false);
    assert.equal(
      await page
        .locator('[data-feedback-form] button[type="submit"]')
        .isVisible(),
      false,
    );
    assert.equal(await page.locator('[data-feedback-email]').isVisible(), true);
    assert.equal(
      await page.locator('[data-feedback-email]').getAttribute('href'),
      'mailto:feedback@example.invalid',
    );
  } finally {
    await context.close();
  }
});
