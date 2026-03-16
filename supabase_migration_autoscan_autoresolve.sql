-- ============================================================
-- Migration: Auto-Scan + Auto-Resolve columns
-- Run this in the Supabase SQL editor
-- ============================================================

-- creator_settings: YouTube auto-scan columns
ALTER TABLE creator_settings
  ADD COLUMN IF NOT EXISTS youtube_channel_id   TEXT,
  ADD COLUMN IF NOT EXISTS auto_scan_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_scan_cadence     TEXT    NOT NULL DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS auto_scan_last_run    TIMESTAMPTZ;

-- markets: resolution_outcome column for auto-resolve tracking
-- (resolution_note already exists from earlier migration)
ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS resolution_outcome    TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at           TIMESTAMPTZ;

-- Index for auto-resolve query (expired unresolved markets with source)
CREATE INDEX IF NOT EXISTS idx_markets_auto_resolve
  ON markets (resolved, expiry_date)
  WHERE resolved = FALSE AND resolution_source IS NOT NULL;

-- Index for per-creator auto-scan query
CREATE INDEX IF NOT EXISTS idx_creator_settings_auto_scan
  ON creator_settings (auto_scan_enabled)
  WHERE auto_scan_enabled = TRUE;
