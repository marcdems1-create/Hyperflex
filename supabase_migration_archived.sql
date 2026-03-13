-- Add archived column to markets table
-- Run in Supabase SQL Editor

ALTER TABLE markets ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;

-- Backfill: any market with is_public=false and not resolved is likely archived
-- (optional — uncomment if you want to retroactively mark hidden markets as archived)
-- UPDATE markets SET archived = TRUE WHERE is_public = FALSE AND resolved = FALSE;
