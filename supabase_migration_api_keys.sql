-- Migration: API key column on creator_settings
-- Run this in Supabase SQL editor

ALTER TABLE creator_settings ADD COLUMN IF NOT EXISTS api_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS creator_settings_api_key_idx ON creator_settings (api_key) WHERE api_key IS NOT NULL;
