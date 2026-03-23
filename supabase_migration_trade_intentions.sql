-- Migration: Trade intentions (Kelly calculator decisions)
-- Run this in Supabase SQL editor

CREATE TABLE IF NOT EXISTS trade_intentions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  market TEXT NOT NULL,
  side TEXT NOT NULL DEFAULT 'YES',
  market_pct NUMERIC DEFAULT 0,
  whale_pct NUMERIC DEFAULT 0,
  bankroll NUMERIC DEFAULT 0,
  kelly_fraction NUMERIC DEFAULT 0.5,
  url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS trade_intentions_user_idx ON trade_intentions (user_id, created_at DESC);
