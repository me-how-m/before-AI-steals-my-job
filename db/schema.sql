-- Schema for Before AI steals my job… (Turso / libSQL / SQLite)
-- Apply with: npm run init-db  (see scripts/init-db.mjs)

CREATE TABLE IF NOT EXISTS notes (
  id          TEXT PRIMARY KEY,            -- short random id (base64url)
  text        TEXT NOT NULL CHECK (length(text) <= 240),
  author      TEXT CHECK (author IS NULL OR length(author) <= 32),
  email_enc   TEXT,                        -- AES-256-GCM blob, NULL if no email left
  created_at  INTEGER NOT NULL,            -- unix epoch seconds
  plus_total  INTEGER NOT NULL DEFAULT 0,
  plus_recent REAL    NOT NULL DEFAULT 0,  -- decayed nightly by the cron; drives "trending"
  status      TEXT NOT NULL DEFAULT 'visible'  -- visible | hidden | removed
);

CREATE INDEX IF NOT EXISTS idx_notes_wall     ON notes(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_top      ON notes(status, plus_total DESC);
CREATE INDEX IF NOT EXISTS idx_notes_trending ON notes(status, plus_recent DESC);

CREATE TABLE IF NOT EXISTS feedback (
  id         TEXT PRIMARY KEY,
  text       TEXT NOT NULL CHECK (length(text) <= 1000),
  email      TEXT,
  created_at INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'new'   -- new | read | archived
);

CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at DESC);

-- Sliding-window rate limiter. No raw IPs: `key` holds a salted HMAC of the IP.
-- Rows are purged after 30 days by the nightly cron (data minimization).
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0
);
