-- Cached cross-platform positions synced hourly by syncAllUserPositions()
CREATE TABLE IF NOT EXISTS cached_positions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL CHECK (platform IN ('polymarket', 'kalshi', 'manifold')),
  external_id TEXT NOT NULL,
  market_title TEXT,
  side        TEXT CHECK (side IN ('YES', 'NO')),
  shares      NUMERIC(18,4) DEFAULT 0,
  pnl         NUMERIC(18,4) DEFAULT 0,
  probability NUMERIC(6,4)  DEFAULT 0,
  market_url  TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cached_positions_user_id    ON cached_positions (user_id);
CREATE INDEX IF NOT EXISTS idx_cached_positions_updated_at ON cached_positions (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cached_positions_platform   ON cached_positions (platform);
