// workers/chat/src/sql.mjs — the rate-limit statements, against migrations/0001_init.sql.
//
// These live apart from index.mjs so a test can execute them without importing the
// worker, which loads the gitignored vectors.json artifact at module scope. That import
// is what makes index.mjs unusable as a plain module in a suite that has no artifact
// installed, and two suites installing one would race under `node --test`.
//
// index.mjs re-exports this object, so the identity seam the D1 stub routes on is
// unchanged: there is still exactly one string per statement in the process.

export const SQL = {
  RATE_LIMIT_PRUNE: `
    DELETE FROM submission_window
    WHERE ip_hash = ?1 AND (window_start <= ?2 OR count <= 0)
  `,
  RATE_LIMIT_RECORD: `
    INSERT INTO submission_window (ip_hash, window_start, count)
    VALUES (?1, ?2, 1)
    ON CONFLICT(ip_hash, window_start) DO UPDATE SET count = count + 1
  `,
  RATE_LIMIT_COUNT: `
    SELECT SUM(count) AS total, MIN(window_start) AS oldest
    FROM submission_window
    WHERE ip_hash = ?1
  `,
  RATE_LIMIT_RELEASE: `
    UPDATE submission_window
    SET count = count - 1
    WHERE ip_hash = ?1 AND window_start = ?2 AND count > 0
  `,
};
