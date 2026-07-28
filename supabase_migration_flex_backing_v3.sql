-- ════════════════════════════════════════════════════════════
-- HYPERFLEX — Reputation-Backing Phase 1 fix v3: trade_id column type
-- Run in Railway Postgres (TablePlus / Railway SQL console).
-- ════════════════════════════════════════════════════════════
--
-- Fixes another real bug, same family as v2 (assumed a type instead of
-- checking it): flex_backing_settlements.trade_id was declared UUID, but
-- realized_trades.id is actually BIGINT — confirmed via
-- GET /api/admin/flex-backing/predictor-trades returning plain sequential
-- integers ("1148499", "1121767", ...), not UUIDs. Would have failed with
-- "invalid input syntax for type uuid" on the first real settlement
-- attempt (caught before that happened, not after).
--
-- Only flex_backing_settlements is touched — flex_backings (and any real
-- stake already placed on it via /back) is completely untouched by this
-- migration; the two tables are independent (flex_backing_settlements
-- references flex_backings via backing_id, not the other way around).
--
-- Safe to run regardless of whether a real backing already exists: this
-- drops and recreates ONLY the settlements table, which has never
-- successfully written a row yet (every settle attempt against a real
-- trade_id would have hit the uuid cast error first).

DROP TABLE IF EXISTS flex_backing_settlements;

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
