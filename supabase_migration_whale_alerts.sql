-- Whale alerts: users subscribe to get notified when a specific whale trader makes moves
CREATE TABLE IF NOT EXISTS whale_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  trader_wallet TEXT NOT NULL,
  trader_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, trader_wallet)
);
CREATE INDEX IF NOT EXISTS idx_whale_alerts_user ON whale_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_whale_alerts_wallet ON whale_alerts(trader_wallet);
