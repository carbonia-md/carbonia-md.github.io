// chat-eval.mjs -- the evaluation set's reader and its verdicts.
//
// Split from the CLI (scripts/tools/chat-eval.mjs) so that the two things worth
// testing -- what a manifest parses into, and what makes a run fail -- are testable
// without a deployed worker, an endpoint, or a network.
//
// This file lives under scripts/, which both genericity gates scan: its source is
// pure ASCII and carries no place-specific string. Every place-bearing value comes
// from the manifest it reads.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import matter from 'gray-matter';

/** Repository-relative path of the evaluation set. The `_` prefix is load-bearing. */
export const EVAL_MANIFEST_PATH = 'knowledge/chat/_eval.md';

/**
 * The verdicts a question can declare, as data. `sources` is the default for an
 * answerable question; the two refusal kinds differ in whether the machine or a
 * person decides, which is a property of retrieval rather than a preference --
 * see the manifest's own header for the measurement behind it.
 */
export const EXPECT_KINDS = ['sources', 'no-citations', 'refusal-in-answer'];

/** Only this verdict makes an emitted citation a failure. */
export const MACHINE_REFUSAL = 'no-citations';

const isNonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Reads the evaluation set under `root`.
 *
 * Never throws. An absent manifest is a supported state and the caller's cue to exit
 * 0: an adopter who never writes one is not broken. A manifest that exists but is
 * malformed is NOT absent -- it returns `present: true` with warnings and whatever
 * questions survived, so a typo fails the run loudly rather than quietly evaluating
 * nothing and reporting success.
 *
 * `readFileSync` inside `try/catch`, never `await import()`
 * (.agent-toolkit/rules/optional-build-time-json-readfilesync.md).
 */
export function readEvalSet(root = process.cwd()) {
  let raw;
  try {
    raw = readFileSync(resolve(root, EVAL_MANIFEST_PATH), 'utf8');
  } catch {
    return { present: false, questions: [], notes: '', warnings: [] };
  }

  const warnings = [];

  let parsed;
  try {
    parsed = matter(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warnings.push(
      `${EVAL_MANIFEST_PATH}: frontmatter could not be parsed (${reason}); no questions read.`,
    );
    return { present: true, questions: [], notes: '', warnings };
  }

  const notes = String(parsed.content ?? '').trim();
  const data = parsed.data ?? {};
  const declared = data.questions;

  if (declared === undefined || declared === null) {
    warnings.push(`${EVAL_MANIFEST_PATH}: no \`questions\` list; no questions read.`);
    return { present: true, questions: [], notes, warnings };
  }
  if (!Array.isArray(declared)) {
    warnings.push(
      `${EVAL_MANIFEST_PATH}: \`questions\` must be a list, got ${typeof declared}; no questions read.`,
    );
    return { present: true, questions: [], notes, warnings };
  }

  const questions = [];
  declared.forEach((item, index) => {
    const at = `question ${index}`;

    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      warnings.push(`${EVAL_MANIFEST_PATH}: ${at} is not a mapping; skipped.`);
      return;
    }
    if (!isNonEmptyString(item.question)) {
      warnings.push(`${EVAL_MANIFEST_PATH}: ${at} is missing a non-empty \`question\`; skipped.`);
      return;
    }
    if (!Array.isArray(item.expectSlugs)) {
      warnings.push(
        `${EVAL_MANIFEST_PATH}: ${at} must declare \`expectSlugs\` as a list ` +
          '(use `[]` for a question that must be refused); skipped.',
      );
      return;
    }
    if (!EXPECT_KINDS.includes(item.expect)) {
      warnings.push(
        `${EVAL_MANIFEST_PATH}: ${at} declares \`expect: ${JSON.stringify(item.expect)}\`, ` +
          `which is not one of ${EXPECT_KINDS.join(', ')}; skipped.`,
      );
      return;
    }

    const expectSlugs = item.expectSlugs.filter(isNonEmptyString).map((slug) => slug.trim());
    if (expectSlugs.length !== item.expectSlugs.length) {
      warnings.push(
        `${EVAL_MANIFEST_PATH}: ${at} has an \`expectSlugs\` entry that is not a non-empty ` +
          'string; those entries are ignored.',
      );
    }
    // A refusal that names the articles it expects is a contradiction, and reading it
    // either way would be a guess about which half the author meant.
    if (item.expect !== 'sources' && expectSlugs.length > 0) {
      warnings.push(
        `${EVAL_MANIFEST_PATH}: ${at} declares \`expect: ${item.expect}\` but names ` +
          `${expectSlugs.length} expected slug(s); a refusal expects none. Skipped.`,
      );
      return;
    }
    if (item.expect === 'sources' && expectSlugs.length === 0) {
      warnings.push(
        `${EVAL_MANIFEST_PATH}: ${at} declares \`expect: sources\` but names no expected ` +
          'slug; use one of the refusal kinds instead. Skipped.',
      );
      return;
    }

    questions.push({
      index: questions.length + 1,
      question: item.question.trim(),
      expectSlugs,
      expect: item.expect,
      note: isNonEmptyString(item.note) ? item.note.trim() : null,
    });
  });

  return { present: true, questions, notes, warnings };
}

/**
 * The answer text carried by one upstream SSE frame, across the two shapes Workers AI
 * streams in: the documented `{response}` form, and the OpenAI-compatible
 * `{choices:[{delta:{content}}]}` form the current generation model emits. SPEC
 * deliberately does not pin a model, so both are read rather than breaking the day the
 * model changes.
 *
 * A reasoning model also streams `delta.reasoning` and `delta.reasoning_content` --
 * its private chain of thought, an order of magnitude longer than the answer. Never
 * read here: putting it in the report would hand the human review unreviewed
 * intermediate speculation to judge instead of the answer.
 *
 * The page's inline client implements the same rule; the two are separate because one
 * is a browser script inlined into an Astro template and the other is a Node module.
 */
export function answerDelta(frame) {
  if (!frame || typeof frame !== 'object') return '';
  if (typeof frame.response === 'string') return frame.response;
  const delta = frame.choices?.[0]?.delta;
  return typeof delta?.content === 'string' ? delta.content : '';
}

/** Route identity: one optional trailing slash, and no fragment or query. */
function routeKey(path) {
  const bare = String(path).split('#')[0].split('?')[0];
  return bare.length > 1 ? bare.replace(/\/+$/, '') : bare;
}

/**
 * The set of article routes a citation may resolve to, from a parsed
 * `/kb/topics.json`. That file is the build's own record of what it published, so a
 * citation absent from it is a link into a 404 no matter how plausible it reads.
 */
export function knownRoutes(topics) {
  const routes = new Set();
  if (!Array.isArray(topics)) return routes;
  for (const topic of topics) {
    if (topic && isNonEmptyString(topic.url)) routes.add(routeKey(topic.url));
  }
  return routes;
}

/**
 * Judges one answered question. Returns the failures it found, each a sentence
 * naming what is wrong; an empty array is a pass.
 *
 * Three failure classes, and deliberately no fourth: answer prose is never judged
 * here. Scoring it would need either a second model in the loop or a brittle string
 * match against a free-tier model's phrasing, and the review that reads this run's
 * report is the quality gate instead.
 */
export function judge(question, result, routes) {
  const failures = [];

  if (result.error) {
    failures.push(`request failed: ${result.error}`);
    return failures;
  }

  const citations = Array.isArray(result.citations) ? result.citations : [];

  for (const citation of citations) {
    const url = citation && citation.url;
    if (!isNonEmptyString(url)) {
      failures.push(`cited an entry with no URL: ${JSON.stringify(citation)}`);
      continue;
    }
    if (!routes.has(routeKey(url))) {
      failures.push(`cited "${url}", which is not an article this site publishes`);
    }
  }

  if (question.expect === MACHINE_REFUSAL && citations.length > 0) {
    failures.push(
      `must refuse with no citations, but cited ${citations.length}: ` +
        citations.map((c) => c && c.url).join(', '),
    );
  }

  return failures;
}
