-- ════════════════════════════════════════════════════════════
-- HYPERFLEX — Reputation-Backing Phase 1 fix: address-keyed schema (v2)
-- Run in Railway Postgres (TablePlus / Railway SQL console).
-- ════════════════════════════════════════════════════════════
--
-- Fixes a real production bug: the original migration
-- (supabase_migration_flex_backing.sql) declared
-- `predictor_user_id UUID NOT NULL REFERENCES users(id)` — but users.id is
-- actually TEXT in this schema, not UUID (confirmed by the production
-- error "operator does not exist: text = uuid" when the settlement cron's
-- JOIN compared them directly, not by re-deriving it from theory). This is
-- the exact two-identity-systems problem (EOA/address vs internal id) that
-- has bitten this codebase before this week already, in a different
-- subsystem.
--
-- Fix: flex_backings and flex_backing_settlements are rebuilt keyed
-- entirely on predictor_address (TEXT) — the SAME identity Phase 0's
-- flex_wallet_balance already uses. No users.id anywhere in this
-- subsystem's own bookkeeping; the settlement cron resolves
-- predictor_address -> an internal id ONLY at the point it actually needs
-- one (to query realized_trades, which is genuinely id-keyed — a separate,
-- pre-existing, correct fact about that table, not part of this bug).
--
-- SAFE TO RUN: every "back a predictor" attempt against the old schema
-- failed with the type error before any stake could be recorded (confirmed
-- — "nothing staked, balance unchanged"), so flex_backings and
-- flex_backing_settlements are empty. This drops and recreates both
-- tables rather than an in-place ALTER, since the column identity itself
-- (UUID -> TEXT, dropping the broken FK) is changing, not just its
-- contents. If you want to double-check there's really nothing to lose
-- before running this, run first:
--   SELECT COUNT(*) FROM flex_backings;
-- (should be 0).

DROP TABLE IF EXISTS flex_backing_settlements;
DROP TABLE IF EXISTS flex_backings;

CREATE TABLE flex_backings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backer_address     TEXT NOT NULL,
  predictor_address  TEXT NOT NULL,
  staked_centpoints  BIGINT NOT NULL DEFAULT 0 CHECK (staked_centpoints >= 0),
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_flex_backings_one_active_per_pair
  ON flex_backings (backer_address, predictor_address) WHERE status = 'active';

CREATE INDEX idx_flex_backings_predictor_active ON flex_backings (predictor_address) WHERE status = 'active';
CREATE INDEX idx_flex_backings_backer ON flex_backings (backer_address);

CREATE TABLE flex_backing_settlements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backing_id        UUID NOT NULL REFERENCES flex_backings(id),
  trade_id          UUID NOT NULL,
  capped_roi        NUMERIC NOT NULL,
  delta_centpoints  BIGINT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Same load-bearing safety constraint as before: a given (backing, trade)
-- pair can only ever settle once, at the DB level.
CREATE UNIQUE INDEX idx_flex_backing_settlements_once
  ON flex_backing_settlements (backing_id, trade_id);

CREATE INDEX idx_flex_backing_settlements_backing ON flex_backing_settlements (backing_id, created_at);
