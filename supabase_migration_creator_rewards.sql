-- ────────────────────────────────────────────────────────────────────────────
-- MIGRATION: creator_rewards table
-- Point-threshold rewards that creators set for their community.
-- Members who hit a threshold are shown the reward on the community page.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS creator_rewards (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id   UUID        NOT NULL,
  threshold    INTEGER     NOT NULL,        -- points required (display pts, not centpoints)
  title        TEXT        NOT NULL,        -- e.g. "🏆 Gold Predictor"
  description  TEXT        NOT NULL DEFAULT '',  -- e.g. "DM me for a shoutout"
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creator_rewards_creator
  ON creator_rewards (creator_id, threshold ASC);
