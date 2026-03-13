-- Migration: plan scheduling fields
-- Stores pending Stripe plan changes so the dashboard can warn creators

ALTER TABLE creator_settings
  ADD COLUMN IF NOT EXISTS plan_scheduled_change VARCHAR,   -- 'pro', 'free', etc.
  ADD COLUMN IF NOT EXISTS plan_change_date TIMESTAMPTZ;   -- when the change takes effect
