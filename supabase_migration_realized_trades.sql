-- realized_trades: one row per closed lot on Polymarket for Flex Score B.
--
-- Each row represents a buy fill (or slice of one) that was closed by a
-- later sell fill, FIFO-matched. Populated by syncRealizedTrades() which
-- runs inside the hourly syncUserPositions cron. Used by the rewritten
-- recomputeFlexScore() (Phase 2) to credit profit-taking skill — capturing
-- +40c of edge pre-resolution should score like a correct resolved take.
--
-- external_sync_id is the dedup key: {condition_id}::{token_id}::{sell_tx_hash}::{lot_index}
-- so repeated runs of the sync are idempotent.

CREATE TABLE IF NOT EXISTS realized_trades (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  polymarket_address TEXT NOT NULL,
  condition_id TEXT,
  token_id TEXT,
  market_question TEXT,
  side TEXT,                          -- 'YES' | 'NO' (outcome name from Polymarket)
  shares NUMERIC(20,6),               -- size of the closed lot
  entry_price NUMERIC(10,6),          -- 0..1, avg entry price for the matched lot
  exit_price NUMERIC(10,6),           -- 0..1, sell fill price
  entry_cost_usd NUMERIC(14,4),       -- shares * entry_price
  exit_value_usd NUMERIC(14,4),       -- shares * exit_price
  realized_pnl NUMERIC(14,4),         -- exit_value - entry_cost
  realized_roi NUMERIC(10,6),         -- (exit_value - entry_cost) / entry_cost
  opened_at TIMESTAMPTZ,              -- timestamp of the matched buy fill
  closed_at TIMESTAMPTZ,              -- timestamp of the sell fill
  close_reason TEXT DEFAULT 'sold',   -- 'sold' for Phase 1; 'resolved_won'/'resolved_lost' in a later phase
  external_sync_id TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_realized_trades_user         ON realized_trades (user_id, closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_realized_trades_user_roi     ON realized_trades (user_id, realized_roi);
CREATE INDEX IF NOT EXISTS idx_realized_trades_condition    ON realized_trades (condition_id);
CREATE INDEX IF NOT EXISTS idx_realized_trades_closed_at    ON realized_trades (closed_at DESC);
