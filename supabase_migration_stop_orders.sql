-- ══════════════════════════════════════════════════════════════════════
-- STOP-LOSS / TAKE-PROFIT conditional orders
-- ══════════════════════════════════════════════════════════════════════
--
-- Polymarket has NO native conditional orders. HYPERFLEX fills the gap:
-- user sets a trigger price → server monitors live WebSocket ticks →
-- when price crosses threshold, the order is triggered → client-side
-- execution (requires MetaMask signature, can't be done server-side).
--
-- Status lifecycle:
--   active → triggered → executed  (happy path)
--   active → triggered → failed    (user didn't open tab in time / wallet issue)
--   active → cancelled             (user manually cancelled)
--   active → expired               (market resolved before trigger)
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS stop_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  -- Market identification
  token_id      TEXT NOT NULL,            -- CLOB token ID (the asset being sold)
  condition_id  TEXT,                     -- Polymarket conditionId
  market_slug   TEXT,                     -- for linking to /market/:slug
  market_title  TEXT,                     -- human-readable question
  -- Position context
  side          TEXT NOT NULL DEFAULT 'YES',  -- YES or NO (what the user holds)
  shares        NUMERIC NOT NULL DEFAULT 0,   -- how many shares to sell
  entry_price   NUMERIC,                      -- user's avg entry (for P&L display)
  -- Trigger config
  order_type    TEXT NOT NULL DEFAULT 'stop_loss',  -- 'stop_loss' or 'take_profit'
  trigger_price NUMERIC NOT NULL,         -- price threshold (0-1 scale, e.g. 0.35)
  -- trigger_direction: 'below' for stop-loss (sell when price drops below X)
  --                    'above' for take-profit (sell when price rises above X)
  trigger_direction TEXT NOT NULL DEFAULT 'below',
  -- Execution
  status        TEXT NOT NULL DEFAULT 'active',   -- active/triggered/executed/cancelled/expired
  triggered_at  TIMESTAMPTZ,              -- when the price crossed the threshold
  executed_at   TIMESTAMPTZ,              -- when the sell order was actually placed
  execution_price NUMERIC,                -- actual fill price
  -- Metadata
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Fast lookups: active orders by token (for tick matching), by user (for dashboard)
CREATE INDEX IF NOT EXISTS idx_stop_orders_active_token ON stop_orders(token_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_stop_orders_user ON stop_orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_stop_orders_triggered ON stop_orders(status) WHERE status = 'triggered';
