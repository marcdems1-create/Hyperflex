-- Price Alerts — smart price alerts on Polymarket markets
-- Migration #43

-- Users set threshold alerts on markets, cron checks prices, fires notifications
CREATE TABLE IF NOT EXISTS price_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  condition_id TEXT NOT NULL,
  slug TEXT,
  question TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('above', 'below')),
  threshold NUMERIC(5,4) NOT NULL,  -- price as 0.0000-1.0000
  side TEXT NOT NULL DEFAULT 'yes' CHECK (side IN ('yes', 'no')),
  triggered BOOLEAN NOT NULL DEFAULT false,
  triggered_at TIMESTAMPTZ,
  triggered_price NUMERIC(5,4),
  snoozed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_price_alerts_user ON price_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_active ON price_alerts(triggered, snoozed_until) WHERE triggered = false;
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_alerts_unique ON price_alerts(user_id, condition_id, direction, threshold, side);

-- RLS policies
ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;

-- Users can manage their own alerts
CREATE POLICY "Users manage own alerts" ON price_alerts FOR ALL USING (auth.uid() = user_id);

-- Service role can manage all alerts (server-side cron)
CREATE POLICY "Service role full access price_alerts" ON price_alerts FOR ALL USING (true) WITH CHECK (true);
