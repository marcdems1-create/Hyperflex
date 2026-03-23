-- Migration: Agent configuration + decision log
-- Run this in Supabase SQL editor

CREATE TABLE IF NOT EXISTS agent_configs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  budget_per_trade NUMERIC NOT NULL DEFAULT 25,
  max_daily_spend NUMERIC NOT NULL DEFAULT 200,
  min_whales INTEGER NOT NULL DEFAULT 5,
  categories JSONB NOT NULL DEFAULT '["all"]',
  followed_whales JSONB DEFAULT '[]',
  kelly_fraction NUMERIC NOT NULL DEFAULT 0.5,
  alert_method TEXT NOT NULL DEFAULT 'push',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS agent_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_type TEXT,
  market TEXT,
  side TEXT,
  whale_count INTEGER DEFAULT 0,
  confidence TEXT,
  recommended_size NUMERIC DEFAULT 0,
  kelly_edge NUMERIC DEFAULT 0,
  action TEXT NOT NULL DEFAULT 'alert',
  url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_log_user_idx ON agent_log (user_id, created_at DESC);
