#!/usr/bin/env node
// chat-eval.mjs -- run the evaluation set against a deployed chat Worker.
//
// The adversarial half of the chat capability's acceptance: it asks every question in
// `knowledge/chat/_eval.md`, checks the citations that come back against the articles
// this site actually publishes, and writes a Markdown report for the human review
// that judges answer quality.
//
// It is a narrow judge on purpose. It fails the run when:
//
//   1. a cited URL is absent from /kb/topics.json -- a link into a 404, which is what
//      a fabricated source looks like from the outside;
//   2. a question declaring `expect: no-citations` cites anything at all;
//   3. any request errors, times out, or returns a non-2xx status.
//
// Answer prose is never machine-judged. Scoring it needs either a second model in the
// loop or a brittle string match against a free-tier model's phrasing, and the report
// this writes is what the maintainer reads to make that call instead.
//
// An absent manifest exits 0 with "no evaluation set": an adopter who never writes one
// is not broken.
//
// Usage:
//   npm run chat:eval
//   npm run chat:eval -- --endpoint https://chat.example.workers.dev
//   npm run chat:eval -- --topics ./public/kb/topics.json --out reports/chat-eval.md
//
// This file lives under scripts/, which both genericity gates scan: its source is pure
// ASCII and carries no place-specific string.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  answerDelta,
  judge,
  knownRoutes,
  readEvalSet,
  EVAL_MANIFEST_PATH,
} from '../lib/chat-eval.mjs';

const DEFAULT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DEFAULT_OUT = 'reports/chat-eval.md';
const REQUEST_TIMEOUT_MS = 120000;

function fail(message) {
  console.error(`chat-eval: ${message}`);
  process.exit(1);
}

/* -- arguments ------------------------------------------------------------- */

const argv = process.argv.slice(2);
const options = { root: DEFAULT_ROOT, out: DEFAULT_OUT };
for (let i = 0; i < argv.length; i += 1) {
  const flag = argv[i];
  const value = argv[i + 1];
  if (['--endpoint', '--topics', '--origin', '--out', '--root'].includes(flag)) {
    if (!value) fail(`${flag} needs a value.`);
    options[flag.slice(2)] = value;
    i += 1;
  } else {
    fail(`unknown argument "${flag}".`);
  }
}
const root = resolve(options.root);

/* -- the evaluation set ----------------------------------------------------- */

const evalSet = readEvalSet(root);
if (!evalSet.present) {
  console.log(`OK: no evaluation set at ${EVAL_MANIFEST_PATH} -- nothing to evaluate.`);
  process.exit(0);
}
for (const warning of evalSet.warnings) console.warn(`chat-eval: ${warning}`);
if (evalSet.questions.length === 0) {
  fail(
    `${EVAL_MANIFEST_PATH} exists but yielded no usable question. A manifest that is ` +
      'present and unreadable is a defect, not an empty set.',
  );
}
console.log(`chat-eval: ${evalSet.questions.length} question(s) parsed from ${EVAL_MANIFEST_PATH}`);

/* -- place config, endpoint, origin ----------------------------------------- */

const configPath = join(root, 'place.config.ts');
let place = null;
if (existsSync(configPath)) {
  try {
    place = (await import(pathToFileURL(configPath).href)).default;
  } catch (error) {
    fail(
      `place.config.ts could not be imported (${error.message}).\n` +
        '  Run this through `npm run chat:eval`, which passes the type-stripping flag Node needs.',
    );
  }
}

const endpoint = (options.endpoint ?? place?.workers?.chat ?? '').trim();
if (!endpoint) {
  fail(
    'no chat endpoint. Set `workers.chat` in place.config.ts, or pass --endpoint <url>.\n' +
      '  The evaluation runs against a DEPLOYED worker; see docs/runbook/DEPLOY.md.',
  );
}

// The worker answers only its configured origin (exact-match CORS, 403 otherwise), so
// the request has to present the site's own origin rather than none.
const domain = (place?.place?.domain ?? '').trim();
const origin = (
  options.origin ?? (domain ? (/^https?:\/\//.test(domain) ? domain : `https://${domain}`) : '')
).trim();
if (!origin) {
  fail('no origin to present. Set `place.domain` in place.config.ts, or pass --origin <url>.');
}

/* -- the routes a citation may resolve to ----------------------------------- */

async function loadTopics() {
  const declared = options.topics;

  if (declared && !/^https?:\/\//.test(declared)) {
    return JSON.parse(readFileSync(resolve(root, declared), 'utf8'));
  }

  const url = declared ?? `${origin.replace(/\/+$/, '')}/kb/topics.json`;
  const local = join(root, 'public/kb/topics.json');
  // Prefer the local build output when it exists and no source was named: it is the
  // corpus the deployed worker's vectors were built from, so it cannot disagree with
  // them the way a site deployed at a different commit can.
  if (!declared && existsSync(local)) {
    return JSON.parse(readFileSync(local, 'utf8'));
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

let routes;
try {
  routes = knownRoutes(await loadTopics());
} catch (error) {
  fail(`could not load the published article index (${error.message}).`);
}
if (routes.size === 0) {
  fail('the published article index lists no article; every citation would fail as unresolvable.');
}
console.log(`chat-eval: ${routes.size} published article route(s) to resolve citations against`);

/* -- asking ----------------------------------------------------------------- */

/**
 * Posts one question and drains the SSE response into `{answer, citations}`.
 *
 * Citations come from the structural `event: citations` frame and nothing else -- the
 * same rule the page follows, for the same reason: prose is not a source list.
 */
async function ask(question) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ message: question, history: [] }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return { error: `${error.name}: ${error.message}` };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { error: `HTTP ${response.status}${detail ? ` ${detail.slice(0, 200)}` : ''}` };
  }

  const raw = await response.text();
  let answer = '';
  let citations = [];
  let sawCitations = false;

  for (const block of raw.split('\n\n')) {
    if (!block.trim()) continue;
    let isCitations = false;
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        if (line.slice(6).trim() === 'citations') isCitations = true;
      } else if (line.startsWith('data:')) {
        data += line.slice(5).trim();
      }
    }
    if (!data) continue;

    if (isCitations) {
      try {
        const payload = JSON.parse(data);
        citations = Array.isArray(payload?.citations) ? payload.citations : [];
        sawCitations = true;
      } catch {
        return { error: 'the citations frame was not valid JSON' };
      }
      continue;
    }

    try {
      answer += answerDelta(JSON.parse(data));
    } catch {
      /* a frame this runner does not model (keep-alive, usage-only) is skipped */
    }
  }

  // No citations frame at all is a broken contract, not an empty source list: the
  // difference decides whether a refusal question passes, so it cannot be guessed.
  if (!sawCitations) return { error: 'the response carried no citations frame' };

  return { answer: answer.trim(), citations };
}

/* -- run -------------------------------------------------------------------- */

const rows = [];
let failed = 0;

for (const question of evalSet.questions) {
  const result = await ask(question.question);
  const failures = judge(question, result, routes);
  if (failures.length > 0) failed += 1;
  rows.push({ question, result, failures });
  const mark = failures.length === 0 ? 'ok  ' : 'FAIL';
  console.log(`chat-eval: ${mark} ${question.index}/${evalSet.questions.length} ${question.question}`);
  for (const failure of failures) console.log(`chat-eval:        ${failure}`);
}

/* -- report ----------------------------------------------------------------- */

const generated = new Date().toISOString();
const lines = [
  '# Chat evaluation report',
  '',
  `- Generated: ${generated}`,
  `- Endpoint: ${endpoint}`,
  `- Questions: ${evalSet.questions.length}`,
  `- Machine verdict: ${failed === 0 ? 'pass' : `${failed} question(s) failed`}`,
  '',
  'The machine checks citation resolution, the no-citations refusal, and request',
  'health. It does not judge answer quality. Read every answer below and confirm it is',
  'grounded in the articles it cites, and that both refusal questions refused.',
  '',
];

for (const { question, result, failures } of rows) {
  lines.push(`## ${question.index}. ${question.question}`);
  lines.push('');
  lines.push(`- Verdict kind: \`${question.expect}\``);
  lines.push(
    `- Expected sources: ${
      question.expectSlugs.length ? question.expectSlugs.map((s) => `\`${s}\``).join(', ') : 'none (must refuse)'
    }`,
  );
  if (question.note) lines.push(`- Why this question: ${question.note}`);
  lines.push(`- Machine result: ${failures.length === 0 ? 'pass' : 'FAIL'}`);
  for (const failure of failures) lines.push(`  - ${failure}`);
  lines.push('');
  if (result.error) {
    lines.push(`> Request failed: ${result.error}`);
  } else {
    lines.push('**Answer**');
    lines.push('');
    lines.push(result.answer ? result.answer.replace(/^/gm, '> ') : '> (empty answer)');
    lines.push('');
    lines.push('**Cited**');
    lines.push('');
    if (!result.citations.length) {
      lines.push('- (nothing cited)');
    } else {
      const seen = new Set();
      for (const citation of result.citations) {
        const url = citation?.url ?? '(no url)';
        if (seen.has(url)) continue;
        seen.add(url);
        lines.push(`- [${citation?.title ?? url}](${url})`);
      }
    }
  }
  lines.push('');
}

const outPath = resolve(root, options.out);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`chat-eval: report written to ${options.out}`);

if (failed > 0) {
  fail(`${failed} of ${evalSet.questions.length} question(s) failed the machine verdict.`);
}
console.log(
  `OK: ${evalSet.questions.length}/${evalSet.questions.length} question(s) passed the machine verdict. ` +
    'Answer quality still needs the human review in the report.',
);
