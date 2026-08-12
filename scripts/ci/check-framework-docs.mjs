#!/usr/bin/env node
// check-framework-docs.mjs -- the framework maintainer-doc gate (ADR 008).
//
// The framework's own PRD, SPEC, ROADMAP, and ADRs live in this repository and are
// removed by `npm run init`, because they describe how sekai-kb is built, never how
// an instance is operated. Three claims that arrangement rests on can drift silently,
// and each one is DERIVED here from the source it describes rather than restated:
//
//   1. STRIP CONTRACT -- the set of paths adoption removes comes from
//      `scripts/init/writer.mjs`'s exported MAINTAINER_DOCS, parsed by the function this
//      file imports from `scripts/upgrade/maintainer-docs-state.mjs`, so the gate and the
//      upgrade that preserves the strip cannot read the wizard differently. In template mode every
//      listed path must exist (a rename that made the strip a no-op is a failure, not
//      a pass), both adopter doc trees must survive, and NO file that an adopter keeps
//      may carry a link into a removed path. A dangling reference in an adopted clone
//      is worse than none: the reader cannot tell a deleted document from one that
//      never existed.
//   2. MERGE=OURS LIST -- the instance-owned file list comes from `.gitattributes`.
//      SPEC §Repo topology and ADR 006's consequences both enumerate it in prose; that
//      list has drifted from reality before (ADR 006 exists partly to correct it). The
//      two ADOPTER-FACING restatements are registered too -- `docs/runbook/UPGRADE.md`'s
//      instance-owned table and the `/sekai-upgrade` skill's step 4 -- because those are
//      the copies an adopter actually reads, and they survive adoption. Both are checked
//      for containment rather than equality in an adopted clone, since an adopter's
//      `.gitattributes` legitimately grows paths the framework's documents do not list.
//   3. BUILD PIPELINE -- the prebuild and post-build job names come from
//      `package.json`. SPEC §Build pipeline enumerates both.
//   4. PLACE CONFIG SCHEMA -- the top-level sections of `PlaceConfig`, and the flags
//      inside its `features` block, come from `place.config.ts`. SPEC ``place.config.ts``
//      enumerates both, and that enumeration is what an adopter reads to learn which
//      keys exist. The wizard holds no second copy of that interface to derive from:
//      `scripts/init/writer.mjs` re-emits the committed declaration, and
//      `scripts/ci/check-place-config-interface.mjs` is the gate that keeps it that
//      way and holds the prompt table to the same keys. (This comment used to claim
//      the wizard's copy needed no gate because `npm run init:check` would fail on a
//      drifted interface as a type error. It would not: nothing in this repository
//      typechecks -- `npm run build` strips types through esbuild -- and under that
//      reasoning the copy lost five keys unnoticed.)
//   5. PAGES -- the route list comes from `src/pages/`, where Astro's file-based routing
//      already makes every file a route. SPEC ``Pages`` enumerates it, and that
//      enumeration goes stale the moment a phase adds a page -- exactly when nobody is
//      looking at the sentence. Non-route build outputs (`llms.txt`, `/kb/*`) sit outside
//      the anchor because no file under `src/pages/` produces them.
//
// Registered statements live in documents that adoption REMOVES, so they are required
// in template mode and reported as skipped in an adopted instance -- the same rule
// `check-scan-root-docs.mjs` applies to instance-owned prose.
//
// Failure modes, all exit 1:
//   - MAINTAINER_DOCS cannot be parsed out of the wizard (the derivation, and so this
//     whole guard, would otherwise silently weaken);
//   - a path the wizard strips does not exist in the template checkout;
//   - an adopter doc tree is missing;
//   - a file that survives adoption links into a stripped path;
//   - a registered enumeration disagrees with the source it describes;
//   - a registered anchor is NOT FOUND -- someone reworded, moved, or deleted the
//     statement. An unfindable statement is exactly how a stale one hides.
//
// Success prints one summary line and exits 0.
//
// Usage: node scripts/ci/check-framework-docs.mjs [--root <dir>]
//        node scripts/ci/check-framework-docs.mjs --selftest
//
// This file lives under scripts/, which both genericity gates scan: its source is
// pure ASCII and carries no denylisted place term.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// The strip-list parser lives with the upgrade helper, which must run standalone
// when extracted from a release tag and therefore cannot import it from here. One
// parser over one source: this gate and the upgrade cannot read the wizard
// differently (ADR 008 addendum (b)).
import { deriveMaintainerDocs } from '../upgrade/maintainer-docs-state.mjs';

const WIZARD = 'scripts/init/writer.mjs';
const GITATTRIBUTES = '.gitattributes';
const PACKAGE_JSON = 'package.json';
const PLACE_CONFIG = 'place.config.ts';
const PAGES_DIR = 'src/pages';

// Adopter-facing doc trees. Not derived: this is the contract's other half -- the
// wizard removes what it lists, and these two are what must survive that removal.
// They are how an adopter writes articles and operates the site.
const ADOPTER_DOC_TREES = ['docs/playbook', 'docs/runbook'];

// Paths adoption removes beyond the maintainer docs. Anything under them is out of
// the dangling-reference scan for the same reason the maintainer docs are: an adopter
// never sees the file, so it cannot dangle for them.
const OTHER_REMOVED_AT_ADOPTION = ['.agent-toolkit', '.sekai-template'];

// Files the wizard REGENERATES wholesale (writer.mjs: renderAgentsMd, CLAUDE_MD_SHIM,
// renderReadme, renderChangelog). Whatever the framework's copy says, the adopter's
// copy is freshly rendered text that carries none of it.
const REGENERATED_AT_ADOPTION = ['AGENTS.md', 'CLAUDE.md', 'README.md', 'CHANGELOG.md'];

// Files that must name the stripped paths in order to strip, assert, or gate them.
// A path in a removal list or a guard registry is data, not a link a reader follows,
// and each of these already handles the adopted case: the wizard removes only what is
// present, and both guards report a registered statement in a removed document as
// skipped rather than missing. Keep this list to strip mechanisms only — exempting an
// ordinary document here would hollow the scan out.
const STRIP_MECHANISM_FILES = [
  WIZARD,
  'scripts/init/check-init.sh',
  'scripts/ci/check-framework-docs.mjs',
  'scripts/ci/check-scan-root-docs.mjs',
  'scripts/ci/check-soundscape-schema-docs.mjs',
  'scripts/ci/check-chat-context-schema-docs.mjs',
  'scripts/ci/check-roadmap-exit-gates.mjs',
  'scripts/ci/check-version-contract.mjs',
];

// The ownership source. `.gitattributes` must name a maintainer-doc path in order to
// PROTECT an instance's own document there (ADR 008), and a path in an attribute line
// is data git reads, never a link a reader follows. It is exempt for the same reason
// the strip mechanisms are, and for no broader one: this list stays at the single file
// the merge=ours enumeration is derived FROM.
const OWNERSHIP_DECLARATION_FILES = ['.gitattributes'];

const PRUNED_DIRS = new Set(['node_modules', '.git', 'dist', '.astro', '.venv', '__pycache__']);
const PRUNED_PATHS = ['src/content', 'src/data', 'public/kb'];

/* -- Derivations: every expectation comes from the source, never from here -- */

// .gitattributes declares instance ownership one path per line: `<path> merge=ours`.
function deriveMergeOursPaths(src) {
  const paths = [];
  for (const line of src.split('\n')) {
    const m = /^(\S+)\s+merge=ours\s*$/.exec(line);
    if (m) paths.push(m[1]);
  }
  return paths;
}

// package.json composes the two pipeline halves as npm script chains:
//   "prebuild": "... && run-p prebuild:a prebuild:b ... && ..."
//   "postbuild": "run-s postbuild:a postbuild:b ..."
function derivePipelineJobs(pkgJson, script, runner, prefix) {
  const command = pkgJson.scripts?.[script];
  if (typeof command !== 'string') return null;
  const m = new RegExp(`${runner}\\s+((?:${prefix}:[\\w-]+\\s*)+)`).exec(command);
  if (!m) return null;
  return m[1]
    .trim()
    .split(/\s+/)
    .map((job) => job.slice(prefix.length + 1))
    .filter(Boolean);
}

// Astro file-based routing: a file under src/pages/ IS a route, named by its path
// with the implementation extension removed. `feed.xml.ts` therefore yields
// `feed.xml` and `[category]/[slug].astro` yields `[category]/[slug]`, which is how
// SPEC writes them. Returns null when the directory is unreadable -- an underivable
// source must fail the gate, never silently weaken it.
//
// The three rules below mirror `createFileBasedRoutes` in the installed Astro
// (node_modules/astro/dist/core/routing/create-manifest.js): page extensions
// (`.astro`, `.html`, and every SUPPORTED_MARKDOWN_FILE_EXTENSIONS form, plus
// `.mdx` once the MDX integration registers it), endpoint extensions (`.js`,
// `.ts`), and the exclusions -- any path part whose name starts with `_`, and any
// dot-file. `.mjs` is deliberately absent: Astro's endpoint set is `.js`/`.ts`
// only. Astro exports none of these constants publicly (`astro`'s package exports
// expose no routing internals), so this is a cited mirror rather than a
// derivation; the two selftest cases below pin it in both directions.
const PAGE_EXT = /\.(astro|html|md|markdown|mdown|mkdn|mkd|mdwn|mdx|js|ts)$/;

/** Astro skips a path with an `_`-prefixed part, and any dot-file except `.well-known`. */
function isRoutablePart(name, isDirectory) {
  const base = isDirectory ? name : name.replace(/\.[^.]*$/, '');
  if (base.startsWith('_')) return false;
  return !name.startsWith('.') || name === '.well-known';
}

function derivePageRoutes(root) {
  const dir = join(root, PAGES_DIR);
  if (!existsSync(dir)) return null;
  const routes = [];
  const visit = (abs) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!isRoutablePart(entry.name, entry.isDirectory())) continue;
      const child = join(abs, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && PAGE_EXT.test(entry.name)) {
        routes.push(relative(dir, child).split(sep).join('/').replace(PAGE_EXT, ''));
      }
    }
  };
  try {
    visit(dir);
  } catch {
    return null;
  }
  return routes.length > 0 ? routes : null;
}

/* place.config.ts declares the schema as a TypeScript interface. These three read it
   structurally rather than by regex over the whole file: a member name is only a
   member when it sits at depth 0 of the block being read, so nested field names
   (`links.social.twitter`, every `home` sub-block) never leak into a top-level list. */

function stripTsComments(src) {
  // Newlines are preserved so nothing downstream shifts; no string literal in a
  // TypeScript interface can contain a comment marker, and only the interface body
  // is ever passed through here.
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
}

/** Inner text of `export interface <name> { ... }`, or null when it is not declared. */
function interfaceBody(src, name) {
  const decl = new RegExp(`export\\s+interface\\s+${name}\\s*\\{`).exec(src);
  if (!decl) return null;
  return braceBody(src, decl.index + decl[0].length - 1);
}

/** Inner text of the block whose opening `{` is at `open`, or null when unbalanced. */
function braceBody(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * Member names declared at depth 0 of an interface body, in declaration order.
 * `{`, `[`, and `(` all open a nested span; `Array<{...}>` therefore hides its
 * element fields behind the inner brace exactly like an inline object does.
 */
function memberNames(body) {
  const names = [];
  let depth = 0;
  let token = '';
  for (const ch of body) {
    if (ch === '{' || ch === '[' || ch === '(') {
      depth += 1;
      token = '';
    } else if (ch === '}' || ch === ']' || ch === ')') {
      depth -= 1;
      token = '';
    } else if (depth !== 0) {
      continue;
    } else if (/[A-Za-z0-9_$]/.test(ch)) {
      token += ch;
    } else if (ch === '?') {
      // The optional marker sits between the name and its colon; keep the token.
    } else if (ch === ':' && token) {
      names.push(token);
      token = '';
    } else {
      token = '';
    }
  }
  return names;
}

/** Inner text of one depth-0 member's own `{ ... }` block, or null. */
function memberBlock(body, name) {
  const decl = new RegExp(`(^|[;{\\n])\\s*${name}\\??\\s*:\\s*\\{`).exec(body);
  if (!decl) return null;
  return braceBody(body, decl.index + decl[0].length - 1);
}

/**
 * `{ sections, features }` from place.config.ts, or null when the interface is
 * unreadable -- an underivable source must fail the gate, never silently weaken it.
 */
function derivePlaceConfigSchema(src) {
  const body = interfaceBody(stripTsComments(src), 'PlaceConfig');
  if (body === null) return null;
  const sections = memberNames(body);
  if (sections.length === 0) return null;
  const featuresBlock = memberBlock(body, 'features');
  return { sections, features: featuresBlock === null ? null : memberNames(featuresBlock) };
}

const asSet = (items) => [...new Set(items)].sort().join(', ');

/**
 * A captured enumeration may span lines and carry markdown backticks, list
 * indentation, and comment markers. Strip those, then split on commas.
 */
function parseList(span) {
  return span
    .split('\n')
    .map((line) => line.replace(/^\s*(?:#|\/\/|\*|-)\s?/, ''))
    .join(' ')
    .split(',')
    .map((token) => token.trim().replace(/^(?:and|or)\s+/i, ''))
    .map((token) => token.replace(/[`'"\\]/g, '').trim())
    .map((token) => token.replace(/\/+$/, ''))
    .filter(Boolean);
}

/** A markdown table's first column: one path per row, backticks and padding stripped. */
function parseTableFirstColumn(span) {
  return span
    .split('\n')
    .map((row) => row.split('|')[1] ?? '')
    .map((cell) => cell.replace(/[`'"\\]/g, '').trim())
    .map((cell) => cell.replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * The schema sentence writes one backticked group per top-level section, each
 * carrying its own fields: `place {name, ...}`, `categories[] {slug, ...}`. Only the
 * leading identifier of each group is the section name, so the fields inside a group
 * -- including a nested one like `social {twitter?, ...}` -- are never mistaken for
 * sections of their own.
 */
function parseSchemaSections(span) {
  return [...span.matchAll(/`([A-Za-z_$][A-Za-z0-9_$]*)[^`]*`/g)].map((m) => m[1]);
}

/* -- The registry: which prose statement restates which derived list -- */
//
// Each anchor has exactly one capture group holding ONLY the enumeration. Anchors
// carry prose, never list members, so they stay valid when the source changes and
// fail loudly when the prose is reworded.
//
// `parse` defaults to the comma-separated `parseList`; a markdown table uses
// `parseTableFirstColumn`.
//
// `instanceSubset` marks a site that SURVIVES adoption, so it is checked in an
// adopter's clone too. There the framework's document is fixed while `.gitattributes`
// is append-only per adopter ("Adopters add their own instance-specific files the same
// way"), so exact equality would fail every adopter that ever added a path. Those sites
// require containment in instance mode -- every documented row must really be declared --
// and full equality in template mode, where the two lists are the framework's own and
// must match exactly.

/** Which file each `source` is derived from, named in a mismatch report. */
const SOURCE_FILES = {
  'merge-ours': GITATTRIBUTES,
  prebuild: PACKAGE_JSON,
  postbuild: PACKAGE_JSON,
  'place-config-sections': PLACE_CONFIG,
  'place-config-features': PLACE_CONFIG,
  pages: `${PAGES_DIR}/`,
};

const REGISTRY = [
  {
    file: 'dev_docs/SPEC.md',
    label: 'Repo topology, instance-owned merge=ours list',
    source: 'merge-ours',
    anchor: /`merge=ours`\s+on\s+instance-owned\s*\n?\s*files\s+\(([^)]+)\)/,
  },
  {
    file: 'dev_docs/adr/006-adopter-owned-agents-md-and-dev-plugin-encapsulation.md',
    label: 'Consequences, instance-owned merge=ours list',
    source: 'merge-ours',
    anchor: /The\s+`merge=ours`\s+list\s+is\s+now:\s*([\s\S]*?)\.\n/,
  },
  {
    file: 'docs/runbook/UPGRADE.md',
    label: 'Instance-owned files table',
    source: 'merge-ours',
    anchor: /\|\s*Path\s*\|\s*Why instance-owned\s*\|\n\|[\s|:-]+\|\n((?:\|.*\n)+)/,
    parse: parseTableFirstColumn,
    instanceSubset: true,
  },
  {
    file: '.agents/skills/sekai-upgrade/SKILL.md',
    label: 'Step 4, instance-owned file list',
    source: 'merge-ours',
    anchor: /instance-owned\s+file\s+\(([^)]+)\)/,
    instanceSubset: true,
  },
  {
    file: 'dev_docs/SPEC.md',
    label: 'Build pipeline, parallel prebuild jobs',
    source: 'prebuild',
    anchor: /parallel\s+prebuild\s+\(`run-p`:\s*([^)]+)\)/,
  },
  {
    file: 'dev_docs/SPEC.md',
    label: 'Build pipeline, post-build contract checks',
    source: 'postbuild',
    anchor: /contract\s+checks\s+\(`run-s`:\s*([^)]+)\)/,
  },
  {
    file: 'dev_docs/SPEC.md',
    label: 'place.config.ts schema, top-level sections',
    source: 'place-config-sections',
    anchor: /Schema:\s*([\s\S]*?)\.\s*\n?Init-time:/,
    parse: parseSchemaSections,
  },
  {
    file: 'dev_docs/SPEC.md',
    label: 'place.config.ts schema, features flags',
    source: 'place-config-features',
    anchor: /`features\s*\{([^}]+)\}`/,
  },
  {
    file: 'dev_docs/SPEC.md',
    label: 'Pages, routes under src/pages/',
    source: 'pages',
    anchor: /Routes\s+under\s+`src\/pages\/`:\s*([\s\S]*?)\.\s*\n?Non-route\s+build\s+outputs:/,
  },
];

/* -- Tree walk -- */

function* walk(root, dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const abs = join(dir, entry.name);
    const rel = relative(root, abs).split(sep).join('/');
    if (entry.isDirectory()) {
      if (PRUNED_DIRS.has(entry.name)) continue;
      if (PRUNED_PATHS.includes(rel)) continue;
      yield* walk(root, abs);
    } else if (entry.isFile()) {
      yield rel;
    }
  }
}

const isUnder = (rel, prefix) => rel === prefix || rel.startsWith(`${prefix}/`);

/**
 * Blank out a span, keeping newlines so every later line number is unchanged.
 */
function maskSpan(text, start, end) {
  const blanked = text.slice(start, end).replace(/[^\n]/g, ' ');
  return text.slice(0, start) + blanked + text.slice(end);
}

/**
 * Where each registered enumeration sits in its file. The dangling-reference scan
 * masks those spans: a registered list is derived data, checked against its source
 * a few lines below, not a link a reader would follow. Without this a document that
 * an adopter keeps could not record that `dev_docs/PRD.md` is a path they may own --
 * the very statement ADR 008 requires it to make.
 */
function registeredSpans(root) {
  const spans = new Map();
  for (const site of REGISTRY) {
    const abs = join(root, site.file);
    if (!existsSync(abs)) continue;
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const match = site.anchor.exec(text);
    if (!match) continue;
    const list = spans.get(site.file) ?? [];
    list.push([match.index, match.index + match[0].length]);
    spans.set(site.file, list);
  }
  return spans;
}

/* -- The three checks -- */

function run(root) {
  const failures = [];
  const skipped = [];
  const read = (rel) => readFileSync(join(root, rel), 'utf8');
  const templateMode = existsSync(join(root, '.sekai-template'));

  /* 1. Strip contract. */

  let wizardSource;
  try {
    wizardSource = read(WIZARD);
  } catch (err) {
    return { failures: [`${WIZARD}: cannot be read (${err.message}); the strip list cannot be derived.`], skipped, checked: 0 };
  }
  const maintainerDocs = deriveMaintainerDocs(wizardSource);
  if (!maintainerDocs) {
    return {
      failures: [
        `${WIZARD}: no MAINTAINER_DOCS array literal found -- this guard cannot derive ` +
          'what adoption removes. Re-point the derivation in the same commit that moves it.',
      ],
      skipped,
      checked: 0,
    };
  }

  if (templateMode) {
    for (const rel of maintainerDocs) {
      if (!existsSync(join(root, rel))) {
        failures.push(
          `${rel}: listed in ${WIZARD}'s MAINTAINER_DOCS but absent from this template ` +
            'checkout. The wizard would strip nothing -- the doc was renamed or deleted ' +
            'without updating the list.',
        );
      }
    }
    for (const rel of ADOPTER_DOC_TREES) {
      const abs = join(root, rel);
      if (!existsSync(abs) || !statSync(abs).isDirectory()) {
        failures.push(`${rel}/: adopter doc tree is missing; adoption must keep it (ADR 008).`);
      }
      if (maintainerDocs.some((doc) => isUnder(rel, doc) || isUnder(doc, rel))) {
        failures.push(`${rel}/: adopter doc tree overlaps a stripped path in ${WIZARD}'s MAINTAINER_DOCS.`);
      }
    }
  } else {
    skipped.push('strip-list presence (adopted instance: the wizard already ran)');
  }

  const removed = [...maintainerDocs, ...OTHER_REMOVED_AT_ADOPTION];
  const exempt = new Set([
    ...REGENERATED_AT_ADOPTION,
    ...STRIP_MECHANISM_FILES,
    ...OWNERSHIP_DECLARATION_FILES,
  ]);
  const masked = registeredSpans(root);
  let scannedFiles = 0;
  let danglingChecked = 0;

  // A maintainer-doc path an INSTANCE owns is not a dangling target, and its
  // document is not the framework's to police. Instance #1 is that case: it keeps
  // its own PRD, SPEC, ROADMAP, and ADRs at these paths and marks them
  // `merge=ours`. Presence is the same signal the maintainer-doc reconcile uses to
  // classify a path `owned` (ADR 008 addendum), so the gate and the upgrade agree
  // by construction rather than by a second list.
  //
  // In template mode nothing is owned: every listed path is the framework's own
  // document, due to be stripped, so the scan stays exhaustive there.
  const instanceOwned = templateMode ? [] : maintainerDocs.filter((doc) => existsSync(join(root, doc)));
  const danglingTargets = maintainerDocs.filter((doc) => !instanceOwned.includes(doc));
  for (const doc of instanceOwned) {
    skipped.push(`${doc} (instance-owned: present here, so a reference to it resolves)`);
  }

  for (const rel of walk(root, root)) {
    if (removed.some((prefix) => isUnder(rel, prefix))) continue;
    if (exempt.has(rel)) continue;
    let text;
    try {
      text = read(rel);
    } catch {
      continue; // unreadable (permissions, races): not this guard's concern
    }
    if (text.includes('\u0000')) continue; // binary
    // Registered enumerations are derived data, not prose links (see registeredSpans).
    // Masking preserves line numbers, so a real reference outside the span still
    // reports the line it is on.
    for (const [start, end] of masked.get(rel) ?? []) text = maskSpan(text, start, end);
    scannedFiles += 1;
    for (const doc of danglingTargets) {
      let index = text.indexOf(doc);
      while (index !== -1) {
        const line = text.slice(0, index).split('\n').length;
        failures.push(
          `${rel}:${line}: links into "${doc}", which adoption removes. An adopter ` +
            'would follow a reference to a file they do not have. Re-point it at the ' +
            'upstream repository, or drop the reference (ADR 008).',
        );
        index = text.indexOf(doc, index + doc.length);
      }
      danglingChecked += 1;
    }
  }

  if (scannedFiles === 0) {
    failures.push(
      'the dangling-reference scan visited zero files, so it proved nothing. Check the ' +
        'prune list and the exemptions.',
    );
  }

  /* 2 + 3. Registered enumerations against their derived sources. */

  const expected = {};
  const expectedPaths = {};
  try {
    expectedPaths['merge-ours'] = deriveMergeOursPaths(read(GITATTRIBUTES));
    expected['merge-ours'] = asSet(expectedPaths['merge-ours']);
  } catch (err) {
    failures.push(`${GITATTRIBUTES}: cannot be read (${err.message}).`);
  }
  if (expected['merge-ours'] === '') {
    failures.push(`${GITATTRIBUTES}: no \`<path> merge=ours\` lines found -- the instance-owned list cannot be derived.`);
  }
  try {
    const pkg = JSON.parse(read(PACKAGE_JSON));
    const pre = derivePipelineJobs(pkg, 'prebuild', 'run-p', 'prebuild');
    const post = derivePipelineJobs(pkg, 'postbuild', 'run-s', 'postbuild');
    if (!pre) failures.push(`${PACKAGE_JSON}: no \`run-p prebuild:*\` chain found in the prebuild script.`);
    if (!post) failures.push(`${PACKAGE_JSON}: no \`run-s postbuild:*\` chain found in the postbuild script.`);
    if (pre) expected.prebuild = asSet(pre);
    if (post) expected.postbuild = asSet(post);
  } catch (err) {
    failures.push(`${PACKAGE_JSON}: cannot be read or parsed (${err.message}).`);
  }
  try {
    const schema = derivePlaceConfigSchema(read(PLACE_CONFIG));
    if (!schema) {
      failures.push(
        `${PLACE_CONFIG}: no readable \`export interface PlaceConfig\` -- the config ` +
          'schema cannot be derived. Re-point this guard in the same commit that moves it.',
      );
    } else {
      expected['place-config-sections'] = asSet(schema.sections);
      if (!schema.features) {
        failures.push(`${PLACE_CONFIG}: PlaceConfig declares no \`features\` block.`);
      } else {
        expected['place-config-features'] = asSet(schema.features);
      }
    }
  } catch (err) {
    failures.push(`${PLACE_CONFIG}: cannot be read (${err.message}).`);
  }
  const pageRoutes = derivePageRoutes(root);
  if (!pageRoutes) {
    failures.push(
      `${PAGES_DIR}/: no readable Astro page files -- the route list cannot be derived. ` +
        'Re-point this guard in the same commit that moves the pages directory.',
    );
  } else {
    expected.pages = asSet(pageRoutes);
  }

  let checked = 0;
  for (const site of REGISTRY) {
    if (expected[site.source] === undefined) continue; // derivation already failed above
    const abs = join(root, site.file);
    const registeredInRemovedDoc = removed.some((prefix) => isUnder(site.file, prefix));

    // A registered statement lives in a document adoption removes. In an adopted
    // instance that document is either absent (wizard-adopted) or the instance's
    // OWN document at the same path (instance #1). Both are outside this gate's
    // reach: the framework's registry describes the framework's prose, and an
    // instance's SPEC is not a copy of it that could go stale. Checking anchors
    // against an instance-authored document reports drift that does not exist.
    if (registeredInRemovedDoc && !templateMode) {
      skipped.push(`${site.file} (${existsSync(abs) ? 'instance-owned' : 'removed at adoption'}: ${site.label})`);
      continue;
    }

    if (!existsSync(abs)) {
      failures.push(
        `${site.file}: registered file is missing (${site.label}). A registered ` +
          'statement that cannot be checked is a failure, not a pass.',
      );
      continue;
    }

    const text = readFileSync(abs, 'utf8');
    const match = site.anchor.exec(text);
    if (!match) {
      failures.push(
        `${site.file}: anchor NOT FOUND for "${site.label}". The statement was reworded, ` +
          "moved, or deleted -- re-point this guard's registry entry in the same commit.",
      );
      continue;
    }

    const foundPaths = (site.parse ?? parseList)(match[1]);
    const found = asSet(foundPaths);
    const derivedFrom = SOURCE_FILES[site.source];
    const line = text.slice(0, match.index).split('\n').length;

    // A surviving site in an adopted clone: every documented path must be declared,
    // but the adopter's own additions need not be documented (see `instanceSubset`).
    if (site.instanceSubset && !templateMode) {
      const declared = new Set(expectedPaths[site.source] ?? []);
      const undeclared = [...new Set(foundPaths)].filter((path) => !declared.has(path)).sort();
      if (undeclared.length > 0) {
        failures.push(
          `${site.file}:${line}: ${site.label} (derived from ${derivedFrom})\n` +
            `      documented but not declared: ${undeclared.join(', ')}\n` +
            `      declared: ${expected[site.source]}`,
        );
        continue;
      }
      checked += 1;
      continue;
    }

    if (found !== expected[site.source]) {
      failures.push(
        `${site.file}:${line}: ${site.label} (derived from ${derivedFrom})\n` +
          `      found:    ${found || '(none)'}\n` +
          `      expected: ${expected[site.source]}`,
      );
      continue;
    }
    checked += 1;
  }

  return { failures, skipped, checked, scannedFiles, danglingChecked, maintainerDocs, templateMode };
}

/* -- Self-test: the detectors must be able to fail -- */
//
// A guard over four absent paths and three enumerations passes just as happily when
// its scan is empty or its comparison unreachable. This builds a synthetic tree,
// plants each defect class, and requires a failure naming it.

function selftest() {
  const fixture = mkdtempSync(join(tmpdir(), 'framework-docs-selftest-'));
  const write = (rel, content) => {
    mkdirSync(join(fixture, rel, '..'), { recursive: true });
    writeFileSync(join(fixture, rel), content);
  };
  const build = () => {
    rmSync(fixture, { recursive: true, force: true });
    mkdirSync(fixture, { recursive: true });
    write('.sekai-template', 'marker\n');
    write(WIZARD, "export const MAINTAINER_DOCS = ['dev_docs/PRD.md', 'dev_docs/adr'];\n");
    write('dev_docs/PRD.md', 'framework product doc\n');
    write('dev_docs/adr/001-x.md', 'a decision\n');
    write('docs/playbook/ARTICLE-PLAYBOOK.md', 'editorial canon\n');
    write('docs/runbook/DEPLOY.md', 'operations\n');
    write(GITATTRIBUTES, 'CLAUDE.md merge=ours\nknowledge/** merge=ours\n');
    write(
      PACKAGE_JSON,
      `${JSON.stringify(
        { scripts: { prebuild: 'run-p prebuild:search prebuild:related', postbuild: 'run-s postbuild:smoke' } },
        null,
        2,
      )}\n`,
    );
    write(
      PLACE_CONFIG,
      'export interface PlaceConfig {\n' +
        '  /** {not, a, member} */\n' +
        '  place: {\n    name: string;\n    domain: string;\n  };\n' +
        '  features: {\n    graph: boolean;\n    feedback: boolean;\n  };\n' +
        '  links: { repo: string; social: { twitter?: string } };\n' +
        '}\n',
    );
    write(`${PAGES_DIR}/index.astro`, '<p>home</p>\n');
    write(`${PAGES_DIR}/about.astro`, '<p>about</p>\n');
    write(`${PAGES_DIR}/feed.xml.ts`, 'export const GET = () => new Response();\n');
    write(`${PAGES_DIR}/[category]/[slug].astro`, '<p>article</p>\n');
    write(
      'dev_docs/SPEC.md',
      'Determinism comes from `merge=ours` on instance-owned files (`CLAUDE.md`,\n' +
        '`knowledge/**`), plus the ownership rule.\n\n' +
        '`sync.sh` -> parallel prebuild (`run-p`: related, search) -> `astro build` ->\n' +
        'contract checks (`run-s`: smoke).\n\n' +
        'Schema: `place {name, domain}`, `features {graph, feedback}`,\n' +
        '`links {repo, social {twitter?}}`.\n' +
        'Init-time: written only by the wizard.\n\n' +
        'Routes under `src/pages/`: `index`, `about`, `feed.xml`,\n' +
        '`[category]/[slug]`.\n' +
        'Non-route build outputs: none in this fixture.\n',
    );
    write(
      'dev_docs/adr/006-adopter-owned-agents-md-and-dev-plugin-encapsulation.md',
      'The `merge=ours` list is now: `CLAUDE.md`, `knowledge/**`.\n',
    );
    write(
      'docs/runbook/UPGRADE.md',
      '## Instance-owned files (`merge=ours`)\n\n' +
        '| Path | Why instance-owned |\n' +
        '| ---- | ------------------ |\n' +
        '| `CLAUDE.md` | the shim |\n' +
        '| `knowledge/**` | the content |\n\n' +
        'Adopters add their own the same way.\n',
    );
    write(
      '.agents/skills/sekai-upgrade/SKILL.md',
      'The merge keeps the existing copy of every\n' +
        'instance-owned file (`CLAUDE.md`, `knowledge/**`) -- those do not conflict.\n',
    );
  };

  const cases = [
    {
      what: 'a surviving file that links into a stripped path',
      plant: () => write('docs/runbook/DEPLOY.md', 'See dev_docs/PRD.md for intent.\n'),
      expect: /links into "dev_docs\/PRD\.md"/,
    },
    {
      what: 'a stripped path the template no longer has',
      plant: () => rmSync(join(fixture, 'dev_docs/PRD.md')),
      expect: /absent from this template checkout/,
    },
    {
      what: 'a removed adopter doc tree',
      plant: () => rmSync(join(fixture, 'docs/runbook'), { recursive: true }),
      expect: /adopter doc tree is missing/,
    },
    {
      what: 'a merge=ours entry missing from the prose list',
      plant: () => write(GITATTRIBUTES, 'CLAUDE.md merge=ours\nknowledge/** merge=ours\nCNAME merge=ours\n'),
      expect: /Repo topology, instance-owned merge=ours list/,
    },
    {
      what: 'a prebuild job missing from the prose list',
      plant: () =>
        write(
          PACKAGE_JSON,
          `${JSON.stringify(
            {
              scripts: {
                prebuild: 'run-p prebuild:search prebuild:related prebuild:graph',
                postbuild: 'run-s postbuild:smoke',
              },
            },
            null,
            2,
          )}\n`,
        ),
      expect: /Build pipeline, parallel prebuild jobs/,
    },
    {
      what: 'a reworded (unfindable) registered statement',
      plant: () =>
        write(
          'dev_docs/adr/006-adopter-owned-agents-md-and-dev-plugin-encapsulation.md',
          'The `merge=ours` set currently covers: `CLAUDE.md`, `knowledge/**`.\n',
        ),
      expect: /anchor NOT FOUND/,
    },
    {
      what: 'an unparseable MAINTAINER_DOCS declaration',
      plant: () => write(WIZARD, 'export const OTHER = 1;\n'),
      expect: /no MAINTAINER_DOCS array literal found/,
    },
    {
      what: 'a new place.config section missing from the schema prose',
      plant: () =>
        write(
          PLACE_CONFIG,
          'export interface PlaceConfig {\n' +
            '  place: {\n    name: string;\n    domain: string;\n  };\n' +
            '  features: {\n    graph: boolean;\n    feedback: boolean;\n  };\n' +
            '  links: { repo: string; social: { twitter?: string } };\n' +
            '  workers?: { feedback?: string };\n' +
            '}\n',
        ),
      expect: /place\.config\.ts schema, top-level sections/,
    },
    {
      what: 'a new features flag missing from the schema prose',
      plant: () =>
        write(
          PLACE_CONFIG,
          'export interface PlaceConfig {\n' +
            '  place: {\n    name: string;\n    domain: string;\n  };\n' +
            '  features: {\n    graph: boolean;\n    feedback: boolean;\n    chat: boolean;\n  };\n' +
            '  links: { repo: string; social: { twitter?: string } };\n' +
            '}\n',
        ),
      expect: /place\.config\.ts schema, features flags/,
    },
    {
      // A nested field promoted to the top-level list is drift in the other
      // direction: the prose claims a section the interface does not declare.
      what: 'a schema prose section the interface does not declare',
      plant: () =>
        write(
          'dev_docs/SPEC.md',
          'Determinism comes from `merge=ours` on instance-owned files (`CLAUDE.md`,\n' +
            '`knowledge/**`), plus the ownership rule.\n\n' +
            '`sync.sh` -> parallel prebuild (`run-p`: related, search) -> `astro build` ->\n' +
            'contract checks (`run-s`: smoke).\n\n' +
            'Schema: `place {name, domain}`, `features {graph, feedback}`,\n' +
            '`links {repo}`, `social {twitter?}`.\n' +
            'Init-time: written only by the wizard.\n',
        ),
      expect: /place\.config\.ts schema, top-level sections/,
    },
    {
      what: 'an unparseable PlaceConfig interface',
      plant: () => write(PLACE_CONFIG, 'export const config = {};\n'),
      expect: /no readable `export interface PlaceConfig`/,
    },
    {
      // The case this guard exists for: a phase adds a page and nobody amends the
      // sentence that enumerates them.
      what: 'a new page missing from the SPEC route list',
      plant: () => write(`${PAGES_DIR}/soundscape.astro`, '<p>audio</p>\n'),
      expect: /Pages, routes under src\/pages\//,
    },
    {
      // Same defect through Astro's other page extension. `.html` is in the default
      // `pageExtensions`, so a page can be added without a single `.astro` file; a
      // derivation that only knew `.astro` would stay green while SPEC went stale.
      what: 'a new .html page missing from the SPEC route list',
      plant: () => write(`${PAGES_DIR}/legal.html`, '<p>legal</p>\n'),
      expect: /Pages, routes under src\/pages\//,
    },
    {
      // Drift in the other direction: prose claiming a route that no page produces.
      what: 'a SPEC route the pages directory does not produce',
      plant: () => rmSync(join(fixture, PAGES_DIR, 'about.astro')),
      expect: /Pages, routes under src\/pages\//,
    },
    {
      what: 'an unreadable pages directory',
      plant: () => rmSync(join(fixture, PAGES_DIR), { recursive: true }),
      expect: /the route list cannot be derived/,
    },
    {
      what: 'a merge=ours path missing from the adopter-facing runbook table',
      plant: () =>
        write(
          'docs/runbook/UPGRADE.md',
          '## Instance-owned files (`merge=ours`)\n\n' +
            '| Path | Why instance-owned |\n' +
            '| ---- | ------------------ |\n' +
            '| `CLAUDE.md` | the shim |\n\n' +
            'Adopters add their own the same way.\n',
        ),
      expect: /Instance-owned files table/,
    },
    {
      what: 'a reworded (unfindable) runbook table heading',
      plant: () =>
        write(
          'docs/runbook/UPGRADE.md',
          '| File | Why yours |\n| ---- | --------- |\n| `CLAUDE.md` | the shim |\n',
        ),
      expect: /anchor NOT FOUND/,
    },
    {
      what: 'a merge=ours path missing from the upgrade skill list',
      plant: () =>
        write(
          '.agents/skills/sekai-upgrade/SKILL.md',
          'The merge keeps the existing copy of every\ninstance-owned file (`CLAUDE.md`) -- those do not conflict.\n',
        ),
      expect: /Step 4, instance-owned file list/,
    },
    {
      // The containment rule must still catch the direction that matters: a document
      // an adopter reads may not claim a path their `.gitattributes` does not protect.
      what: 'an adopted instance whose runbook documents a path that is not declared',
      plant: () => {
        rmSync(join(fixture, '.sekai-template'));
        write(
          'docs/runbook/UPGRADE.md',
          '| Path | Why instance-owned |\n| ---- | ------------------ |\n' +
            '| `CLAUDE.md` | the shim |\n| `knowledge/**` | the content |\n' +
            '| `dev_docs/PRD.md` | never declared anywhere |\n',
        );
      },
      expect: /documented but not declared: dev_docs\/PRD\.md/,
    },
    {
      // Non-regression for the registered-span mask: masking the table must not
      // switch the dangling scan off for the rest of the same file.
      what: 'a dangling reference elsewhere in a file whose table is masked',
      plant: () =>
        write(
          'docs/runbook/UPGRADE.md',
          '## Instance-owned files (`merge=ours`)\n\n' +
            '| Path | Why instance-owned |\n' +
            '| ---- | ------------------ |\n' +
            '| `CLAUDE.md` | the shim |\n' +
            '| `knowledge/**` | the content |\n\n' +
            'Background reading: dev_docs/PRD.md explains the intent.\n',
        ),
      expect: /links into "dev_docs\/PRD\.md"/,
    },
    {
      // Non-regression for the instance-owned cases below: dropping the template
      // marker must NOT switch the dangling scan off. A wizard-adopted instance
      // really has none of these paths, so a reference in a file it keeps still
      // dangles and must still fail.
      what: 'a dangling reference in a wizard-adopted instance (paths really absent)',
      plant: () => {
        rmSync(join(fixture, '.sekai-template'));
        rmSync(join(fixture, 'dev_docs/PRD.md'));
        rmSync(join(fixture, 'dev_docs/adr'), { recursive: true });
        write('docs/runbook/DEPLOY.md', 'See dev_docs/PRD.md for intent.\n');
      },
      expect: /links into "dev_docs\/PRD\.md"/,
    },
  ];

  // Cases that must PASS. An instance that keeps its OWN documents at the
  // maintainer-doc paths (instance #1) is a legitimate state, not a defect: the
  // reference resolves, and the instance's document is not a stale copy of the
  // framework's prose. Only "must fail" cases would let a gate that rejects that
  // state look healthy.
  const passCases = [
    {
      what: 'an instance that owns a maintainer-doc path, referenced from a file it keeps',
      plant: () => {
        rmSync(join(fixture, '.sekai-template'));
        // dev_docs/PRD.md and dev_docs/adr/ stay: this instance wrote its own.
        write('docs/runbook/DEPLOY.md', 'Intent for this instance lives in dev_docs/PRD.md.\n');
      },
    },
    {
      // An adopter's `.gitattributes` is append-only per instance, so a path they
      // added is not drift in a framework document that predates it.
      what: 'an adopted instance that declared its own extra merge=ours path',
      plant: () => {
        rmSync(join(fixture, '.sekai-template'));
        // The framework's own SPEC/ADR restatements live in removed documents, so
        // only the two surviving sites are in play here -- which is the real shape.
        write(WIZARD, "export const MAINTAINER_DOCS = ['dev_docs/PRD.md', 'dev_docs/SPEC.md', 'dev_docs/adr'];\n");
        write(GITATTRIBUTES, 'CLAUDE.md merge=ours\nknowledge/** merge=ours\nmy-notes.md merge=ours\n');
      },
    },
    {
      // The maintainer-doc row the split requires an adopter-facing document to
      // carry: declared in `.gitattributes`, documented in the table, and NOT a
      // dangling reference even though the instance has no file there.
      what: 'a maintainer-doc path documented as instance-ownable in a surviving document',
      plant: () => {
        rmSync(join(fixture, '.sekai-template'));
        rmSync(join(fixture, 'dev_docs/PRD.md'));
        rmSync(join(fixture, 'dev_docs/adr'), { recursive: true });
        write(WIZARD, "export const MAINTAINER_DOCS = ['dev_docs/PRD.md', 'dev_docs/SPEC.md', 'dev_docs/adr'];\n");
        write(GITATTRIBUTES, 'CLAUDE.md merge=ours\nknowledge/** merge=ours\ndev_docs/PRD.md merge=ours\n');
        write(
          'docs/runbook/UPGRADE.md',
          '| Path | Why instance-owned |\n| ---- | ------------------ |\n' +
            '| `CLAUDE.md` | the shim |\n| `knowledge/**` | the content |\n' +
            '| `dev_docs/PRD.md` | your own product doc, if you keep one |\n',
        );
      },
    },
    {
      // The other direction of the same mirror: Astro's routing skips an
      // `_`-prefixed file or directory and every dot-file, so demanding a SPEC
      // entry for one would fail a tree that has no drift in it.
      what: 'a non-route partial and dot-file under src/pages/',
      plant: () => {
        write(`${PAGES_DIR}/_partial.astro`, '<p>partial</p>\n');
        write(`${PAGES_DIR}/_shared/helper.astro`, '<p>helper</p>\n');
        write(`${PAGES_DIR}/.keep`, '\n');
      },
    },
    {
      what: "an instance-owned SPEC that does not carry the framework's registered statements",
      plant: () => {
        rmSync(join(fixture, '.sekai-template'));
        write(WIZARD, "export const MAINTAINER_DOCS = ['dev_docs/PRD.md', 'dev_docs/SPEC.md', 'dev_docs/adr'];\n");
        // The instance's SPEC is its own document, with none of the framework
        // anchors in it. That is the split working, not drift.
        write('dev_docs/SPEC.md', 'This instance deploys to Pages behind a CDN. Categories live in config.\n');
      },
    },
  ];

  try {
    build();
    const baseline = run(fixture);
    if (baseline.failures.length > 0) {
      console.error('FAIL: framework-docs self-test -- the guard fails on the clean fixture:');
      for (const f of baseline.failures) console.error(`  ${f}`);
      return 1;
    }

    for (const testCase of cases) {
      build();
      testCase.plant();
      const result = run(fixture);
      const report = result.failures.join('\n');
      if (result.failures.length === 0) {
        console.error(`FAIL: framework-docs self-test -- the guard did NOT catch ${testCase.what}.`);
        return 1;
      }
      if (!testCase.expect.test(report)) {
        console.error(
          `FAIL: framework-docs self-test -- the guard caught ${testCase.what} for the wrong reason:\n${report}`,
        );
        return 1;
      }
    }

    for (const testCase of passCases) {
      build();
      testCase.plant();
      const result = run(fixture);
      if (result.failures.length > 0) {
        console.error(
          `FAIL: framework-docs self-test -- the guard REJECTED a legitimate state: ${testCase.what}.`,
        );
        for (const f of result.failures) console.error(`  ${f}`);
        return 1;
      }
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }

  console.log(
    `OK: framework-docs self-test passed -- the guard catches all ${cases.length} planted defect ` +
      `classes and accepts all ${passCases.length} legitimate instance-owned states`,
  );
  return 0;
}

/* -- Entry point -- */

function parseRoot(argv) {
  const i = argv.indexOf('--root');
  if (i === -1) return fileURLToPath(new URL('../..', import.meta.url));
  if (!argv[i + 1]) {
    console.error('FAIL: --root needs a directory');
    process.exit(2);
  }
  return argv[i + 1];
}

const argv = process.argv.slice(2);
if (argv.includes('--selftest')) {
  process.exit(selftest());
}

const root = parseRoot(argv);
const result = run(root);

if (result.failures.length > 0) {
  console.error('FAIL: framework maintainer-doc contract violated:');
  for (const f of result.failures) console.error(`  ${f}`);
  console.error('');
  console.error(`  strip list (${WIZARD}): ${(result.maintainerDocs ?? []).join(', ') || '(underivable)'}`);
  console.error(`  adopter doc trees kept: ${ADOPTER_DOC_TREES.join(', ')}`);
  process.exit(1);
}

const mode = result.templateMode ? 'template mode' : 'instance mode';
const skips = result.skipped.length ? `; skipped: ${result.skipped.join(', ')}` : '';
console.log(
  `OK: framework maintainer-doc gate passed [${mode}] -- ${result.checked} enumeration(s) match ` +
    `their source, ${result.scannedFiles} surviving file(s) carry no link into ` +
    `${result.maintainerDocs.join(', ')}${skips}`,
);
