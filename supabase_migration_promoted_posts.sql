-- Migration: Promoted posts infrastructure
-- Run in Railway Postgres

-- Add promoted fields to takes table
ALTER TABLE takes ADD COLUMN IF NOT EXISTS is_promoted BOOLEAN DEFAULT false;
ALTER TABLE takes ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ;
ALTER TABLE takes ADD COLUMN IF NOT EXISTS promoted_by TEXT; -- admin user who promoted it
ALTER TABLE takes ADD COLUMN IF NOT EXISTS promotion_budget_usd NUMERIC(10,2) DEFAULT 0;
ALTER TABLE takes ADD COLUMN IF NOT EXISTS promotion_impressions INTEGER DEFAULT 0;
ALTER TABLE takes ADD COLUMN IF NOT EXISTS promotion_clicks INTEGER DEFAULT 0;
ALTER TABLE takes ADD COLUMN IF NOT EXISTS promotion_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_takes_promoted ON takes(is_promoted) WHERE is_promoted = true;
