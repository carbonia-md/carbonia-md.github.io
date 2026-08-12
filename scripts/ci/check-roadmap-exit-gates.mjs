#!/usr/bin/env node
// check-roadmap-exit-gates.mjs -- the ROADMAP exit-gate gate.
//
// The delivery SSOT has always stated, in the `Execution repo flow` paragraph, that
// each phase closes with a tagged release which instance #1 adopts, and that the pull
// is part of that phase's exit gate. That rule went unenforced in four of the six
// milestone rows from the day it was written: only phases 9, 10, and 11 spelled the
// adoption clause out, only 6.4 and 9.3 existed as packets, and phases 7, 8, 10, and
// 11 tracked no adoption work at all. That is the shape that lets a phase be declared
// closed while the instance is still running the previous release.
//
// The standing doctrine when a rule keeps being missed is to add a check rather than
// another paragraph (dev_docs/research/origin-decisions.md section 3). This is that
// check. It asserts, for every milestone row in the table:
//
//   1. the `Exit gate` cell names a release tag,
//   2. it names the instance adoption,
//   3. it names the maintainer confirm,
//   4. it cites a packet id, and that id is DEFINED by a `[N.x] ...` task block in
//      the detailed blocks below -- so a row cannot cite a packet nobody wrote.
//
// What it deliberately does NOT do: judge the feature-proof half of the cell. That is
// phase-specific prose with no derivable form, and a gate that pattern-matched it
// would be asserting its own vocabulary rather than a contract.
//
// TEMPLATE MODE ONLY. The ROADMAP is a framework maintainer document that adoption
// removes (ADR 008, relocated by ADR 009), so in an adopted instance there is nothing
// to check and the gate reports skipped and exits 0. It never fails on a file whose
// absence is correct.
//
// Failure modes, all exit 1:
//   - the milestone table cannot be located or parsed (the gate would otherwise
//     silently pass on a document it never read);
//   - a row's exit gate omits any of the three required clauses;
//   - a row's exit gate cites no packet id;
//   - a cited packet id has no `[N.x]` task block defining it;
//   - the ROADMAP exists in template mode but declares no milestone rows.
//
// `--selftest` builds a fixture ROADMAP per planted defect class and requires this
// gate to reject each one, plus a clean fixture it must accept. An assertion that
// cannot fail is not evidence.

import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ROADMAP = 'dev_docs/ROADMAP.md';
const TEMPLATE_MARKER = '.sekai-template';

// The three clauses every exit gate must carry beyond its feature proof. Each is a
// list of alternative spellings; a cell satisfies the clause if it matches any one.
// Kept deliberately loose on wording and strict on presence: the point is that the
// commitment is stated, not that it is stated in one blessed phrasing.
const REQUIRED_CLAUSES = [
  {
    what: 'the release tag',
    why: 'a phase closes by shipping a tag, not by merging its last PR',
    patterns: [/\btag\b/i, /\brelease[sd]?\b/i],
  },
  {
    what: 'the instance adoption',
    why: 'the pull into instance #1 is part of the gate (ADR 004/005), not a follow-up',
    patterns: [/\badopts?\b/i, /\badoption\b/i, /sekai-upgrade/i],
  },
  {
    what: 'the maintainer confirm',
    why: '/dev:plan for phase n+1 waits on it',
    patterns: [/\bphase confirm\b/i, /\bmaintainer confirm\b/i],
  },
];

/** Milestone rows: `| N | Milestone | Outcome | Scope | Exit gate | Est |`. */
function parseMilestoneRows(src) {
  const rows = [];
  const header = /\|\s*#\s*\|\s*Milestone\s*\|[^\n]*\|\s*Exit gate\s*\|[^\n]*\|\n\|[\s|:-]+\|\n/.exec(src);
  if (!header) return null;
  let cursor = header.index + header[0].length;
  for (;;) {
    const nl = src.indexOf('\n', cursor);
    const line = (nl === -1 ? src.slice(cursor) : src.slice(cursor, nl)).trim();
    if (!line.startsWith('|')) break;
    // Split on unescaped pipes: an estimate cell writes `AI 12h \| Human 2h`.
    const cells = line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split(/(?<!\\)\|/)
      .map((c) => c.trim());
    if (cells.length >= 5) rows.push({ phase: cells[0], exitGate: cells[4] });
    if (nl === -1) break;
    cursor = nl + 1;
  }
  return rows;
}

/** Packet ids a task block DEFINES: a line starting `[N.x]`. */
function definedPackets(src) {
  const ids = new Set();
  for (const m of src.matchAll(/^\[(\d+\.[0-9a-z-]+)\]/gm)) ids.add(m[1]);
  return ids;
}

/** Packet ids an exit-gate cell CITES: `(6.4)`, `(11.1-11.8)`, `(7.4)`. */
function citedPackets(cell) {
  const ids = [];
  for (const m of cell.matchAll(/\((\d+\.[0-9a-z-]+)\)/g)) ids.push(m[1]);
  return ids;
}

function run(root) {
  const failures = [];
  const templateMode = existsSync(join(root, TEMPLATE_MARKER));
  const abs = join(root, ROADMAP);

  if (!templateMode) {
    return { failures, skipped: true, rows: 0, templateMode };
  }
  if (!existsSync(abs)) {
    failures.push(
      `${ROADMAP}: missing in TEMPLATE mode. This checkout carries ${TEMPLATE_MARKER}, so it ` +
        'authors the delivery SSOT and the exit-gate contract cannot be checked without it. ' +
        'Re-point this guard in the same commit that moves the file.',
    );
    return { failures, skipped: false, rows: 0, templateMode };
  }

  const src = readFileSync(abs, 'utf8');
  const rows = parseMilestoneRows(src);
  if (rows === null) {
    failures.push(
      `${ROADMAP}: no milestone table found (expected a header row with '#', 'Milestone', ` +
        "and 'Exit gate' columns). Treating that as zero rows would pass this gate on a " +
        'document it never read, so it stops instead.',
    );
    return { failures, skipped: false, rows: 0, templateMode };
  }
  if (rows.length === 0) {
    failures.push(`${ROADMAP}: the milestone table declares no phase rows.`);
    return { failures, skipped: false, rows: 0, templateMode };
  }

  const defined = definedPackets(src);
  for (const { phase, exitGate } of rows) {
    for (const clause of REQUIRED_CLAUSES) {
      if (!clause.patterns.some((p) => p.test(exitGate))) {
        failures.push(
          `${ROADMAP}: phase ${phase} exit gate does not state ${clause.what} -- ${clause.why}.\n` +
            `      cell: ${exitGate}`,
        );
      }
    }
    const cited = citedPackets(exitGate);
    if (cited.length === 0) {
      failures.push(
        `${ROADMAP}: phase ${phase} exit gate cites no packet id. Adoption is real work with ` +
          'human steps, so it is tracked as a terminal packet and named here, never asserted ' +
          'as a property of the phase.\n' +
          `      cell: ${exitGate}`,
      );
      continue;
    }
    for (const id of cited) {
      if (!defined.has(id)) {
        failures.push(
          `${ROADMAP}: phase ${phase} exit gate cites packet ${id}, which no task block defines. ` +
            `Add a \`[${id}] ...\` block, or cite the packet that really carries the work.`,
        );
      }
    }
  }

  return { failures, skipped: false, rows: rows.length, templateMode };
}

/* ------------------------------- self-test ------------------------------- */

const CLEAN_TABLE = `# ROADMAP: fixture

| # | Milestone | Outcome | Scope (tasks) | Exit gate | Est |
|---|---|---|---|---|---|
| 6 | First | Something | 6.1 · 6.2 | It works; tag released; instance #1 adopts clean (6.2); maintainer phase confirm | AI 1h \\| Human 0h |
| 7 | Second | Something else | 7.1 · 7.2 | It also works; tag released; instance #1 adopts clean (7.2); maintainer phase confirm | AI 1h \\| Human 0h |

## Detailed task blocks

\`\`\`text
[6.1] Do the thing
  Effort: S
[6.2] Phase 6 exit gate: ship the tag, adopt it in the instance
  Effort: S
[7.1] Do the other thing
  Effort: S
[7.2] Phase 7 exit gate: ship the tag, adopt it in the instance
  Effort: S
\`\`\`
`;

function selftest() {
  const fixture = mkdtempSync(join(tmpdir(), 'roadmap-gates-'));
  const write = (rel, content) => {
    mkdirSync(dirname(join(fixture, rel)), { recursive: true });
    writeFileSync(join(fixture, rel), content);
  };
  const build = (roadmap = CLEAN_TABLE) => {
    rmSync(fixture, { recursive: true, force: true });
    mkdirSync(fixture, { recursive: true });
    write(TEMPLATE_MARKER, 'marker\n');
    write(ROADMAP, roadmap);
  };

  const cases = [
    {
      what: 'an exit gate that never mentions a tag or release',
      roadmap: CLEAN_TABLE.replace(
        'It works; tag released; instance #1 adopts clean (6.2);',
        'It works; instance #1 adopts clean (6.2);',
      ),
      expect: /does not state the release tag/,
    },
    {
      what: 'an exit gate that never mentions the instance adoption',
      roadmap: CLEAN_TABLE.replace(
        'It works; tag released; instance #1 adopts clean (6.2);',
        'It works; tag released (6.2);',
      ),
      expect: /does not state the instance adoption/,
    },
    {
      what: 'an exit gate that never mentions the maintainer confirm',
      roadmap: CLEAN_TABLE.replace(
        'instance #1 adopts clean (6.2); maintainer phase confirm',
        'instance #1 adopts clean (6.2)',
      ),
      expect: /does not state the maintainer confirm/,
    },
    {
      what: 'an exit gate that cites no packet',
      roadmap: CLEAN_TABLE.replace('adopts clean (6.2);', 'adopts clean;'),
      expect: /cites no packet id/,
    },
    {
      what: 'an exit gate citing a packet no task block defines',
      roadmap: CLEAN_TABLE.replace('adopts clean (6.2);', 'adopts clean (6.9);'),
      expect: /cites packet 6\.9, which no task block defines/,
    },
    {
      what: 'a ROADMAP with no milestone table',
      roadmap: '# ROADMAP: fixture\n\nNo table here at all.\n',
      expect: /no milestone table found/,
    },
    {
      what: 'a milestone table with no phase rows',
      roadmap:
        '# ROADMAP: fixture\n\n| # | Milestone | Outcome | Scope (tasks) | Exit gate | Est |\n|---|---|---|---|---|---|\n\nnothing follows.\n',
      expect: /declares no phase rows/,
    },
  ];

  try {
    build();
    const baseline = run(fixture);
    if (baseline.failures.length > 0) {
      console.error('FAIL: roadmap exit-gate self-test -- the guard fails on the clean fixture:');
      for (const f of baseline.failures) console.error(`  ${f}`);
      return 1;
    }

    for (const c of cases) {
      build(c.roadmap);
      const result = run(fixture);
      const report = result.failures.join('\n');
      if (result.failures.length === 0) {
        console.error(`FAIL: roadmap exit-gate self-test -- the guard did NOT catch ${c.what}.`);
        return 1;
      }
      if (!c.expect.test(report)) {
        console.error(
          `FAIL: roadmap exit-gate self-test -- the guard caught ${c.what} for the wrong reason:\n${report}`,
        );
        return 1;
      }
    }

    // An adopted instance has no ROADMAP and no marker: skipped, never failed.
    rmSync(fixture, { recursive: true, force: true });
    mkdirSync(fixture, { recursive: true });
    const adopted = run(fixture);
    if (!adopted.skipped || adopted.failures.length > 0) {
      console.error(
        'FAIL: roadmap exit-gate self-test -- the guard did not skip on an adopted instance ' +
          '(no template marker, no ROADMAP).',
      );
      return 1;
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }

  console.log(
    `OK: roadmap exit-gate self-test passed -- the guard catches all ${cases.length} planted ` +
      'defect classes, accepts a clean table, and skips an adopted instance',
  );
  return 0;
}

/* --------------------------------- main --------------------------------- */

if (process.argv.includes('--selftest')) {
  process.exit(selftest());
}

const { failures, skipped, rows } = run(ROOT);

if (skipped) {
  console.log(
    `OK: roadmap exit-gate gate skipped -- no ${TEMPLATE_MARKER}, so this is an adopted ` +
      'instance and the framework ROADMAP is not its document (ADR 008/009).',
  );
  process.exit(0);
}

if (failures.length > 0) {
  console.error('FAIL: ROADMAP exit-gate contract violated:');
  for (const f of failures) console.error(`  ${f}`);
  console.error(
    '\nEvery phase closes with a tagged release that instance #1 adopts (ADR 004/005). ' +
      'State it in the row and track it with a packet.',
  );
  process.exit(1);
}

console.log(
  `OK: roadmap exit-gate gate passed [template mode] -- all ${rows} milestone row(s) state the ` +
    'tag, the instance adoption, and the maintainer confirm, and every cited packet is defined',
);
