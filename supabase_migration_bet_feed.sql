-- Migration: bet_feed (Phase 2)
--
-- Live action feed of every trade routed through HYPERFLEX. Distinct
-- from `takes` (predictions with thesis + agree/disagree counts) and
-- from `polymarket_v2_trades` (V2 observability for the trade engine).
-- The bet feed is a public, write-only-then-read append log that
-- powers the live "what's happening right now" surface on /market and
-- /feed: tap a chip, your bet pings the feed, everyone watching sees
-- it slide in within seconds.
--
-- Per Phase 2 spec — mirrors the requested schema exactly so the
-- Phase 3 copy-trade wiring can find the row by id without translation.
-- copied_from_user_id + copied_from_bet_id columns are added here so
-- Phase 3 doesn't need a follow-up migration.

CREATE TABLE IF NOT EXISTS bet_feed (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  market_id TEXT NOT NULL,
  market_title TEXT NOT NULL,
  market_slug TEXT,
  outcome_id TEXT NOT NULL,
  outcome_label TEXT,
  side TEXT NOT NULL CHECK (side IN ('YES','NO')),
  price NUMERIC NOT NULL,
  size NUMERIC NOT NULL,
  usd_amount NUMERIC NOT NULL,
  order_id TEXT,
  -- Phase 3 viral-coefficient tracking. Fresh user-initiated bets have
  -- both NULL; bets placed via "Copy this bet" carry the source row's
  -- user_id + id so we can compute copy depth and rate.
  copied_from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  copied_from_bet_id BIGINT REFERENCES bet_feed(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot reads:
--   feed page: SELECT * FROM bet_feed ORDER BY id DESC LIMIT 50
--   user profile: WHERE user_id = $1 ORDER BY id DESC LIMIT 50
-- Both covered by the (id DESC) and (user_id, id DESC) indexes.
CREATE INDEX IF NOT EXISTS idx_bet_feed_id_desc      ON bet_feed(id DESC);
CREATE INDEX IF NOT EXISTS idx_bet_feed_user_id_desc ON bet_feed(user_id, id DESC);
-- Phase 3 viral-rate analytics: COUNT(*) FILTER (WHERE copied_from_bet_id = X)
CREATE INDEX IF NOT EXISTS idx_bet_feed_copied_from  ON bet_feed(copied_from_bet_id) WHERE copied_from_bet_id IS NOT NULL;
