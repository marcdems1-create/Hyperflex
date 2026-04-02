-- Watchlist + Price Alerts table
CREATE TABLE IF NOT EXISTS watchlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  market_slug TEXT NOT NULL DEFAULT '',
  market_question TEXT NOT NULL DEFAULT '',
  alert_above DECIMAL,
  alert_below DECIMAL,
  last_alerted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);
