-- HYPERFLEX — Banner Position Migration
-- Stores the focal point for the community banner image
-- Run in Supabase Dashboard → SQL Editor

ALTER TABLE creator_settings
  ADD COLUMN IF NOT EXISTS banner_position TEXT DEFAULT '50% 50%';
