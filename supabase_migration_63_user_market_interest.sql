-- Migration #63 — user_market_interest (2026-08-12)
--
-- One row per (user, token_id) a user has actually traded, used to power
-- personalized market suggestions (GET /api/member/:userId/suggested-markets).
-- Populated two ways: live, fire-and-forget from /api/polymarket/order on
-- every accepted V2 order, and historically via a one-time backfill from
-- polymarket_v2_trades (scripts/backfill-user-market-interest.js).
--
-- Auto-applied on boot via server.js auto-migration block, mirroring the
-- migration #62 prediction_thesis pattern.

CREATE TABLE IF NOT EXISTS user_market_interest (
  id               BIGSERIAL PRIMARY KEY,
  -- users.id is TEXT on Railway, not uuid — see migration #62 for the
  -- boot-log incident that documents why this must be text, not uuid.
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_id         TEXT NOT NULL,
  condition_id     TEXT,
  question         TEXT,
  category         TEXT NOT NULL DEFAULT 'other',
  side             SMALLINT,
  trade_count      INT NOT NULL DEFAULT 1,
  first_traded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_traded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, token_id)
);

CREATE INDEX IF NOT EXISTS idx_user_market_interest_user
  ON user_market_interest(user_id);
CREATE INDEX IF NOT EXISTS idx_user_market_interest_category
  ON user_market_interest(user_id, category);
