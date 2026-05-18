-- Migration: prediction streak tracking
-- Adds prediction_streak (consecutive days posted) and last_prediction_date
-- to the users table. Both nullable — NULL means no streak yet.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS prediction_streak     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_prediction_date  DATE;

-- Index so the daily streak-decay cron can scan efficiently
CREATE INDEX IF NOT EXISTS idx_users_last_prediction_date
  ON users (last_prediction_date)
  WHERE last_prediction_date IS NOT NULL;
