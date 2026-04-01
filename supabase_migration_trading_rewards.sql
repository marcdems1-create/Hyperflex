-- Migration: Trading rewards — points from Polymarket referral revenue
-- Funded by 30% referral fee from Polymarket; users earn points for trading through HYPERFLEX

CREATE TABLE IF NOT EXISTS trading_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  points_balance INTEGER DEFAULT 0,
  points_earned INTEGER DEFAULT 0,
  points_redeemed INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trading_reward_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL,          -- 'clickthrough', 'sync_polymarket', 'sync_kalshi', 'sync_manifold', 'redemption'
  points INTEGER NOT NULL,           -- positive = earned, negative = spent
  metadata JSONB,                    -- { market_title, platform, redemption_type, etc. }
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trading_rewards_user ON trading_rewards(user_id);
CREATE INDEX IF NOT EXISTS idx_trading_reward_events_user ON trading_reward_events(user_id);
CREATE INDEX IF NOT EXISTS idx_trading_reward_events_type ON trading_reward_events(event_type);

-- Subscription credit balance (cents) on creator_settings
ALTER TABLE creator_settings ADD COLUMN IF NOT EXISTS subscription_credit_cents INTEGER DEFAULT 0;
