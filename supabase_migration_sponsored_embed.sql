-- Migration: sponsored markets + embed join attribution
-- Part of the creator monetization & growth tracking update.

-- 1. Sponsored markets
--    Creator can attach a brand/sponsor name to any market.
--    Shown as a "Sponsored" badge on the community page.
ALTER TABLE markets ADD COLUMN IF NOT EXISTS sponsor_name TEXT;

-- 2. Embed join attribution
--    Track where each community member came from: 'direct', 'embed', 'referral'.
--    Lets creators see how many members joined via their embedded widget.
--    DEFAULT 'direct' so all existing rows are unaffected.
ALTER TABLE community_balances ADD COLUMN IF NOT EXISTS join_source TEXT NOT NULL DEFAULT 'direct';

-- Index for fast per-creator embed stats queries
CREATE INDEX IF NOT EXISTS community_balances_join_source_idx
  ON community_balances (creator_slug, join_source);
