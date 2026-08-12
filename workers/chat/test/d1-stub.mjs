/**
 * Identity-routed D1 stub for the chat worker rolling rate-limit contract.
 * The stub never parses SQL text. Exported SQL string identity is the public seam.
 */

const PRUNE = 'prune';
const RECORD = 'record';
const COUNT = 'count';
const RELEASE = 'release';

export function createD1Stub(SQL) {
  const required = [
    'RATE_LIMIT_PRUNE',
    'RATE_LIMIT_RECORD',
    'RATE_LIMIT_COUNT',
    'RATE_LIMIT_RELEASE',
  ];
  for (const key of required) {
    if (!SQL || typeof SQL[key] !== 'string' || SQL[key].length === 0) {
      throw new TypeError(`createD1Stub: SQL.${key} must be a non-empty string`);
    }
  }
  if (new Set(required.map((key) => SQL[key])).size !== required.length) {
    throw new TypeError('createD1Stub: rate-limit statements must be distinct by identity');
  }

  const buckets = new Map();
  const prepared = [];
  const calls = [];

  function classify(sql) {
    if (sql === SQL.RATE_LIMIT_PRUNE) return PRUNE;
    if (sql === SQL.RATE_LIMIT_RECORD) return RECORD;
    if (sql === SQL.RATE_LIMIT_COUNT) return COUNT;
    if (sql === SQL.RATE_LIMIT_RELEASE) return RELEASE;
    throw new Error(`chat d1 stub: unknown statement ${String(sql).slice(0, 80)}`);
  }

  function requireArgs(kind, args, count) {
    if (args.length !== count) {
      throw new Error(`chat d1 stub: ${kind} expected ${count} args, got ${args.length}`);
    }
    if (typeof args[0] !== 'string' || args[0].length === 0) {
      throw new Error(`chat d1 stub: ${kind} requires a non-empty ip hash`);
    }
    for (const value of args.slice(1)) {
      if (!Number.isFinite(value)) throw new Error(`chat d1 stub: ${kind} requires numeric time args`);
    }
  }

  function execute(kind, args) {
    if (kind === PRUNE) {
      requireArgs(kind, args, 2);
      const [ipHash, floor] = args;
      const perIp = buckets.get(ipHash);
      if (perIp) {
        for (const [start, count] of [...perIp]) {
          if (start <= floor || count <= 0) perIp.delete(start);
        }
        if (perIp.size === 0) buckets.delete(ipHash);
      }
      return null;
    }
    if (kind === RECORD) {
      requireArgs(kind, args, 2);
      const [ipHash, now] = args;
      const perIp = buckets.get(ipHash) ?? new Map();
      perIp.set(now, (perIp.get(now) ?? 0) + 1);
      buckets.set(ipHash, perIp);
      return null;
    }
    if (kind === RELEASE) {
      requireArgs(kind, args, 2);
      const [ipHash, now] = args;
      const perIp = buckets.get(ipHash);
      const count = perIp?.get(now);
      if (count !== undefined && count > 0) perIp.set(now, count - 1);
      return null;
    }

    requireArgs(kind, args, 1);
    const perIp = buckets.get(args[0]);
    if (!perIp || perIp.size === 0) return { total: null, oldest: null };
    let total = 0;
    let oldest = Infinity;
    for (const [start, count] of perIp) {
      total += count;
      oldest = Math.min(oldest, start);
    }
    return { total, oldest };
  }

  function statement(kind, args) {
    let ran = false;
    let result;
    const runOnce = (method) => {
      calls.push({ kind, method, args: [...args] });
      if (!ran) {
        ran = true;
        result = execute(kind, args);
      }
      return result;
    };
    return {
      async run() {
        const row = runOnce('run');
        return { success: true, results: row ? [row] : [], meta: {} };
      },
      async first() {
        return runOnce('first');
      },
      async all() {
        const row = runOnce('all');
        return { success: true, results: row ? [row] : [], meta: {} };
      },
    };
  }

  return {
    buckets,
    prepared,
    calls,
    prepare(sql) {
      prepared.push(sql);
      const kind = classify(sql);
      return { bind: (...args) => statement(kind, args) };
    },
    callsOf(kind) {
      return calls.filter((call) => call.kind === kind);
    },
    seed(ipHash, ...entries) {
      const perIp = buckets.get(ipHash) ?? new Map();
      for (const { window_start: start, count } of entries) {
        perIp.set(start, (perIp.get(start) ?? 0) + count);
      }
      buckets.set(ipHash, perIp);
    },
    usage(ipHash) {
      return execute(COUNT, [ipHash]);
    },
    get touched() {
      return prepared.length > 0 || calls.length > 0;
    },
  };
}

export { PRUNE, RECORD, COUNT, RELEASE };
