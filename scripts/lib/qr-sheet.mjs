// qr-sheet.mjs -- the printable QR sheet's URL rule and its renderer.
//
// Split from the CLI (scripts/tools/qr-sheet.mjs) so the two things worth testing --
// what URL a context encodes, and what the sheet puts on the page -- are testable
// without a place config, a filesystem, or a browser.
//
// Everything is inline. The QR codes are SVG elements in the document, not <img>
// references, and there is no stylesheet, font, or script fetched from anywhere: a
// sheet is printed from a laptop in a back office, sometimes from a file:// URL, and
// a code that fails to load is a wall poster that goes nowhere.
//
// This file lives under scripts/, which both genericity gates scan: its source is
// pure ASCII and carries no place-specific string. Every place-bearing value comes
// from the manifest and the place config the CLI reads.

import { encodeQR } from '@paulmillr/qr';

/** Repository-relative path the CLI writes. Gitignored: it is a print artifact. */
export const SHEET_OUTPUT_PATH = 'qr-sheet.html';

/**
 * Quiet zone, in modules. Four is the QR specification's minimum; the encoder's
 * default is two, which scans fine on a screen and unreliably off paper against a
 * busy background. Printed codes get the specified border.
 */
const QR_BORDER = 4;

/**
 * Page geometry, in millimetres.
 *
 * One sheet has to print correctly on both A4 (210 x 297 mm) and US Letter
 * (216 x 279 mm) without the operator choosing a paper size, so the layout is
 * built for the INTERSECTION of the two: A4's narrower width and Letter's shorter
 * height. Anything that fits inside that rectangle fits on either sheet, which is
 * why `@page` declares only a margin and never a `size`.
 */
export const PAGE = {
  /** Printer-safe margin on all four sides. */
  marginMm: 12,
  /** A4's width -- the narrower of the two papers. */
  widthMm: 210,
  /** US Letter's height -- the shorter of the two papers. */
  heightMm: 279,
  /** Cards per row. */
  columns: 2,
  /** Gap between cards. */
  gapMm: 8,
  /** (210 - 2*12 - 8) / 2 = 89 */
  cardWidthMm: 89,
  /**
   * Sized so THREE rows clear the tighter of the two papers: 3 * 78 + 2 * 8 = 250,
   * inside Letter's 255 mm of printable height. Six cards a page rather than four is
   * a third less paper for the same codes, and a card no taller than its contents is
   * also a card with no dead space to cut around.
   */
  cardHeightMm: 78,
};

/** Printed edge length of a code. Comfortably scannable at arm's length. */
const CODE_SIZE_MM = 48;

/**
 * The URL a scanned code resolves to: `https://<domain>/chat?ctx=<slug>`.
 *
 * A domain that already carries a scheme keeps it, so an instance served over plain
 * http (a local preview, an intranet) is not silently rewritten to https and made
 * unreachable. A trailing slash is dropped so the path is never doubled.
 */
export function contextUrl(domain, slug) {
  const declared = String(domain ?? '').trim().replace(/\/+$/, '');
  const origin = /^https?:\/\//i.test(declared) ? declared : `https://${declared}`;
  return `${origin}/chat?ctx=${slug}`;
}

/** HTML-escapes text destined for element content or an attribute value. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** One card: the code, the place's name, and the URL a person can type instead. */
function renderCard(context, domain) {
  const url = contextUrl(domain, context.slug);
  return [
    `      <article class="card" data-context="${escapeHtml(context.slug)}">`,
    `        <div class="code">${encodeQR(url, 'svg', { border: QR_BORDER })}</div>`,
    `        <p class="card-label">${escapeHtml(context.label)}</p>`,
    `        <p class="card-url">${escapeHtml(url)}</p>`,
    '      </article>',
  ].join('\n');
}

const STYLE = `
    /* No web font and no stylesheet from anywhere: a sheet is often printed from a
       file:// URL, and a code that renders as a broken box is a wall poster that
       goes nowhere. */
    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: ${PAGE.marginMm}mm;
      background: #ffffff;
      color: #111111;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    h1 {
      margin: 0 0 2mm;
      font-size: 16pt;
    }

    .meta {
      margin: 0 0 8mm;
      font-size: 9pt;
      color: #555555;
    }

    .sheet {
      display: grid;
      grid-template-columns: repeat(${PAGE.columns}, ${PAGE.cardWidthMm}mm);
      gap: ${PAGE.gapMm}mm;
    }

    .card {
      width: ${PAGE.cardWidthMm}mm;
      height: ${PAGE.cardHeightMm}mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding: 5mm 4mm;
      border: 0.4mm solid #cccccc;
      border-radius: 3mm;
      text-align: center;
      /* A card is what gets cut out and mounted, so it never straddles a page break. */
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .code svg {
      width: ${CODE_SIZE_MM}mm;
      height: ${CODE_SIZE_MM}mm;
      display: block;
    }

    /* The encoder emits unfilled rects; black modules on white is what a scanner
       expects, and inverting it is the single most common reason a printed code
       will not read. */
    .code svg rect { fill: #000000; }

    .card-label {
      margin: 3mm 0 1mm;
      font-size: 13pt;
      font-weight: 700;
      line-height: 1.2;
    }

    .card-url {
      margin: 0;
      font-size: 8pt;
      color: #444444;
      word-break: break-all;
      line-height: 1.3;
    }

    .empty {
      font-size: 11pt;
      color: #555555;
    }

    @media print {
      /* Only a margin: declaring a \`size\` would pin the sheet to one paper and
         mis-scale it on the other. The card geometry above already fits inside
         both A4 and US Letter. */
      @page { margin: ${PAGE.marginMm}mm; }

      body { padding: 0; }

      .card { border-color: #999999; }
    }
`;

/**
 * The complete standalone sheet: one card per context, in manifest order.
 *
 * An empty `contexts` list still renders a valid document. Deciding not to write a
 * file at all belongs to the CLI, which is the thing that knows whether the
 * manifest was absent or merely empty.
 */
export function renderSheet({ contexts = [], domain = '', siteName = '', generated = '' } = {}) {
  const cards = contexts.map((context) => renderCard(context, domain)).join('\n');
  const title = siteName ? `${escapeHtml(siteName)} chat codes` : 'Chat codes';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>${STYLE}    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <p class="meta">
      ${contexts.length} context${contexts.length === 1 ? '' : 's'}${
        generated ? ` &middot; generated ${escapeHtml(generated)}` : ''
      } &middot; prints on A4 and US Letter
    </p>
    <div class="sheet">
${cards || '      <p class="empty">No contexts declared.</p>'}
    </div>
  </body>
</html>
`;
}
