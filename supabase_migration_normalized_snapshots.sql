-- HYPERFLEX: Normalized market snapshots for historical price tracking
-- Phase 1 Data Foundation — stores time-series price data for all platforms
-- Run this in Supabase SQL editor (migration #42)

-- Main snapshots table — one row per market per refresh cycle (~90s)
CREATE TABLE IF NOT EXISTS normalized_snapshots (
  id BIGSERIAL PRIMARY KEY,
  hfx_id TEXT NOT NULL,           -- "polymarket:slug" | "kalshi:ticker" | "sportsbook:id"
  source TEXT NOT NULL,           -- "polymarket" | "kalshi" | "sportsbook"
  title TEXT,                     -- Market question/title (for readability)
  yes_price NUMERIC(6,4),         -- 0.0000 - 1.0000
  volume NUMERIC(18,2) DEFAULT 0, -- Total volume in USD
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_ns_hfx_id_ts ON normalized_snapshots (hfx_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_ns_source_ts ON normalized_snapshots (source, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_ns_snapshot_at ON normalized_snapshots (snapshot_at DESC);

-- Cross-platform market matches (arb tracking + event dedup)
CREATE TABLE IF NOT EXISTS cross_market_refs (
  id BIGSERIAL PRIMARY KEY,
  hfx_id_a TEXT NOT NULL,
  hfx_id_b TEXT NOT NULL,
  source_a TEXT NOT NULL,
  source_b TEXT NOT NULL,
  confidence NUMERIC(4,3) DEFAULT 0,  -- Match confidence 0.000 - 1.000
  spread NUMERIC(6,4) DEFAULT 0,      -- Current price spread
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hfx_id_a, hfx_id_b)
);

CREATE INDEX IF NOT EXISTS idx_cmr_spread ON cross_market_refs (spread DESC);
CREATE INDEX IF NOT EXISTS idx_cmr_source_pair ON cross_market_refs (source_a, source_b);

-- Retention policy: keep raw snapshots for 90 days, then downsample
-- (For now, just add a comment — we'll add a cron to prune old data)
-- FUTURE: CREATE FUNCTION prune_old_snapshots() that aggregates to hourly/daily buckets

-- API keys table for the external data API (Pillar 1 revenue)
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  key_hash TEXT NOT NULL,          -- bcrypt hash of the API key
  key_prefix TEXT NOT NULL,        -- First 8 chars for display ("hfx_k1a2...")
  tier TEXT NOT NULL DEFAULT 'free', -- free | researcher | professional | institutional
  name TEXT,                        -- User-given label
  rate_limit_per_min INTEGER DEFAULT 60,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys (key_prefix) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys (user_id);
