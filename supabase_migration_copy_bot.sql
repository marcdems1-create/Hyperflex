-- Copy Bot tables for whale trade auto-copying
-- Run after all previous migrations

CREATE TABLE IF NOT EXISTS copy_bot_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  whale_address TEXT NOT NULL,
  whale_name TEXT,
  allocation NUMERIC(12,2) DEFAULT 100,
  active BOOLEAN DEFAULT true,
  notify_only BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, whale_address)
);

CREATE TABLE IF NOT EXISTS copy_bot_trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subscription_id UUID NOT NULL,
  user_id UUID NOT NULL,
  whale_address TEXT NOT NULL,
  market TEXT,
  side TEXT,
  size NUMERIC(12,2),
  price NUMERIC(6,4),
  status TEXT DEFAULT 'pending',
  order_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_cbs_user_active ON copy_bot_subscriptions(user_id, active);
CREATE INDEX IF NOT EXISTS idx_cbs_whale ON copy_bot_subscriptions(whale_address, active);
CREATE INDEX IF NOT EXISTS idx_cbt_user ON copy_bot_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_cbt_sub ON copy_bot_trades(subscription_id);
