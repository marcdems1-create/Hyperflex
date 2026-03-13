-- ════════════════════════════════════════════════════════════
-- HYPERFLEX — Community Economy Migration
-- Run this in Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════

-- 1. Per-community point balances
--    Each user has an independent balance per creator community.
CREATE TABLE IF NOT EXISTS community_balances (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID        NOT NULL,
  creator_slug  TEXT        NOT NULL,
  balance       BIGINT      NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, creator_slug)
);

CREATE INDEX IF NOT EXISTS idx_cb_user_creator ON community_balances (user_id, creator_slug);
CREATE INDEX IF NOT EXISTS idx_cb_creator      ON community_balances (creator_slug);

-- 2. Economy controls on creator_settings
ALTER TABLE creator_settings
  ADD COLUMN IF NOT EXISTS starting_balance  BIGINT   NOT NULL DEFAULT 100000,  -- 1,000 pts
  ADD COLUMN IF NOT EXISTS min_bet           BIGINT   NOT NULL DEFAULT 1000,     -- 10 pts
  ADD COLUMN IF NOT EXISTS max_bet           BIGINT,                             -- NULL = no cap
  ADD COLUMN IF NOT EXISTS refill_enabled    BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refill_amount     BIGINT   NOT NULL DEFAULT 10000,    -- 100 pts
  ADD COLUMN IF NOT EXISTS refill_cadence    TEXT     NOT NULL DEFAULT 'weekly', -- weekly|daily|monthly
  ADD COLUMN IF NOT EXISTS activity_gate     INT      NOT NULL DEFAULT 5;        -- bets required for refill
