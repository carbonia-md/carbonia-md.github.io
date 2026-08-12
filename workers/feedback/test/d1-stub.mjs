/**
 * In-memory D1 stub for the feedback worker tests (LB-69 DoD 5).
 *
 * Implements the `prepare(sql) -> { bind(...args) -> { run, first, all } }` subset the
 * worker uses. Statements are routed by *identity* against the worker's exported
 * `SQL.*` strings, never by parsing SQL text, so the stub stays valid however the
 * statements are worded.
 *
 * The rate limiter is a rolling window: `submission_window` holds one row per
 * (ip_hash, second-in-which-a-submission-arrived), and the limit is the sum over the
 * rows still inside the window. This stub emulates exactly that, so a test that
 * walks the clock forward sees the same arithmetic D1 would do:
 *
 *   RATE_LIMIT_PRUNE   (ip_hash, floor)  DELETE rows with window_start <= floor,
 *                                        and any row already exhausted (count <= 0)
 *   RATE_LIMIT_RECORD  (ip_hash, now)    upsert the (ip_hash, now) row, count += 1
 *   RATE_LIMIT_COUNT   (ip_hash)         SUM(count), MIN(window_start) over survivors
 *   RATE_LIMIT_RELEASE (ip_hash, now)    count -= 1 on the (ip_hash, now) row
 *
 * Test-owned code: it records every call so tests can assert call counts, bound
 * arguments, and stored rows.
 */

/** Column order of the INSERT_FEEDBACK bind arguments, per the contract. */
export const INSERT_COLUMNS = [
  'id',
  'created_at',
  'page',
  'category',
  'message',
  'contact',
  'user_agent',
  'status',
];

/** Bind-argument names of each rate-limit statement, per the contract. */
export const RATE_LIMIT_ARGS = {
  prune: ['ip_hash', 'window_floor'],
  record: ['ip_hash', 'now'],
  count: ['ip_hash'],
  release: ['ip_hash', 'now'],
};

const PRUNE = 'prune';
const RECORD = 'record';
const COUNT = 'count';
const RELEASE = 'release';
const INSERT = 'insert';

const RATE_LIMIT_KINDS = new Set([PRUNE, RECORD, COUNT, RELEASE]);

/**
 * @param {{ RATE_LIMIT_PRUNE: string, RATE_LIMIT_RECORD: string,
 *           RATE_LIMIT_COUNT: string, RATE_LIMIT_RELEASE: string,
 *           INSERT_FEEDBACK: string }} SQL
 *   the worker's exported SQL object; used for identity routing.
 */
export function createD1Stub(SQL) {
  const required = [
    'RATE_LIMIT_PRUNE',
    'RATE_LIMIT_RECORD',
    'RATE_LIMIT_COUNT',
    'RATE_LIMIT_RELEASE',
    'INSERT_FEEDBACK',
  ];
  for (const key of required) {
    if (!SQL || typeof SQL[key] !== 'string' || SQL[key].length === 0) {
      throw new TypeError(`createD1Stub: SQL.${key} must be a non-empty string`);
    }
  }
  const statements = required.map((key) => SQL[key]);
  if (new Set(statements).size !== statements.length) {
    throw new TypeError('createD1Stub: every SQL statement must be distinguishable by identity');
  }

  /** ip_hash -> (window_start -> count). One entry per second that saw a submission. */
  /** @type {Map<string, Map<number, number>>} */
  const buckets = new Map();
  /** @type {string[]} every sql string handed to prepare() */
  const prepared = [];
  /** @type {{ kind: string, method: string, args: unknown[] }[]} every executed statement */
  const calls = [];
  /** @type {Record<string, unknown>[]} every row bound to INSERT_FEEDBACK */
  const rows = [];

  function classify(sql) {
    if (sql === SQL.RATE_LIMIT_PRUNE) return PRUNE;
    if (sql === SQL.RATE_LIMIT_RECORD) return RECORD;
    if (sql === SQL.RATE_LIMIT_COUNT) return COUNT;
    if (sql === SQL.RATE_LIMIT_RELEASE) return RELEASE;
    if (sql === SQL.INSERT_FEEDBACK) return INSERT;
    throw new Error(`d1 stub: unknown prepared statement (${String(sql).slice(0, 60)})`);
  }

  function requireArgs(kind, args, expected) {
    if (args.length !== expected) {
      throw new Error(`d1 stub: ${kind} expects ${expected} bind args, got ${args.length}`);
    }
    const [ipHash] = args;
    if (typeof ipHash !== 'string' || ipHash.length === 0) {
      throw new Error(`d1 stub: ${kind} ip_hash must be a non-empty string`);
    }
    for (const value of args.slice(1)) {
      if (!Number.isFinite(value)) {
        throw new Error(`d1 stub: ${kind} numeric bind args must be finite numbers`);
      }
    }
  }

  // `count <= 0` is the second half of the DELETE: a row RELEASE emptied is gone at
  // the next prune, so it can never answer MIN(window_start) for a later request.
  function applyPrune(args) {
    requireArgs(PRUNE, args, 2);
    const [ipHash, floor] = args;
    const perIp = buckets.get(ipHash);
    if (!perIp) return null;
    for (const [start, count] of [...perIp]) {
      if (start <= floor || count <= 0) perIp.delete(start);
    }
    if (perIp.size === 0) buckets.delete(ipHash);
    return null;
  }

  function applyRecord(args) {
    requireArgs(RECORD, args, 2);
    const [ipHash, now] = args;
    const perIp = buckets.get(ipHash) ?? new Map();
    perIp.set(now, (perIp.get(now) ?? 0) + 1);
    buckets.set(ipHash, perIp);
    return null;
  }

  // SQL aggregates over an empty set yield NULL, not 0; the worker must cope with
  // that, so the stub reproduces it rather than helpfully returning zero.
  function applyCount(args) {
    requireArgs(COUNT, args, 1);
    const [ipHash] = args;
    const perIp = buckets.get(ipHash);
    if (!perIp || perIp.size === 0) return { total: null, oldest: null };
    let total = 0;
    let oldest = Infinity;
    for (const [start, count] of perIp) {
      total += count;
      if (start < oldest) oldest = start;
    }
    return { total, oldest };
  }

  // The `count > 0` guard is the statement's, not a convenience: a decrement can never
  // drive a row negative, and a missing row is simply no rows changed.
  function applyRelease(args) {
    requireArgs(RELEASE, args, 2);
    const [ipHash, start] = args;
    const perIp = buckets.get(ipHash);
    const count = perIp?.get(start);
    if (count === undefined || count <= 0) return null;
    perIp.set(start, count - 1);
    return null;
  }

  function applyInsert(args) {
    if (args.length !== INSERT_COLUMNS.length) {
      throw new Error(
        `d1 stub: INSERT_FEEDBACK expects ${INSERT_COLUMNS.length} bind args, got ${args.length}`,
      );
    }
    const row = {};
    INSERT_COLUMNS.forEach((column, index) => {
      row[column] = args[index];
    });
    rows.push(row);
    return null;
  }

  const APPLY = {
    [PRUNE]: applyPrune,
    [RECORD]: applyRecord,
    [COUNT]: applyCount,
    [RELEASE]: applyRelease,
    [INSERT]: applyInsert,
  };

  function makeStatement(kind, args) {
    let executed = false;
    let result;
    const exec = (method) => {
      calls.push({ kind, method, args: [...args] });
      if (!executed) {
        executed = true;
        result = APPLY[kind](args);
      }
      return result;
    };
    return {
      async run() {
        const row = exec('run');
        return { success: true, meta: { changes: kind === INSERT ? 1 : 0 }, results: row ? [row] : [] };
      },
      async first() {
        return exec('first');
      },
      async all() {
        const row = exec('all');
        return { success: true, meta: {}, results: row ? [row] : [] };
      },
    };
  }

  return {
    /** sql strings passed to prepare(), in order */
    prepared,
    /** executed statements: { kind, method, args } */
    calls,
    /** rows bound to INSERT_FEEDBACK, keyed by column name */
    rows,
    /** live rate-limit table: ip_hash -> (window_start -> count) */
    buckets,

    prepare(sql) {
      prepared.push(sql);
      const kind = classify(sql);
      return {
        bind(...args) {
          return makeStatement(kind, args);
        },
      };
    },

    /** every executed rate-limit call, of any of the three statements */
    get rateLimitCalls() {
      return calls.filter((call) => RATE_LIMIT_KINDS.has(call.kind));
    },
    /** every executed INSERT_FEEDBACK call */
    get insertCalls() {
      return calls.filter((call) => call.kind === INSERT);
    },
    /** executed calls of one rate-limit statement */
    callsOf(kind) {
      return calls.filter((call) => call.kind === kind);
    },

    /**
     * Pre-load submissions so a test can drive the counter deterministically.
     * `{ window_start, count }` puts `count` submissions in that one second, which is
     * how a burst at a single instant is represented.
     */
    seedRateLimit(ipHash, ...seeds) {
      const perIp = buckets.get(ipHash) ?? new Map();
      for (const { window_start: start, count } of seeds) {
        perIp.set(start, (perIp.get(start) ?? 0) + count);
      }
      buckets.set(ipHash, perIp);
    },

    /** what RATE_LIMIT_COUNT would return right now, for assertions */
    usage(ipHash) {
      return applyCount([ipHash]);
    },

    /** true when the worker touched D1 in any way (prepare included) */
    get touched() {
      return prepared.length > 0 || calls.length > 0;
    },
  };
}

export { PRUNE, RECORD, COUNT, RELEASE, INSERT };
