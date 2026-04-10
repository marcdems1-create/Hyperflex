-- Migration: Daily login streak tracking
-- Adds login_streak, last_login_date, streak_multiplier to users

ALTER TABLE users ADD COLUMN IF NOT EXISTS login_streak INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_date TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_multiplier NUMERIC DEFAULT 1;
