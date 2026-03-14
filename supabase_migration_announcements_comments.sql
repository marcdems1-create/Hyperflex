-- ════════════════════════════════════════════════════════════
-- HYPERFLEX — Announcements + Comments + Resolution Note
-- Run in Supabase SQL Editor
-- ════════════════════════════════════════════════════════════

-- 1. Creator announcements (posts visible on community page)
CREATE TABLE IF NOT EXISTS creator_announcements (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_slug TEXT        NOT NULL REFERENCES creator_settings(slug) ON DELETE CASCADE,
  title        TEXT        NOT NULL,
  body         TEXT,
  pinned       BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_announcements_slug ON creator_announcements (creator_slug, created_at DESC);

-- 2. Market comments (members discuss markets)
CREATE TABLE IF NOT EXISTS market_comments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id    UUID        NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  creator_slug TEXT        NOT NULL,
  user_id      UUID        NOT NULL,
  user_name    TEXT,
  body         TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comments_market ON market_comments (market_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_comments_user   ON market_comments (user_id);

-- 3. Resolution note on markets (shown to community when market resolves)
ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS resolution_note TEXT;
