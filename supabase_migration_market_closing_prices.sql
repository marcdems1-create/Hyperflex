-- T3 — Closing price snapshot table. Bedrock for CLV calculation.
--
-- One row per (source, external_id) binary market. Snapshotted by a
-- 5-minute cron that fires when a market nears close (endDate within the
-- next 15 min OR already closed) AND the row doesn't already exist.
--
-- `close_ts` is the market's reference close time (Polymarket endDate
-- or Kalshi close_time). `captured_at` is when we snapshotted the price.
-- `yes_price` + `no_price` are the mid-book prices at capture time; T4
-- computes CLV as (trade.entry_price - closing_price) signed by side.
--
-- Multi-outcome markets (>2 tokens) are out of scope for MVP. Each
-- outcome token is its own binary slice; if we want to store them later,
-- add a nullable token_id column + migrate the PK.

BEGIN;

CREATE TABLE IF NOT EXISTS market_closing_prices (
  source       TEXT         NOT NULL CHECK (source IN ('polymarket','kalshi')),
  external_id  TEXT         NOT NULL,
  yes_price    NUMERIC(10,6),
  no_price     NUMERIC(10,6),
  close_ts     TIMESTAMPTZ  NOT NULL,
  captured_at  TIMESTAMPTZ  DEFAULT now(),
  PRIMARY KEY (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_mcp_close_ts    ON market_closing_prices (close_ts DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_captured_at ON market_closing_prices (captured_at DESC);

COMMIT;
