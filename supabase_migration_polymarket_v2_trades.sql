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
--
-- ⚠️ 2026-08-12: rewritten to match prod's REAL live schema. The original
-- version of this file (eoa_address/salt/clob_order_id/clob_response_code/
-- clob_error/builder_code/client_ip/filled_at) never matched what was
-- actually deployed — every insert/update against those column names in
-- server.js's _logV2Attempt/_logV2Outcome was silently failing (caught,
-- console.warn'd, never blocking the trade flow) for however long the live
-- table has had this shape. Discovered via information_schema introspection
-- while building the user_market_interest backfill (migration #63).
-- server.js's own boot-time CREATE TABLE IF NOT EXISTS was fixed the same
-- day to match — keep both in sync if this table changes again.

CREATE TABLE IF NOT EXISTS polymarket_v2_trades (
  id                   BIGSERIAL PRIMARY KEY,
  user_id              TEXT REFERENCES users(id),

  proxy_address        TEXT,
  signer_address       TEXT,

  order_hash           TEXT,
  market_id            TEXT,
  condition_id         TEXT,
  token_id             TEXT,
  side                 TEXT,               -- 'BUY' / 'SELL', matches the CLOB V2 wire body
  is_neg_risk          BOOLEAN,
  maker_amount         TEXT,
  taker_amount         TEXT,
  price                NUMERIC,
  size                 NUMERIC,
  timestamp_ms         BIGINT,
  metadata             TEXT,
  builder              TEXT,
  signature_type       SMALLINT,

  clob_status          TEXT NOT NULL DEFAULT 'attempted',
  clob_response_body   JSONB,
  clob_error_message   TEXT,

  fill_confirmed_at    TIMESTAMPTZ,
  fill_tx_hash         TEXT,
  fill_size            NUMERIC,
  fill_price           NUMERIC,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pm_v2_trades_status_created ON polymarket_v2_trades(clob_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pm_v2_trades_proxy          ON polymarket_v2_trades(proxy_address);
CREATE INDEX IF NOT EXISTS idx_pm_v2_trades_signer         ON polymarket_v2_trades(signer_address);
CREATE INDEX IF NOT EXISTS idx_pm_v2_trades_user           ON polymarket_v2_trades(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pm_v2_trades_created        ON polymarket_v2_trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pm_v2_trades_pending_fill   ON polymarket_v2_trades(created_at) WHERE clob_status = 'accepted';
