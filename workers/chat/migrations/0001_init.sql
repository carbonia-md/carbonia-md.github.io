-- Exact rolling-window state for the chat worker. Raw IP addresses are never stored.
CREATE TABLE IF NOT EXISTS submission_window (
  ip_hash       TEXT NOT NULL,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, window_start)
);
