-- Migration: dispute votes — allows community to vote on unresolved expired market outcomes
-- Run as #26 in the ordered migration list

-- dispute_type:
--   'outcome_contest'  — filed after resolution, member disagrees with outcome (existing behavior)
--   'resolution_vote'  — filed on expired unresolved market, member signals expected outcome

ALTER TABLE market_disputes
  ADD COLUMN IF NOT EXISTS dispute_type TEXT NOT NULL DEFAULT 'outcome_contest';

-- For resolution_vote disputes: 'YES' | 'NO' — the outcome the member believes is correct
ALTER TABLE market_disputes
  ADD COLUMN IF NOT EXISTS requested_outcome TEXT;

-- Unique constraint: one resolution_vote per user per market
-- (outcome_contest already has one via existing unique constraint if present)
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_disputes_resolution_vote
  ON market_disputes (market_id, user_id, dispute_type)
  WHERE dispute_type = 'resolution_vote';
