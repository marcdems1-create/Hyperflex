CREATE TABLE IF NOT EXISTS cached_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('polymarket', 'kalshi', 'manifold')),
  external_id TEXT NOT NULL,
  market_title TEXT,
  side TEXT,
  shares NUMERIC DEFAULT 0,
  pnl NUMERIC DEFAULT 0,
  probability NUMERIC DEFAULT 0,
  market_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform, external_id)
);
CREATE INDEX IF NOT EXISTS idx_cached_positions_user ON cached_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_cached_positions_platform ON cached_positions(platform);
CREATE INDEX IF NOT EXISTS idx_cached_positions_updated ON cached_positions(updated_at);
