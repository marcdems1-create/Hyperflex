-- ─────────────────────────────────────────────────────────────────────────────
-- HYPERFLEX — Refill History Migration
-- Run this in Supabase Dashboard → SQL Editor
-- Prerequisite: supabase_migration_community_economy.sql must be run first
-- ─────────────────────────────────────────────────────────────────────────────

-- Tracks when each user was last refilled in a community.
-- Prevents double-refills and provides an audit trail.
CREATE TABLE IF NOT EXISTS refill_history (
  id           UUID     DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID     NOT NULL,
  creator_slug TEXT     NOT NULL,
  amount       BIGINT   NOT NULL,          -- centpoints credited (100 = 1 pt)
  week_start   DATE     NOT NULL,          -- ISO Monday of the week this refill covers
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, creator_slug, week_start)  -- one refill per user per community per week
);

CREATE INDEX IF NOT EXISTS idx_rh_creator_week  ON refill_history (creator_slug, week_start);
CREATE INDEX IF NOT EXISTS idx_rh_user_creator  ON refill_history (user_id, creator_slug);
