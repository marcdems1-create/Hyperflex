-- Shared external positions: users sharing Kalshi/Manifold/Polymarket positions to the activity feed
CREATE TABLE IF NOT EXISTS shared_positions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question      TEXT NOT NULL,
  side          TEXT NOT NULL CHECK (side IN ('YES', 'NO')),
  platform      TEXT NOT NULL CHECK (platform IN ('kalshi', 'manifold', 'polymarket')),
  current_price NUMERIC(6,4),
  pnl_pct       INTEGER,
  cash_value    NUMERIC(12,2),
  market_url    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS shared_positions_created_at_idx ON shared_positions (created_at DESC);
CREATE INDEX IF NOT EXISTS shared_positions_user_id_idx    ON shared_positions (user_id);
