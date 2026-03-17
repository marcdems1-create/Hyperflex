-- Migration: creator_follows
-- Members can follow creator communities from explore or profile pages.
-- Followed creators' markets get prioritized in the member's explore feed.

CREATE TABLE IF NOT EXISTS creator_follows (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL,
  creator_slug TEXT        NOT NULL,
  followed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS creator_follows_unique
  ON creator_follows (user_id, creator_slug);

CREATE INDEX IF NOT EXISTS creator_follows_user_idx
  ON creator_follows (user_id);

CREATE INDEX IF NOT EXISTS creator_follows_slug_idx
  ON creator_follows (creator_slug);
