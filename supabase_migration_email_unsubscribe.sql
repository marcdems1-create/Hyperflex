-- Migration: email_unsubscribe
-- Adds one-click unsubscribe support to member and creator email sends.
-- Run this in the Supabase SQL editor.

-- Members (users table)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_unsubscribe_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_unsubscribed BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS users_unsubscribe_token_idx ON users (email_unsubscribe_token);

-- Creators (creator_settings table)
ALTER TABLE creator_settings ADD COLUMN IF NOT EXISTS email_unsubscribe_token TEXT;
ALTER TABLE creator_settings ADD COLUMN IF NOT EXISTS email_unsubscribed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE creator_settings ADD COLUMN IF NOT EXISTS last_milestone_notified INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS creator_settings_unsubscribe_token_idx ON creator_settings (email_unsubscribe_token);
