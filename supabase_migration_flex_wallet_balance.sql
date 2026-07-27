-- ════════════════════════════════════════════════════════════
-- HYPERFLEX — Flex Wallet Balance (Phase 0 of reputation-backing)
-- Run in Railway Postgres (TablePlus / Railway SQL console). Filename keeps
-- the legacy supabase_migration_* prefix for git-history continuity only —
-- production DB is Railway Postgres, never Supabase. See CLAUDE.md.
-- ════════════════════════════════════════════════════════════
--
-- This is a NEW, distinct play-money balance — wallet-native Flex Points.
-- It is NOT a revival of the old earn/accumulate/spend "Flex Points" that
-- CLAUDE.md's Voice & Posture §8 retired (that system is `flex_points` /
-- `flex_points_log`, untouched by this migration). It is also NOT
-- `users.balance` or `community_balances` — both of those are gated behind
-- the legacy JWT login and unreachable by a /connect wallet-only user (see
-- the 2026-07-26 audit in SESSION_STATE.md). This table is keyed to
-- polymarket_address specifically so a wallet-connect user can read/move a
-- balance with zero login.
--
-- Play-money only: no cashout, no purchase, no fiat/crypto on-ramp. Do not
-- add one without a separate, explicit, lawyered decision — see the
-- reputation-backing build note in CLAUDE.md.

CREATE TABLE IF NOT EXISTS flex_wallet_balance (
  address             TEXT PRIMARY KEY,  -- lowercase EOA address — same identity /connect already keys users by
  balance_centpoints  BIGINT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only ledger — the actual source of truth. balance_centpoints above
-- is a derived cache that must always equal SUM(delta_centpoints) for that
-- address; every balance mutation MUST insert a row here in the same
-- transaction, never update the balance alone.
CREATE TABLE IF NOT EXISTS flex_wallet_ledger (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address           TEXT NOT NULL,
  delta_centpoints  BIGINT NOT NULL,
  reason            TEXT NOT NULL,  -- 'signup_grant' | future: 'back_predictor' | 'settlement_credit' | 'settlement_debit' | ...
  ref_id            TEXT,           -- e.g. a backing id, once Phase 1 exists — nullable, not enforced yet
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flex_wallet_ledger_address ON flex_wallet_ledger (address, created_at);

-- Idempotent signup-grant guard, enforced at the DB level rather than an
-- application-level check-then-insert (which would race under concurrent
-- connects for the same address). One 'signup_grant' row per address, ever —
-- a second grant attempt hits this unique index and fails with a
-- unique-violation (23505), which the application layer treats as an
-- expected no-op, not an error.
CREATE UNIQUE INDEX IF NOT EXISTS idx_flex_wallet_ledger_one_grant_per_address
  ON flex_wallet_ledger (address) WHERE reason = 'signup_grant';
