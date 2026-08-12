#!/usr/bin/env node
/**
 * index.mjs — `npm run init`: the adoption wizard.
 *
 * Interactive:      npm run init
 * Non-interactive:  npm run init -- --answers <path-or-inline-json>
 *
 * Both modes resolve answers through the same prompt table (prompt-table.mjs)
 * into the same resolved config, and hand it to the same writer (writer.mjs) —
 * the single writer of place identity. The same answers therefore produce
 * byte-identical output in either mode; /sekai-adopt drives the --answers path.
 *
 * The answers-JSON schema is documented in scripts/init/README.md. Missing
 * keys take the same defaults an interactive user gets by pressing Enter.
 *
 * Re-run guard: on an established instance (no .sekai-template marker and
 * articles already under knowledge/) the wizard aborts unless --force is
 * given, because it reseeds knowledge/ with empty category folders.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

import {
  CATEGORY_PRESETS,
  KINDS,
  PROMPTS,
  validateCategoryEntry,
} from './prompt-table.mjs';
import { buildHomeDefaults } from './home-defaults.mjs';
import { writeInstance } from './writer.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/* ── tiny dot-path helpers ───────────────────────────────────────────────── */

function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function set(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
}

/* ── CLI args ────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const args = { answers: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--answers') {
      const raw = argv[++i];
      if (raw === undefined) fail('--answers needs a value (path or inline JSON)');
      try {
        args.answers = JSON.parse(
          raw.trimStart().startsWith('{') ? raw : readFileSync(raw, 'utf8'),
        );
      } catch (e) {
        fail(`cannot read answers JSON: ${e.message}`);
      }
    } else if (a === '--force') {
      args.force = true;
    } else {
      fail(`unknown argument "${a}" (known: --answers <json>, --force)`);
    }
  }
  return args;
}

function fail(msg) {
  console.error(`init: ${msg}`);
  process.exit(1);
}

/* ── line reader ─────────────────────────────────────────────────────────── */

/**
 * Buffering prompt reader. `rl.question` drops lines that arrive between
 * question() calls (piped/heredoc input delivers everything at once), so we
 * queue 'line' events ourselves: a queued line answers the next prompt, and
 * prompts past EOF are a hard error instead of a hang.
 */
function makeAsk(rl) {
  const lines = [];
  const waiters = [];
  let closed = false;
  rl.on('line', (l) => {
    const w = waiters.shift();
    if (w) w(l);
    else lines.push(l);
  });
  rl.on('close', () => {
    closed = true;
    while (waiters.length) waiters.shift()(null);
  });
  return async function ask(q) {
    stdout.write(q);
    let answer;
    if (lines.length > 0) answer = lines.shift();
    else if (closed) answer = null;
    else answer = await new Promise((r) => waiters.push(r));
    if (answer === null) {
      stdout.write('\n');
      fail('stdin ended before all prompts were answered');
    }
    // Piped input is not echoed by the terminal; echo it so transcripts read
    // as question/answer pairs.
    if (!stdin.isTTY) stdout.write(`${answer}\n`);
    return answer;
  };
}

/* ── answer resolution (shared table, two input paths) ───────────────────── */

function evalDefault(row, cfg) {
  return typeof row.default === 'function' ? row.default(cfg) : row.default;
}

/**
 * The /sekai-adopt contract: an unknown key in the answers JSON is a hard error,
 * never a silent default — a typo'd path must not half-initialize an
 * instance. A path is known when it is a row id or a proper prefix of one;
 * row-id values themselves (category arrays, [lat, lng] pairs) are opaque
 * and never descended into.
 */
function rejectUnknownKeys(answers) {
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers))
    fail('answers JSON must be an object');
  const ids = PROMPTS.map((r) => r.id);
  const exact = new Set(ids);
  const walk = (node, prefix) => {
    for (const key of Object.keys(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (exact.has(path)) continue;
      if (!ids.some((id) => id.startsWith(`${path}.`)))
        fail(`unknown key "${path}" in answers JSON`);
      const v = node[key];
      if (v === null || typeof v !== 'object' || Array.isArray(v))
        fail(`"${path}" must be an object`);
      walk(v, path);
    }
  };
  walk(answers, '');
}

function resolveFromJson(answers, cfg) {
  rejectUnknownKeys(answers);
  for (const row of PROMPTS) {
    const provided = get(answers, row.id);
    let value;
    if (provided === undefined) {
      if (row.required) fail(`answers JSON is missing required key "${row.id}"`);
      value = evalDefault(row, cfg);
    } else {
      try {
        value = KINDS[row.kind].coerce(provided);
      } catch (e) {
        fail(`"${row.id}": ${e.message}`);
      }
    }
    const err = row.validate?.(value, cfg);
    if (err) fail(`"${row.id}": ${err}`);
    set(cfg, row.id, value);
  }
}

async function promptCategories(ask, row, cfg) {
  const presets = Object.entries(CATEGORY_PRESETS);
  console.log('\nCategory set (5-14 categories; slugs become site routes):');
  presets.forEach(([key, cats], i) => {
    console.log(`  ${i + 1}) ${key} — ${cats.map((c) => c.title).join(', ')}`);
  });
  console.log(`  ${presets.length + 1}) custom — define your own`);
  for (;;) {
    const raw = (await ask(`Choose [1]: `)).trim();
    const n = raw === '' ? 1 : Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= presets.length) {
      return presets[n - 1][1];
    }
    if (n === presets.length + 1) {
      const cats = [];
      console.log(
        'Define 5-14 categories. Leave the slug blank to finish (after at least 5).',
      );
      for (;;) {
        const slug = (await ask(`  category ${cats.length + 1} slug: `)).trim();
        if (slug === '') {
          const err = row.validate(cats, cfg);
          if (!err) return cats;
          console.log(`  ${err}`);
          continue;
        }
        const title = (await ask('    title: ')).trim();
        const icon = (await ask('    icon (emoji): ')).trim();
        const description = (await ask('    description: ')).trim();
        // Entry-level validation mid-loop (the 5-14 count cannot hold yet);
        // the full-array validation runs on the blank-slug finish above.
        const entry = { slug, title, icon, description };
        const fieldErr = validateCategoryEntry(entry, new Set(cats.map((c) => c.slug)));
        if (fieldErr) {
          console.log(`  ${fieldErr}`);
          continue;
        }
        cats.push(entry);
        if (cats.length === 14) return cats;
      }
    }
    console.log(`  enter a number 1-${presets.length + 1}`);
  }
}

async function resolveInteractive(ask, cfg) {
  for (const row of PROMPTS) {
    if (row.kind === 'categories') {
      set(cfg, row.id, await promptCategories(ask, row, cfg));
      continue;
    }
    const def = evalDefault(row, cfg);
    const defLabel =
      def === undefined || def === ''
        ? ''
        : ` [${row.kind === 'boolean' ? (def ? 'Y/n' : 'y/N') : JSON.stringify(def)}]`;
    for (;;) {
      const raw = await ask(`${row.question}${defLabel}: `);
      let value;
      if (raw.trim() === '') {
        if (row.required) {
          console.log('  a value is required');
          continue;
        }
        value = def;
      } else {
        try {
          value = KINDS[row.kind].parseText(raw);
        } catch (e) {
          console.log(`  ${e.message}`);
          continue;
        }
      }
      const err = row.validate?.(value, cfg);
      if (err) {
        console.log(`  ${err}`);
        continue;
      }
      set(cfg, row.id, value);
      break;
    }
  }
}

/* ── derived (non-prompted) config ───────────────────────────────────────── */

function deriveConfig(cfg) {
  cfg.place.languages = [cfg.place.locale];
  const social = cfg.links.social;
  for (const k of Object.keys(social)) {
    if (social[k] === '') social[k] = undefined;
  }
  cfg.seo = {
    defaultOgImage: '/og-default.png',
    ...(social.twitter ? { twitterHandle: social.twitter } : {}),
  };
  cfg.home = buildHomeDefaults(cfg);
  // Key order in the emitted file follows insertion order; rebuild `place`
  // so `languages` sits with its siblings, matching the shipped schema shape.
  cfg.place = {
    name: cfg.place.name,
    tagline: cfg.place.tagline,
    domain: cfg.place.domain,
    locale: cfg.place.locale,
    languages: cfg.place.languages,
  };
  // Emit cfg itself — every resolved answer flows through, so a future table
  // row that opens a NEW top-level section (e.g. analytics IDs, task 10.1) is
  // emitted without touching this function. A key whitelist here would drop
  // such a section silently. Top-level order: table order (place, categories,
  // map, features, links, + future sections), then derived seo and home.
  return cfg;
}

/* ── re-run guard ────────────────────────────────────────────────────────── */

function hasArticles(dir) {
  if (!existsSync(dir)) return false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (hasArticles(join(dir, entry.name))) return true;
    } else if (entry.name.endsWith('.md') && entry.name !== 'INBOX.md') {
      return true;
    }
  }
  return false;
}

/* ── main ────────────────────────────────────────────────────────────────── */

const args = parseArgs(process.argv.slice(2));

const isTemplate = existsSync(join(ROOT, '.sekai-template'));
if (!isTemplate && hasArticles(join(ROOT, 'knowledge')) && !args.force) {
  fail(
    'this looks like an established instance (knowledge/ has articles and no ' +
      '.sekai-template marker). Re-running init reseeds knowledge/ with empty ' +
      'category folders. Pass --force to proceed anyway.',
  );
}

const cfg = {};
if (args.answers) {
  resolveFromJson(args.answers, cfg);
} else {
  console.log('sekai-kb init — answers write place.config.ts and seed the instance.');
  console.log('Press Enter to accept a [default].\n');
  const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
  try {
    await resolveInteractive(makeAsk(rl), cfg);
  } finally {
    rl.close();
  }
}

const resolved = deriveConfig(cfg);
const actions = writeInstance(ROOT, resolved);

console.log('\ninit complete:');
for (const a of actions) console.log(`  ${a}`);
console.log(
  '\nNext: npm run build (full pipeline + contract checks), then commit.\n' +
    'Home-page copy shipped as generic defaults — edit home.* in place.config.ts,\n' +
    'or let /sekai-adopt draft place-specific copy behind human approval.',
);
