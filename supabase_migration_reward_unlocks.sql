-- Migration: reward_unlocks
-- Tracks when a community member's balance crosses a creator reward threshold.
-- Each (user_id, reward_id) pair is unique — unlocks are recorded once only.
-- unlocked_at is used as the activity feed timestamp.

CREATE TABLE IF NOT EXISTS reward_unlocks (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL,
  creator_slug     TEXT        NOT NULL,
  reward_id        UUID        NOT NULL,
  reward_title     TEXT        NOT NULL,
  reward_threshold INTEGER     NOT NULL,  -- in points (same unit as creator_rewards.threshold)
  unlocked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent duplicate unlock events per user per reward
CREATE UNIQUE INDEX IF NOT EXISTS reward_unlocks_unique
  ON reward_unlocks (user_id, reward_id);

-- Index for activity feed query (latest first)
CREATE INDEX IF NOT EXISTS reward_unlocks_ts_idx
  ON reward_unlocks (unlocked_at DESC);

-- Index for per-creator queries (leaderboard enrichment)
CREATE INDEX IF NOT EXISTS reward_unlocks_slug_idx
  ON reward_unlocks (creator_slug, unlocked_at DESC);
