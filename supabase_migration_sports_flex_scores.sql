-- T5 — Flex Score for Sports v1.
--
-- Materialized per-user score out of 100, five components, recomputed
-- nightly at 04:00 UTC. Primary input is the `picks` table (HFX-native
-- sports picks with signed settled_units). Supplementary CLV signal comes
-- from polymarket_trades.clv_cents where the trade's condition_id is
-- sports-tagged (see T4).
--
--   P&L         (40 pts)   log curve over net_units, saturates ~50u profit
--   Volume      (20 pts)   log curve over settled_bets, floor 25 to appear
--   Consistency (15 pts)   % of trailing-90d weeks with positive net
--   CLV         (15 pts)   avg cents beaten vs close, time-decayed
--   Diversity  (10 pts)   +10 when user is active in ≥2 sports OR ≥2 bet types
--
-- Gate for public ranking: settled_bets ≥ 25 AND total_staked_units ≥ 500
-- AND active_days ≥ 14. Below the gate, score is stored as NULL and the
-- row is visible on own profile only (not on /sports-predictors).

BEGIN;

CREATE TABLE IF NOT EXISTS sports_flex_scores (
  user_id              TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  score                INTEGER,               -- NULL when user below threshold gate
  pnl_component        NUMERIC(5,2),
  volume_component     NUMERIC(5,2),
  consistency_component NUMERIC(5,2),
  clv_component        NUMERIC(5,2),
  diversity_component  NUMERIC(5,2),
  settled_bets         INTEGER DEFAULT 0,
  total_staked_units   NUMERIC(10,2) DEFAULT 0,
  net_units            NUMERIC(10,2) DEFAULT 0,
  active_days          INTEGER DEFAULT 0,
  distinct_sports      INTEGER DEFAULT 0,
  distinct_bet_types   INTEGER DEFAULT 0,
  avg_clv_cents        NUMERIC(6,2),
  qualifies            BOOLEAN DEFAULT FALSE,
  computed_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sfs_score          ON sports_flex_scores (score DESC NULLS LAST) WHERE qualifies = TRUE;
CREATE INDEX IF NOT EXISTS idx_sfs_computed_at    ON sports_flex_scores (computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sfs_qualifies      ON sports_flex_scores (qualifies);

COMMIT;
