-- Migration: Polymarket V2 trade counter + observability
--
-- Every order submitted via /api/polymarket/order logs a row here. Lets us
-- answer "is V2 actually being exercised?" with numbers, not assertions.
-- See CLAUDE.md session 16 — V1 deletion is gated on this table showing
-- sustained V2 usage.
--
-- Status progression:
--   attempted  → row inserted before CLOB forward
--   accepted   → CLOB returned 200 (order lives in matcher)
--   rejected   → CLOB returned non-2xx (error body captured)
--   filled     → fill confirmation from data-api poll (Commit B)
--   stale      → accepted but no fill after 24h (Commit B)
--
-- V1 orders (if any still slip through during the transition window) are
-- NOT logged here — only V2 orders, detected by presence of `order.builder`
-- in the request body.

CREATE TABLE IF NOT EXISTS polymarket_v2_trades (
  id             BIGSERIAL PRIMARY KEY,
  user_id        UUID REFERENCES users(id),

  eoa_address    TEXT NOT NULL,
  proxy_address  TEXT NOT NULL,

  token_id       TEXT,
  side           SMALLINT,
  maker_amount   TEXT,
  taker_amount   TEXT,
  salt           TEXT,
  builder_code   TEXT,

  clob_status         TEXT NOT NULL DEFAULT 'attempted',
  clob_order_id       TEXT,
  clob_response_code  SMALLINT,
  clob_error          TEXT,

  fill_tx_hash   TEXT,
  fill_price     NUMERIC,
  filled_at      TIMESTAMPTZ,

  client_ip      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pm_v2_trades_status_created ON polymarket_v2_trades(clob_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pm_v2_trades_proxy          ON polymarket_v2_trades(proxy_address);
CREATE INDEX IF NOT EXISTS idx_pm_v2_trades_eoa            ON polymarket_v2_trades(eoa_address);
CREATE INDEX IF NOT EXISTS idx_pm_v2_trades_user           ON polymarket_v2_trades(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pm_v2_trades_created        ON polymarket_v2_trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pm_v2_trades_pending_fill   ON polymarket_v2_trades(created_at) WHERE clob_status = 'accepted';
