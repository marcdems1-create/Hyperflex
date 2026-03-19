-- Copy trade subscriptions: users subscribe to get notified when another user opens new positions
CREATE TABLE IF NOT EXISTS copy_trade_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL,
  target_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(subscriber_id, target_user_id)
);
CREATE INDEX IF NOT EXISTS idx_copy_trade_target ON copy_trade_subscriptions(target_user_id);
CREATE INDEX IF NOT EXISTS idx_copy_trade_subscriber ON copy_trade_subscriptions(subscriber_id);
