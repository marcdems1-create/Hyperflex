-- Migration: plan trial expiry
-- Adds plan_trial_expires_at to creator_settings so gifted Premium trials
-- auto-expire without manual intervention.
-- Run this in the Supabase SQL editor before deploying.

ALTER TABLE creator_settings
  ADD COLUMN IF NOT EXISTS plan_trial_expires_at TIMESTAMPTZ DEFAULT NULL;

-- Index for efficient cron query (finds all expired trials quickly)
CREATE INDEX IF NOT EXISTS idx_creator_settings_trial_expires
  ON creator_settings (plan_trial_expires_at)
  WHERE plan_trial_expires_at IS NOT NULL;
