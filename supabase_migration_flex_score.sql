-- Unified Flex Score — schema.
--
-- Persists the output of computeFlexScore(stats) from lib/flex-score.js
-- directly onto `users`. Single-surface per Charter §8: one score per user,
-- read from profiles + leaderboards, not sprinkled across the product.
--
-- Column breakdown lives alongside the score so the profile UI can render
-- the component waterfall without a second query.
--
-- Seasonal history (Charter §8 plus earlier signoff): every Mon 00:00 UTC
-- of a new quarter, the current score + components snapshot into
-- flex_season_history before the new season starts accumulating. All-Time
-- score keeps computing; the per-season row is a fixed archive.
--
-- Idempotent: all ADD COLUMNs use IF NOT EXISTS.

BEGIN;

-- ── users.flex_score core ─────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS flex_score              INTEGER;           -- 0..100, NULL before qualifying (25 settled)
ALTER TABLE users ADD COLUMN IF NOT EXISTS flex_tier               TEXT;              -- 'Oracle'|'Sharp'|'Solid'|'Speculator'|'Building'
ALTER TABLE users ADD COLUMN IF NOT EXISTS flex_qualifies          BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS flex_settled_events     INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS flex_raw_win_rate       NUMERIC(6,4);      -- uncapped, for UI display

-- Component breakdown (each 0..max_pts, rounded to 2dp inside the formula)
ALTER TABLE users ADD COLUMN IF NOT EXISTS flex_c_accuracy         NUMERIC(5,2);      -- 0..35
ALTER TABLE users ADD COLUMN IF NOT EXISTS flex_c_calibration      NUMERIC(5,2);      -- 0..25
ALTER TABLE users ADD COLUMN IF NOT EXISTS flex_c_pnl              NUMERIC(5,2);      -- 0..20
ALTER TABLE users ADD COLUMN IF NOT EXISTS flex_c_consistency      NUMERIC(5,2);      -- 0..10
ALTER TABLE users ADD COLUMN IF NOT EXISTS flex_c_breadth          NUMERIC(5,2);      -- 0..10

ALTER TABLE users ADD COLUMN IF NOT EXISTS flex_computed_at        TIMESTAMPTZ;

-- Leaderboard sort key. Partial index so only qualified users occupy the
-- hot path; unqualified rows (NULL score) aren't in the index at all.
CREATE INDEX IF NOT EXISTS idx_users_flex_score
  ON users (flex_score DESC NULLS LAST)
  WHERE flex_qualifies = TRUE;

-- Tier filter for category leaderboards
CREATE INDEX IF NOT EXISTS idx_users_flex_tier
  ON users (flex_tier)
  WHERE flex_qualifies = TRUE;

-- Recency filter for "active this season" queries
CREATE INDEX IF NOT EXISTS idx_users_flex_computed_at
  ON users (flex_computed_at DESC NULLS LAST);

-- ── flex_season_history ───────────────────────────────────────────────────
-- One row per (user_id, season) snapshot. Written by the quarterly cron at
-- the moment a new season begins; past seasons render as mini-cards on the
-- profile page. All-Time Flex Score on users.flex_score keeps accumulating
-- (never reset).
CREATE TABLE IF NOT EXISTS flex_season_history (
  user_id            TEXT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season             TEXT         NOT NULL,   -- canonical 'YYYY-QN' e.g. '2026-Q2'
  score              INTEGER,
  tier               TEXT,
  qualifies          BOOLEAN      DEFAULT FALSE,
  settled_events     INTEGER      DEFAULT 0,
  raw_win_rate       NUMERIC(6,4),
  net_pnl            NUMERIC(12,2),
  c_accuracy         NUMERIC(5,2),
  c_calibration      NUMERIC(5,2),
  c_pnl              NUMERIC(5,2),
  c_consistency      NUMERIC(5,2),
  c_breadth          NUMERIC(5,2),
  snapshot_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, season)
);

-- Leaderboard by-season lookup
CREATE INDEX IF NOT EXISTS idx_fsh_season_score
  ON flex_season_history (season, score DESC NULLS LAST)
  WHERE qualifies = TRUE;

-- Profile: list a user's past seasons chronologically
CREATE INDEX IF NOT EXISTS idx_fsh_user_recent
  ON flex_season_history (user_id, snapshot_at DESC);

COMMIT;
