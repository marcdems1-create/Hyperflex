-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION: vote consensus columns
-- Adds yes_votes / no_votes to markets table so displayed percentages
-- reflect ONLY actual user predictions, not CPMM seed pools.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add columns
ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS yes_votes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS no_votes  integer NOT NULL DEFAULT 0;

-- 2. Backfill from existing positions (count of bets per side per market)
UPDATE markets m
SET
  yes_votes = (
    SELECT COUNT(*) FROM positions p
    WHERE p.market_id = m.id AND UPPER(p.side) = 'YES'
  ),
  no_votes = (
    SELECT COUNT(*) FROM positions p
    WHERE p.market_id = m.id AND UPPER(p.side) = 'NO'
  );

-- 3. Index for any reporting queries
CREATE INDEX IF NOT EXISTS markets_votes_idx ON markets (yes_votes, no_votes);
