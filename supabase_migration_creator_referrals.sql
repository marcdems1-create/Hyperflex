-- Migration: creator_referrals
-- Tracks creator-to-creator referrals via /ref/:slug links.
-- 'accepted' means the new creator published their first market
-- (set manually or via a future automation).

CREATE TABLE IF NOT EXISTS creator_referrals (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_slug     TEXT        NOT NULL,
  new_creator_slug  TEXT        NOT NULL,
  accepted          BOOLEAN     NOT NULL DEFAULT FALSE,
  accepted_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS creator_referrals_unique
  ON creator_referrals (referrer_slug, new_creator_slug);

CREATE INDEX IF NOT EXISTS creator_referrals_referrer_idx
  ON creator_referrals (referrer_slug);
