-- Migration: add plan columns to users table
-- Allows gifting Premium to any user (including crypto wallet members)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS plan_trial_expires_at TIMESTAMPTZ;
