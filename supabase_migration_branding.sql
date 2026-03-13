-- ─────────────────────────────────────────────────────────────────────────────
-- HYPERFLEX — Custom Branding Migration
-- Run this in Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE creator_settings
  ADD COLUMN IF NOT EXISTS logo_url        TEXT,
  ADD COLUMN IF NOT EXISTS banner_url      TEXT,
  ADD COLUMN IF NOT EXISTS font_choice     TEXT NOT NULL DEFAULT 'Syne',
  ADD COLUMN IF NOT EXISTS social_twitter  TEXT,
  ADD COLUMN IF NOT EXISTS social_youtube  TEXT,
  ADD COLUMN IF NOT EXISTS social_discord  TEXT,
  ADD COLUMN IF NOT EXISTS social_twitch   TEXT;
