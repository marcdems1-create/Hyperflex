-- Migration: market_disputes
-- Members can challenge a market resolution within 24 hours of it resolving.
-- Each user gets one challenge per market. Creator reviews via dashboard.
-- status: 'open' → 'upheld' (original resolution stands) or 'overturned' (re-resolved)

CREATE TABLE IF NOT EXISTS market_disputes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id   UUID        NOT NULL,
  user_id     UUID        NOT NULL,
  creator_slug TEXT       NOT NULL,
  reason      TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'open',  -- open | upheld | overturned
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One dispute per user per market
CREATE UNIQUE INDEX IF NOT EXISTS market_disputes_unique
  ON market_disputes (market_id, user_id);

CREATE INDEX IF NOT EXISTS market_disputes_market_idx
  ON market_disputes (market_id);

CREATE INDEX IF NOT EXISTS market_disputes_creator_idx
  ON market_disputes (creator_slug, status, created_at DESC);
