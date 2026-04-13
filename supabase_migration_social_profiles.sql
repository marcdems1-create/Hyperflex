-- Migration: Social profiles — enhanced user identity for the prediction social network
-- Adds username handles, bio, wallet verification, and computed prediction stats

ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_predictions INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS prediction_win_rate NUMERIC(5,2) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS brier_score NUMERIC(6,4);
ALTER TABLE users ADD COLUMN IF NOT EXISTS prediction_pnl NUMERIC(14,2) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS follower_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS following_count INTEGER DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL;
