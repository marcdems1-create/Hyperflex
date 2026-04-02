-- ══════════════════════════════════════════════════════════════════════
-- TRADE & EARN — USDC Rewards Tracking
-- Tracks referred trading volume and weekly reward payouts
-- ══════════════════════════════════════════════════════════════════════

-- Rewards tracking: stores weekly volume + payouts per user
CREATE TABLE IF NOT EXISTS rewards_tracking (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  wallet_address TEXT,
  week_start DATE NOT NULL,
  volume NUMERIC DEFAULT 0,
  tier TEXT DEFAULT 'Bronze',
  reward_amount NUMERIC DEFAULT 0,
  paid BOOLEAN DEFAULT false,
  paid_at TIMESTAMPTZ,
  tx_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast leaderboard queries
CREATE INDEX IF NOT EXISTS idx_rewards_tracking_week ON rewards_tracking(week_start, volume DESC);
CREATE INDEX IF NOT EXISTS idx_rewards_tracking_user ON rewards_tracking(user_id, week_start);

-- Supplementary click tracking for referral links
CREATE TABLE IF NOT EXISTS rewards_click_tracking (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  market_slug TEXT,
  source_page TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rewards_clicks_user ON rewards_click_tracking(user_id, created_at);
