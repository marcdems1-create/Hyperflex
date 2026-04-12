-- Migration: polymarket_trades — full position lifecycle tracking
-- Run #44 in ordered migration list
-- Drop and recreate if the bare-bones version was already run
DROP TABLE IF EXISTS polymarket_trades;

CREATE TABLE polymarket_trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Identity
  eoa_address TEXT NOT NULL,              -- user's MetaMask EOA (lowercase)
  proxy_address TEXT,                     -- Polymarket proxy wallet

  -- Market
  market_slug TEXT,                       -- HYPERFLEX /market/:slug
  market_question TEXT,                   -- full question text
  condition_id TEXT,                      -- Polymarket conditionId
  token_id TEXT,                          -- CLOB token ID

  -- Entry
  side TEXT NOT NULL,                     -- 'YES' or 'NO'
  trade_mode TEXT DEFAULT 'buy',          -- 'buy' or 'sell'
  order_type TEXT DEFAULT 'GTC',          -- 'GTC' or 'FOK'
  entry_price NUMERIC(6,4),              -- entry price as decimal (e.g. 0.36 = 36¢)
  entry_price_cents INTEGER,             -- entry price in cents (1-99)
  amount_usd NUMERIC(12,2) NOT NULL,     -- USD spent to enter
  shares NUMERIC(14,4),                  -- shares acquired
  order_id TEXT,                         -- CLOB order ID

  -- Market context at entry
  market_price_at_entry NUMERIC(6,4),    -- market mid price when trade was placed
  volume_at_entry NUMERIC(14,2),         -- 24h volume at entry (from screener)

  -- Exit / Resolution
  status TEXT DEFAULT 'open',            -- 'open', 'closed', 'won', 'lost'
  exit_price NUMERIC(6,4),              -- price when closed/resolved
  exit_amount_usd NUMERIC(12,2),        -- USD received on exit
  pnl NUMERIC(12,2),                    -- profit/loss in USD
  pnl_percent NUMERIC(8,2),            -- P&L as percentage of entry cost
  closed_at TIMESTAMPTZ,               -- when position was closed (sell or resolution)
  close_reason TEXT,                     -- 'sold', 'resolved_win', 'resolved_loss', 'expired'

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),  -- when trade was placed
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_pt_eoa ON polymarket_trades(eoa_address);
CREATE INDEX idx_pt_eoa_status ON polymarket_trades(eoa_address, status);
CREATE INDEX idx_pt_slug ON polymarket_trades(market_slug);
CREATE INDEX idx_pt_created ON polymarket_trades(created_at DESC);
CREATE INDEX idx_pt_condition ON polymarket_trades(condition_id);
CREATE INDEX idx_pt_status ON polymarket_trades(status);
