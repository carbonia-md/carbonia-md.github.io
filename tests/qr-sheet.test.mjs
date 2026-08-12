// qr-sheet.test.mjs -- run with
// `node --experimental-strip-types --test tests/qr-sheet.test.mjs`.
//
// scripts/lib/qr-sheet.mjs renders the printable sheet of chat-context QR codes.
// Once a sheet is printed and on a wall it cannot be reissued, so the two
// properties worth a suite are the ones a visual check cannot catch:
//
//   1. Each card's QR really encodes THAT card's URL. A neighbour's code, or a
//      stale one, looks identical to a human and sends every scanner to the
//      wrong place. Asserted by round-tripping each card's own inline SVG back
//      through the encoder's decoder.
//   2. The document is self-contained and prints on both papers. No <img>, no
//      off-origin reference, no script; and the layout constants are checked
//      against A4 AND US Letter, since the sheet is printed on whichever the
//      adopter owns.
//
// Everything here is synthetic: tests/ is scanned by the place-name and
// English-only gates, so no fixture names a real place and every byte is ASCII.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Bitmap, encodeQR } from '@paulmillr/qr';
import decodeQR from '@paulmillr/qr/decode.js';

import { PAGE, SHEET_OUTPUT_PATH, contextUrl, renderSheet } from '../scripts/lib/qr-sheet.mjs';

/* ------------------------------------------------------------------ fixtures */

const DOMAIN = 'example.invalid';
const SITE_NAME = 'Example Knowledge Base';
const GENERATED = '2026-08-08T00:00:00.000Z';

/** One ChatContext, as src/lib/chat-contexts.ts publishes it. */
function context(overrides = {}) {
  return {
    slug: 'alpha',
    label: 'Example Landmark',
    greeting: 'Ask about this spot.',
    hint: null,
    article: null,
    ...overrides,
  };
}

const TWO = [
  context({ slug: 'alpha', label: 'Example Landmark' }),
  context({ slug: 'north-dock', label: 'North Dock', hint: 'Try asking about the tide.', article: '/guides/alpha' }),
];

const sheet = (contexts, overrides = {}) =>
  renderSheet({ contexts, domain: DOMAIN, siteName: SITE_NAME, generated: GENERATED, ...overrides });

/** Every card in document order: its declared slug and its inner markup. */
function cards(document) {
  return [...document.matchAll(/<article class="card" data-context="([^"]*)">([\s\S]*?)<\/article>/g)].map((match) => ({
    slug: match[1],
    html: match[2],
  }));
}

/** The single inline <svg> element of a card. */
function cardSvg(card) {
  const found = card.html.match(/<svg\b[\s\S]*?<\/svg>/);
  assert.ok(found, `expected an inline <svg> in the card for "${card.slug}", got: ${card.html}`);
  return found[0];
}

/** Every <rect> of an SVG, as x/y/width/height numbers. */
function svgRects(markup) {
  return [...markup.matchAll(/<rect\b[^>]*>/g)].map((match) => {
    const number = (name) => {
      const attr = match[0].match(new RegExp(`\\b${name}="([^"]*)"`));
      return attr ? Number(attr[1]) : NaN;
    };
    return { x: number('x'), y: number('y'), width: number('width'), height: number('height') };
  });
}

/**
 * Read a QR back out of rendered SVG markup: rebuild the module grid from the
 * rects, then hand it to the encoder's own decoder. This is what proves the card
 * carries the code for its own URL rather than a plausible-looking neighbour.
 */
function decodeSvg(markup) {
  const rects = svgRects(markup);
  assert.ok(rects.length > 0, `expected the QR svg to carry <rect> modules, got: ${markup.slice(0, 200)}`);
  const unit = Math.min(...rects.map((rect) => rect.width));
  const viewBox = markup.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  assert.ok(viewBox, `expected the QR svg to declare a square viewBox, got: ${markup.slice(0, 200)}`);
  const size = Math.round(Number(viewBox[1]) / unit);
  const grid = Array.from({ length: size }, () => new Array(size).fill(false));
  for (const rect of rects) {
    const x = Math.round(rect.x / unit);
    const y = Math.round(rect.y / unit);
    for (let dy = 0; dy < Math.round(rect.height / unit); dy += 1) {
      for (let dx = 0; dx < Math.round(rect.width / unit); dx += 1) grid[y + dy][x + dx] = true;
    }
  }
  return decodeQR(new Bitmap({ width: size, height: size }, grid).scale(4).toImage(false));
}

/** The rect payload, normalized to module coordinates, so wrapper attributes do not matter. */
function modules(markup) {
  const rects = svgRects(markup);
  const unit = Math.min(...rects.map((rect) => rect.width));
  return rects
    .map((rect) => `${Math.round(rect.x / unit)},${Math.round(rect.y / unit)}`)
    .sort()
    .join(' ');
}

/* ------------------------------------------------------------- the constants */

describe('the published constants', () => {
  test('the sheet is written to qr-sheet.html', () => {
    assert.equal(SHEET_OUTPUT_PATH, 'qr-sheet.html');
  });

  test('the page is the narrower and shorter of A4 and US Letter', () => {
    // The adopter prints on whichever paper their office stocks, so the layout
    // is built for the intersection of the two, not for either one.
    assert.equal(PAGE.widthMm, Math.min(210, 216), 'the narrower of A4 (210mm) and US Letter (216mm)');
    assert.equal(PAGE.heightMm, Math.min(297, 279), 'the shorter of A4 (297mm) and US Letter (279mm)');
  });

  test('the card grid fits inside the margins of both papers', () => {
    assert.ok(
      PAGE.columns * PAGE.cardWidthMm <= PAGE.widthMm - 2 * PAGE.marginMm,
      `${PAGE.columns} columns of ${PAGE.cardWidthMm}mm do not fit in ${PAGE.widthMm}mm less ${PAGE.marginMm}mm margins`,
    );
    assert.ok(
      PAGE.cardHeightMm <= PAGE.heightMm - 2 * PAGE.marginMm,
      `a ${PAGE.cardHeightMm}mm card does not fit in ${PAGE.heightMm}mm less ${PAGE.marginMm}mm margins`,
    );
  });

  test('every layout constant is a usable positive measurement', () => {
    for (const key of ['marginMm', 'widthMm', 'heightMm', 'columns', 'cardWidthMm', 'cardHeightMm']) {
      const value = PAGE[key];
      assert.equal(typeof value, 'number', `PAGE.${key} must be a number`);
      assert.ok(Number.isFinite(value) && value > 0, `PAGE.${key} must be positive and finite, got ${value}`);
    }
    assert.ok(Number.isInteger(PAGE.columns), `PAGE.columns must be a whole number of columns, got ${PAGE.columns}`);
  });
});

/* --------------------------------------------------------------- contextUrl */

describe('contextUrl', () => {
  test('composes the chat route and the context query parameter', () => {
    assert.equal(contextUrl('example.invalid', 'north-dock'), 'https://example.invalid/chat?ctx=north-dock');
  });

  test('keeps an explicit scheme instead of doubling it', () => {
    assert.equal(contextUrl('https://example.invalid', 'alpha'), 'https://example.invalid/chat?ctx=alpha');
    assert.equal(contextUrl('http://example.invalid', 'alpha'), 'http://example.invalid/chat?ctx=alpha');
  });

  test('strips a trailing slash from the domain', () => {
    assert.equal(contextUrl('example.invalid/', 'alpha'), 'https://example.invalid/chat?ctx=alpha');
    assert.equal(contextUrl('https://example.invalid/', 'alpha'), 'https://example.invalid/chat?ctx=alpha');
  });
});

/* -------------------------------------------------------------- the cards */

describe('renderSheet emits one card per context', () => {
  test('each context gets exactly one card, carrying its slug, in the order given', () => {
    assert.deepEqual(
      cards(sheet(TWO)).map((card) => card.slug),
      ['alpha', 'north-dock'],
    );
  });

  test('a single context yields a single card', () => {
    assert.equal(cards(sheet([context()])).length, 1);
  });

  test('an empty context list still returns a valid document with no cards', () => {
    // The CLI is what decides not to write an empty sheet; the renderer just
    // renders one.
    const document = sheet([]);
    assert.equal(typeof document, 'string');
    assert.ok(document.includes('<html'), 'expected a whole document');
    assert.ok(document.includes('</html>'), 'expected a whole document');
    assert.deepEqual(cards(document), []);
  });

  test('each card shows its label and the full URL as visible text', () => {
    const document = sheet(TWO);
    for (const [index, card] of cards(document).entries()) {
      const url = contextUrl(DOMAIN, TWO[index].slug);
      assert.ok(card.html.includes(TWO[index].label), `expected the label in the card for "${card.slug}"`);
      assert.ok(card.html.includes(url), `expected the URL "${url}" as text in its own card`);
    }
  });
});

/* ------------------------------------------- the load-bearing QR assertions */

describe("the QR in a card encodes that card's own URL", () => {
  test('the encoder round-trips a context URL through its own decoder', () => {
    // The reference assertion the rest of this section depends on: if this ever
    // fails, the encoder changed, not the sheet.
    const url = contextUrl(DOMAIN, 'north-dock');
    const raw = encodeQR(url, 'raw', { border: 4 });
    const bitmap = new Bitmap({ width: raw[0].length, height: raw.length }, raw).scale(4);
    assert.equal(decodeQR(bitmap.toImage(false)), url);
  });

  test('every card decodes back to the URL printed beneath it', () => {
    const document = sheet(TWO);
    const rendered = cards(document);
    assert.equal(rendered.length, TWO.length);
    for (const [index, card] of rendered.entries()) {
      const url = contextUrl(DOMAIN, TWO[index].slug);
      assert.equal(decodeSvg(cardSvg(card)), url, `the card for "${card.slug}" must encode ${url}`);
    }
  });

  test("each card carries the modules the encoder produces for that card's URL", () => {
    const document = sheet(TWO);
    for (const [index, card] of cards(document).entries()) {
      const url = contextUrl(DOMAIN, TWO[index].slug);
      assert.equal(
        modules(cardSvg(card)),
        modules(encodeQR(url, 'svg', { border: 4 })),
        `the card for "${card.slug}" must carry the code for ${url}`,
      );
    }
  });

  test('two contexts never share a QR', () => {
    // The failure this catches: one code rendered into every card. A human
    // reading the sheet cannot see the difference.
    const [first, second] = cards(sheet(TWO)).map((card) => cardSvg(card));
    assert.notEqual(first, second, 'each context must get its own code');
  });

  test("changing a slug changes that card's code", () => {
    const before = cardSvg(cards(sheet([context({ slug: 'alpha' })]))[0]);
    const after = cardSvg(cards(sheet([context({ slug: 'bravo' })]))[0]);
    assert.notEqual(before, after);
    assert.equal(decodeSvg(after), contextUrl(DOMAIN, 'bravo'));
  });

  test('the QR is inline SVG, never an image reference', () => {
    // An <img> would need a file beside the HTML; a printed sheet has to survive
    // being emailed as one file.
    const document = sheet(TWO);
    assert.equal(document.includes('<img'), false, 'the sheet must not reference an image');
    assert.equal(/\bsrc=/.test(document), false, 'the sheet must carry no src attribute at all');
    for (const card of cards(document)) {
      assert.ok(card.html.includes('<svg'), `expected inline svg in the card for "${card.slug}"`);
    }
  });
});

/* ----------------------------------------------------------------- escaping */

describe('text is HTML-escaped', () => {
  const HOSTILE = context({ slug: 'bravo', label: 'A & B <script>' });

  test('a label carrying markup never reaches the document as markup', () => {
    const document = sheet([HOSTILE]);
    assert.equal(document.includes('<script'), false, 'a label must not open a script element');
    assert.equal(document.includes('A & B'), false, 'the raw label must not be emitted verbatim');
    assert.ok(document.includes('&amp;'), 'the ampersand must be escaped');
    assert.ok(document.includes('&lt;'), 'the angle bracket must be escaped');
  });

  test('the document carries no unescaped ampersand', () => {
    const document = sheet([HOSTILE, ...TWO]);
    const bare = document.match(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g);
    assert.equal(bare, null, `expected every ampersand to be an entity, found ${bare && bare.length}`);
  });

  test('an escaped label does not disturb the card QR', () => {
    const card = cards(sheet([HOSTILE]))[0];
    assert.equal(decodeSvg(cardSvg(card)), contextUrl(DOMAIN, 'bravo'));
  });
});

/* ------------------------------------------------------------- print layout */

describe('the sheet is built to print', () => {
  test('the document carries an @media print block', () => {
    assert.ok(/@media\s+print\b/.test(sheet(TWO)), 'expected an @media print block');
  });

  test('an @page rule declares the margin from PAGE', () => {
    const document = sheet(TWO);
    const rule = document.match(/@page\b[^{]*\{[^}]*\}/);
    assert.ok(rule, 'expected an @page rule');
    assert.ok(
      rule[0].includes(`${PAGE.marginMm}mm`),
      `expected the @page rule to declare ${PAGE.marginMm}mm, got: ${rule[0]}`,
    );
  });

  test('the stylesheet lays the cards out at the published card size', () => {
    const document = sheet(TWO);
    assert.ok(document.includes(`${PAGE.cardWidthMm}mm`), `expected ${PAGE.cardWidthMm}mm in the stylesheet`);
    assert.ok(document.includes(`${PAGE.cardHeightMm}mm`), `expected ${PAGE.cardHeightMm}mm in the stylesheet`);
  });
});

/* -------------------------------------------------------- self-containment */

describe('the sheet is self-contained', () => {
  test('it runs no script', () => {
    assert.equal(sheet(TWO).includes('<script'), false);
  });

  test('no src or href attribute points off-site', () => {
    // The visible URL text is the point of the sheet; a fetched stylesheet, font
    // or image is what would make it print blank on a machine with no network.
    const document = sheet(TWO);
    for (const match of document.matchAll(/\b(?:src|href)="([^"]*)"/g)) {
      const value = match[1];
      assert.equal(
        /^(?:https?:)?\/\//.test(value),
        false,
        `expected no off-origin reference, found ${match[0]}`,
      );
    }
  });
});
