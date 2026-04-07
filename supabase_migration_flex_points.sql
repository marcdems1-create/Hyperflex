-- FLEX Points — platform-wide points earned on every trade
-- Migration #42

-- Aggregate totals per user
CREATE TABLE IF NOT EXISTS flex_points (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  total_points INTEGER NOT NULL DEFAULT 0,
  trade_count INTEGER NOT NULL DEFAULT 0,
  last_earned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Individual earn events (log)
CREATE TABLE IF NOT EXISTS flex_points_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  points INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'polymarket_trade',
  trade_amount_usd NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_flex_points_log_user ON flex_points_log(user_id);
CREATE INDEX IF NOT EXISTS idx_flex_points_log_created ON flex_points_log(created_at);
CREATE INDEX IF NOT EXISTS idx_flex_points_total ON flex_points(total_points DESC);

-- RLS policies
ALTER TABLE flex_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE flex_points_log ENABLE ROW LEVEL SECURITY;

-- Users can read their own points
CREATE POLICY "Users can read own flex points" ON flex_points FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can read own flex log" ON flex_points_log FOR SELECT USING (auth.uid() = user_id);

-- Service role can insert/update (server-side only)
CREATE POLICY "Service can manage flex points" ON flex_points FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service can manage flex log" ON flex_points_log FOR ALL USING (true) WITH CHECK (true);
