-- HYPERFLEX — Community Category Migration
-- Adds community_category to creator_settings for AI-powered market idea generation
-- Run in Supabase Dashboard → SQL Editor

ALTER TABLE creator_settings
  ADD COLUMN IF NOT EXISTS community_category TEXT DEFAULT 'other';
