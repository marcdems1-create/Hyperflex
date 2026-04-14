-- Predictions: enhanced prediction post system
-- Adds new `predictions` table (richer schema than social_predictions),
-- new `follows` table with follow_reason, and user Flex Score columns.

-- ═══════════════════════════════════════════
-- PREDICTIONS (enhanced, wallet-enriched)
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS predictions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  platform          TEXT NOT NULL,              -- 'polymarket' | 'kalshi' | 'manifold'
  market_id         TEXT NOT NULL,              -- external market identifier (condition_id or slug)
  market_title      TEXT NOT NULL,
  posted_at         TIMESTAMPTZ DEFAULT now(),
  direction         TEXT NOT NULL,              -- 'YES' | 'NO'
  entry_price       NUMERIC(5,2) NOT NULL,      -- 0.00–1.00 implied prob at time of call
  position_size_usd NUMERIC,                    -- exact USD from wallet (server-side only)
  size_display      TEXT DEFAULT 'range',       -- 'exact' | 'range'
  conviction        TEXT,                       -- 'low' | 'medium' | 'high'
  thesis_text       TEXT CHECK (char_length(thesis_text) <= 500),
  category_tags     TEXT[],                     -- auto-detected, never user-entered
  resolved_at       TIMESTAMPTZ,
  outcome           TEXT DEFAULT 'pending',     -- 'correct' | 'incorrect' | 'void' | 'pending'
  brier_contribution NUMERIC,                   -- computed on resolution
  pnl_usd           NUMERIC,                    -- computed on resolution
  cascade_ids       UUID[]                      -- prediction IDs posted on same market within 24h
);

CREATE INDEX IF NOT EXISTS idx_predictions_user     ON predictions(user_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_market   ON predictions(market_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_outcome  ON predictions(outcome);
CREATE INDEX IF NOT EXISTS idx_predictions_posted   ON predictions(posted_at DESC);

-- ═══════════════════════════════════════════
-- FOLLOWS (with follow_reason)
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS follows (
  follower_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  following_id  UUID REFERENCES users(id) ON DELETE CASCADE,
  followed_at   TIMESTAMPTZ DEFAULT now(),
  follow_reason TEXT,  -- 'leaderboard' | 'prediction_card' | 'search'
  PRIMARY KEY (follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower  ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

-- ═══════════════════════════════════════════
-- USERS — Flex Score columns
-- ═══════════════════════════════════════════
ALTER TABLE users ADD COLUMN IF NOT EXISTS flex_score_90d     NUMERIC DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS flex_score_alltime NUMERIC DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS predictions_resolved INTEGER DEFAULT 0;
