// manual-adapter.mjs -- the only sink this framework ships.
//
// It is deliberately NOT a platform client: it opens no network connection,
// stores no credentials, and knows no platform API. It prints the approved post
// text for the operator to paste wherever they publish, then records the URL
// they paste back. That is what makes `posted` a reachable state before any
// instance has a social account, so the first posts can go out by hand.
//
// See ./README.md for the adapter interface every future sink implements.
//
// This file lives under scripts/, which both machine gates scan: its source is
// pure ASCII and carries no denylisted place term.

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { isHttpUrl } from './queue.mjs';

// The tightest limit among mainstream short-form platforms. A draft that fits it
// pastes anywhere, which is the only bound a platform-neutral sink can enforce.
const MANUAL_MAX_CHARS = 280;

// One interface for the whole run. Creating and closing one per prompt drops
// buffered lines when stdin is a pipe, which is exactly how the runner is
// driven in a scripted proof.
let rl = null;
function reader() {
  if (rl === null) rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
  return rl;
}

/** Release stdin. The CLI calls this once, after the last entry. */
export function closeManualAdapter() {
  if (rl !== null) {
    rl.close();
    rl = null;
  }
}

/** @type {import('./adapter.d.ts').SnippetAdapter} */
export const manualAdapter = {
  id: 'manual',
  maxChars: MANUAL_MAX_CHARS,

  async publish(draft) {
    stdout.write(
      `\n--- ${draft.id} | ${draft.slug} | ${draft.chars} chars ---\n` +
        `${draft.text}\n` +
        '--- end of post text ---\n' +
        'Post the text above by hand, then paste its URL below.\n',
    );

    const answer = (await reader().question('Published URL (blank to leave it approved): ')).trim();
    if (answer === '') throw new Error('no URL supplied by the operator');
    if (!isHttpUrl(answer)) throw new Error(`"${answer}" is not an http(s) URL`);
    return { url: answer };
  },
};
