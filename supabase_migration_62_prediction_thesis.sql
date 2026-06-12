-- Migration #62 — Prediction Thesis v1 (PR #173, 2026-05-15)
--
-- New product object: narrative parlay. User-authored bundle of 2-10
-- active Polymarket positions packaged as a single tracked thesis.
-- Resolves leg-by-leg into HIT / PARTIAL / MISS (resolution cron lands
-- in PR #174). Strict mode only — original entry prices are
-- load-bearing for resolution, immutability is the product.
--
-- Auto-applied on boot via server.js auto-migration block, mirroring
-- the migration #61 mention_markets pattern.

CREATE TABLE IF NOT EXISTS prediction_thesis (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- users.id is TEXT on Railway, not uuid — a uuid FK here "cannot be
  -- implemented" and aborts the whole CREATE (June 2026 boot-log fix).
  user_id           text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             text NOT NULL CHECK (char_length(title) <= 80),
  rationale         text CHECK (char_length(rationale) <= 500),
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  locked_hash       text NOT NULL,
  resolved_at       timestamptz,
  resolution_state  text NOT NULL DEFAULT 'open'
                    CHECK (resolution_state IN ('open', 'hit', 'partial', 'miss')),
  legs_total        int NOT NULL DEFAULT 0,
  legs_won          int NOT NULL DEFAULT 0,
  legs_lost         int NOT NULL DEFAULT 0,
  legs_pushed       int NOT NULL DEFAULT 0,
  total_stake_usd   numeric(20,2),
  total_pnl_usd     numeric(20,2),
  code_version      text
);
CREATE INDEX IF NOT EXISTS idx_thesis_user
  ON prediction_thesis(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_thesis_state
  ON prediction_thesis(resolution_state)
  WHERE resolution_state = 'open';

CREATE TABLE IF NOT EXISTS prediction_thesis_leg (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thesis_id         uuid NOT NULL REFERENCES prediction_thesis(id) ON DELETE CASCADE,
  leg_order         int NOT NULL CHECK (leg_order BETWEEN 1 AND 10),
  condition_id      text NOT NULL,
  token_id          text,
  market_question   text NOT NULL,
  direction         text NOT NULL CHECK (direction IN ('yes', 'no')),
  entry_price       numeric(6,4) NOT NULL CHECK (entry_price > 0 AND entry_price < 1),
  stake_usd         numeric(20,2) NOT NULL CHECK (stake_usd > 0),
  resolution        text CHECK (resolution IN ('won', 'lost', 'pushed')),
  resolved_at       timestamptz,
  realized_pnl      numeric(20,2),
  UNIQUE(thesis_id, leg_order)
);
CREATE INDEX IF NOT EXISTS idx_thesis_leg_thesis
  ON prediction_thesis_leg(thesis_id);
CREATE INDEX IF NOT EXISTS idx_thesis_leg_condition
  ON prediction_thesis_leg(condition_id)
  WHERE resolution IS NULL;
