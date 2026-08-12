-- 0001_init.sql — the feedback capability's D1 schema.
--
-- Applied with `npx wrangler d1 migrations apply <database-name>` (see
-- docs/runbook/DEPLOY.md §Cloudflare Workers). Carries no place identity.

-- Reader submissions.
-- `status` is the triage lifecycle field: rows land as 'new' and the triage skill
-- moves them from there. No column holds an IP address.
CREATE TABLE IF NOT EXISTS feedback (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  page        TEXT NOT NULL,
  category    TEXT NOT NULL,
  message     TEXT NOT NULL,
  contact     TEXT,
  user_agent  TEXT,
  status      TEXT NOT NULL DEFAULT 'new'
);

-- The triage skill reads untriaged rows oldest-first; this is the index for that
-- one query shape.
CREATE INDEX IF NOT EXISTS idx_feedback_status_created ON feedback (status, created_at);

-- Rate-limit state: one row per (hashed address, second in which it submitted).
-- `ip_hash` is sha256(CF-Connecting-IP + IP_HASH_SALT), `window_start` is that
-- second in unix time, and `count` is how many submissions arrived in it. Summing
-- the rows still inside the window is what makes the limit a genuine ROLLING
-- window: there is no single counter that resets on a boundary and lets a second
-- full allowance through.
--
-- Only ACCEPTED submissions stay counted. A refused request decrements the row it
-- took, so an address that hits the limit and then waits out Retry-After is let
-- back in rather than re-recording itself on every retry and staying locked out.
-- That is why `count` can momentarily reach 0: the next prune deletes such a row.
--
-- The composite PRIMARY KEY is load-bearing twice over: it makes the worker's
-- `ON CONFLICT(ip_hash, window_start)` upsert atomic, and its leftmost column
-- indexes the per-address prune and sum. Rows are pruned on every request once
-- they fall out of the window, so a hammering address costs at most one row per
-- second of the window rather than growing without bound. Nothing here is
-- reversible to an address without the salt.
CREATE TABLE IF NOT EXISTS submission_window (
  ip_hash       TEXT NOT NULL,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, window_start)
);
