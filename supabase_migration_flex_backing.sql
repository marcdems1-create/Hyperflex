-- ════════════════════════════════════════════════════════════
-- HYPERFLEX — Reputation-Backing Phase 1: discrete settlement (Model A)
-- Run in Railway Postgres (TablePlus / Railway SQL console) — filename keeps
-- the legacy supabase_migration_* prefix for git-history continuity only.
-- REQUIRES supabase_migration_flex_wallet_balance.sql (Phase 0) already run.
-- ════════════════════════════════════════════════════════════
--
-- Approved design: PHASE1_BACKING_DESIGN.md. Discrete per-call settlement,
-- not a continuous bonding-curve price — a backed predictor's newly-
-- resolved DURABLE trades move backers' stakes directly, using the same
-- capped-ROI math the scoring pipeline already computes. Never touches
-- _computeRoiLeaderboard/_buildTraderCards or any scored field — record
-- flows into settlement, never the reverse.

-- One row per (backer, predictor) relationship. staked_centpoints is LIVE —
-- it moves via settlement (compounds up on wins, down on losses), it is not
-- a static snapshot of what was originally staked.
CREATE TABLE IF NOT EXISTS flex_backings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backer_address     TEXT NOT NULL,
  predictor_user_id  UUID NOT NULL REFERENCES users(id),
  staked_centpoints  BIGINT NOT NULL DEFAULT 0 CHECK (staked_centpoints >= 0),
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One ACTIVE backing per (backer, predictor) pair — a second "back" call
-- tops up the existing active backing (see the ON CONFLICT upsert in
-- server.js) rather than creating a second row to track.
CREATE UNIQUE INDEX IF NOT EXISTS idx_flex_backings_one_active_per_pair
  ON flex_backings (backer_address, predictor_user_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_flex_backings_predictor_active ON flex_backings (predictor_user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_flex_backings_backer ON flex_backings (backer_address);

-- Append-only settlement audit trail — the source of truth for how
-- staked_centpoints arrived at its current value. Plays the same
-- architectural role for the STAKED balance that flex_wallet_ledger plays
-- for the WALLET balance: one ledger per balance, never shared, never
-- skipped. trade_id references realized_trades.id but is NOT declared as a
-- foreign key here (this migration doesn't own that table's schema).
CREATE TABLE IF NOT EXISTS flex_backing_settlements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backing_id        UUID NOT NULL REFERENCES flex_backings(id),
  trade_id          UUID NOT NULL,
  capped_roi        NUMERIC NOT NULL,
  delta_centpoints  BIGINT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- THE load-bearing safety constraint: a given (backing, trade) pair can
-- only ever settle once, enforced at the DB level exactly like Phase 0's
-- one-grant-per-address index. A concurrent/retried settlement attempt for
-- an already-settled trade hits this and fails with a unique-violation
-- (23505), which the application layer treats as an expected no-op.
CREATE UNIQUE INDEX IF NOT EXISTS idx_flex_backing_settlements_once
  ON flex_backing_settlements (backing_id, trade_id);

CREATE INDEX IF NOT EXISTS idx_flex_backing_settlements_backing ON flex_backing_settlements (backing_id, created_at);
