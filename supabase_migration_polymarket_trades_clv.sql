-- T4 — CLV (Closing Line Value) on polymarket_trades.
--
-- `clv_cents` is cents-beaten-vs-close for the trade's side:
--   YES side: clv_cents = (close.yes_price - entry_price) × 100
--   NO  side: clv_cents = (close.no_price  - entry_price) × 100
-- Positive = got in at a better price than the market's close. Negative =
-- paid up vs close. Null until market_closing_prices has a row for the
-- trade's condition_id.
--
-- Populated by sweepPolymarketTradesCLV() on a 15-min cron + at boot
-- (backfills historical). Scope: Polymarket probability markets only.
-- Sports-pick CLV on the `picks` table is Phase 3 and needs sportsbook
-- closing lines from OddsJam/Pinnacle.

BEGIN;

ALTER TABLE polymarket_trades ADD COLUMN IF NOT EXISTS clv_cents       NUMERIC(6,2);
ALTER TABLE polymarket_trades ADD COLUMN IF NOT EXISTS clv_computed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pt_clv_pending
  ON polymarket_trades (status)
  WHERE clv_cents IS NULL AND condition_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pt_clv_eoa
  ON polymarket_trades (eoa_address, clv_cents)
  WHERE clv_cents IS NOT NULL;

COMMIT;
