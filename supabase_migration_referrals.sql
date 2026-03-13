-- ─────────────────────────────────────────────────────────────────────────────
-- HYPERFLEX — Referral System Migration
-- Run this in Supabase Dashboard → SQL Editor
-- Prerequisites: supabase_migration_community_economy.sql must be run first
-- ─────────────────────────────────────────────────────────────────────────────

-- Tracks successful referrals per community.
-- UNIQUE on (referred_id, creator_slug) ensures one referral per user per community.
CREATE TABLE IF NOT EXISTS referral_history (
  id              UUID     DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id     UUID     NOT NULL,       -- the user who shared the link
  referred_id     UUID     NOT NULL,       -- the new user who signed up via the link
  creator_slug    TEXT     NOT NULL,       -- which community this referral is for
  referrer_reward BIGINT   NOT NULL,       -- centpoints credited to the referrer
  welcome_bonus   BIGINT   NOT NULL,       -- centpoints credited to the referred user
  cap_exceeded    BOOLEAN  NOT NULL DEFAULT false,  -- true if referrer was at weekly cap (bonus still given, reward skipped)
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (referred_id, creator_slug)       -- one referral record per user per community
);

CREATE INDEX IF NOT EXISTS idx_rh_referrer_slug ON referral_history (referrer_id, creator_slug, created_at);
CREATE INDEX IF NOT EXISTS idx_rh_referred_slug ON referral_history (referred_id, creator_slug);

-- Referral reward amounts on creator_settings.
-- referral_reward: centpoints given to the referrer per successful referral (default 100 pts)
-- welcome_bonus:   centpoints given to the new user (default 50 pts)
ALTER TABLE creator_settings
  ADD COLUMN IF NOT EXISTS referral_reward BIGINT NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS welcome_bonus   BIGINT NOT NULL DEFAULT 5000;
