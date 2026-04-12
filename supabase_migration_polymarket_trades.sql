-- Migration: polymarket_trades — records every trade placed through HYPERFLEX
-- Run #44 in ordered migration list

CREATE TABLE IF NOT EXISTS polymarket_trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  eoa_address TEXT NOT NULL,            -- user's MetaMask EOA (lowercase)
  proxy_address TEXT,                    -- Polymarket proxy wallet
  market_slug TEXT,                      -- HYPERFLEX market slug
  market_question TEXT,                  -- market question text
  condition_id TEXT,                     -- Polymarket conditionId
  token_id TEXT,                         -- CLOB token ID traded
  side TEXT NOT NULL,                    -- 'YES' or 'NO'
  trade_mode TEXT DEFAULT 'buy',         -- 'buy' or 'sell'
  order_type TEXT DEFAULT 'GTC',         -- 'GTC' or 'FOK'
  amount_usd NUMERIC(12,2) NOT NULL,    -- USD amount spent
  shares NUMERIC(14,4),                 -- shares received
  price_cents INTEGER,                  -- entry price in cents (1-99)
  potential_payout NUMERIC(12,2),       -- max payout if correct
  order_id TEXT,                        -- CLOB order ID from response
  status TEXT DEFAULT 'filled',         -- 'filled', 'partial', 'failed'
  outcome TEXT,                         -- NULL until resolved, then 'won' or 'lost'
  pnl NUMERIC(12,2),                   -- profit/loss after resolution (NULL until resolved)
  resolved_at TIMESTAMPTZ,             -- when the market resolved
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_polymarket_trades_eoa ON polymarket_trades(eoa_address);
CREATE INDEX IF NOT EXISTS idx_polymarket_trades_slug ON polymarket_trades(market_slug);
CREATE INDEX IF NOT EXISTS idx_polymarket_trades_created ON polymarket_trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_polymarket_trades_condition ON polymarket_trades(condition_id);
