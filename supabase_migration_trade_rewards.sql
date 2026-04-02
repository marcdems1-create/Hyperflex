-- ══════════════════════════════════════════════════════════════════════
-- TRADE & EARN — Manual USDC Rewards Distribution
-- Admin enters weekly pool amount, system calculates shares based on
-- click activity, admin sends USDC manually to user wallets.
-- ══════════════════════════════════════════════════════════════════════

-- Rewards pool: admin enters weekly revenue amount
CREATE TABLE IF NOT EXISTS rewards_pool (
  id BIGSERIAL PRIMARY KEY,
  week_start DATE NOT NULL UNIQUE,
  pool_amount NUMERIC DEFAULT 0,
  distributed BOOLEAN DEFAULT false,
  distributed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User rewards: per-user per-week earnings
CREATE TABLE IF NOT EXISTS user_rewards (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  week_start DATE NOT NULL,
  click_count INTEGER DEFAULT 0,
  share_pct NUMERIC DEFAULT 0,
  usdc_earned NUMERIC DEFAULT 0,
  paid BOOLEAN DEFAULT false,
  paid_at TIMESTAMPTZ,
  tx_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_user_rewards_week ON user_rewards(week_start, usdc_earned DESC);
CREATE INDEX IF NOT EXISTS idx_user_rewards_user ON user_rewards(user_id, week_start);

-- Click tracking: every referral click per user
CREATE TABLE IF NOT EXISTS rewards_click_tracking (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  session_id TEXT,
  market_slug TEXT,
  source_page TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rewards_clicks_user ON rewards_click_tracking(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rewards_clicks_session ON rewards_click_tracking(session_id, created_at);

-- User payout wallet address
ALTER TABLE creator_settings ADD COLUMN IF NOT EXISTS payout_wallet TEXT;
