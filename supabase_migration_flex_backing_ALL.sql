-- ════════════════════════════════════════════════════════════
-- HYPERFLEX — Reputation-Backing: FULL migration, Phase 0 + Phase 1 final
-- state. Run this single script in Railway Postgres (TablePlus / Railway
-- SQL console) instead of running flex_wallet_balance.sql +
-- flex_backing.sql + flex_backing_v2.sql + flex_backing_v3.sql separately.
-- ════════════════════════════════════════════════════════════
--
-- Safe to run regardless of what you've already applied:
--   - Phase 0 (flex_wallet_balance / flex_wallet_ledger): CREATE TABLE IF
--     NOT EXISTS — never touches these even if they already exist with
--     real balances (your own wallet's 1,000 FP grant is untouched).
--   - Phase 1 (flex_backings / flex_backing_settlements): DROP + CREATE
--     with the final correct schema directly — skips straight past the
--     two bugs found this session (predictor_user_id UUID vs. users.id
--     TEXT; trade_id UUID vs. realized_trades.id BIGINT) rather than
--     replaying them. Safe because every prior attempt to write a real row
--     into either table failed with a type error first — if you want to
--     confirm that yourself before running this, check first:
--       SELECT COUNT(*) FROM flex_backings;
--     (expected: 0, or only rows you don't mind losing).

-- ── Phase 0: wallet-native Flex Points balance ──────────────────────────
CREATE TABLE IF NOT EXISTS flex_wallet_balance (
  address             TEXT PRIMARY KEY,
  balance_centpoints  BIGINT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flex_wallet_ledger (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address           TEXT NOT NULL,
  delta_centpoints  BIGINT NOT NULL,
  reason            TEXT NOT NULL,
  ref_id            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flex_wallet_ledger_address ON flex_wallet_ledger (address, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_flex_wallet_ledger_one_grant_per_address
  ON flex_wallet_ledger (address) WHERE reason = 'signup_grant';

-- ── Phase 1: discrete-settlement reputation-backing, final schema ──────
-- Both tables keyed on predictor_address (TEXT) — same identity Phase 0
-- uses, never users.id. trade_id is BIGINT — matches realized_trades.id.
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
  trade_id          BIGINT NOT NULL,
  capped_roi        NUMERIC NOT NULL,
  delta_centpoints  BIGINT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_flex_backing_settlements_once
  ON flex_backing_settlements (backing_id, trade_id);

CREATE INDEX idx_flex_backing_settlements_backing ON flex_backing_settlements (backing_id, created_at);
