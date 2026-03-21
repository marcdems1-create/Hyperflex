-- Migration: market_snapshots table for historical Polymarket price tracking
-- Run as #31 in the migration order

CREATE TABLE IF NOT EXISTS market_snapshots (
  id BIGSERIAL PRIMARY KEY,
  market_id TEXT NOT NULL,
  question TEXT,
  yes_price NUMERIC(6,4),
  volume NUMERIC(14,2),
  snapshot_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_market ON market_snapshots(market_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_time ON market_snapshots(snapshot_at);
