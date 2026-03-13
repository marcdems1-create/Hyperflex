-- Custom Domain support for Premium creators
-- Run in Supabase SQL Editor

ALTER TABLE creator_settings
  ADD COLUMN IF NOT EXISTS custom_domain        TEXT    UNIQUE,
  ADD COLUMN IF NOT EXISTS custom_domain_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS custom_domain_token  TEXT    UNIQUE,
  ADD COLUMN IF NOT EXISTS custom_domain_verified_at TIMESTAMPTZ;

-- Index for fast host-header lookup on every request
CREATE INDEX IF NOT EXISTS idx_creator_settings_custom_domain
  ON creator_settings (custom_domain)
  WHERE custom_domain IS NOT NULL AND custom_domain_verified = TRUE;
