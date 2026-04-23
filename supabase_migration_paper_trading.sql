-- Paper trading: virtual $1000 balance per user, paper positions, daily picks

-- Paper balance lives on users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS paper_balance NUMERIC(12,2) DEFAULT 1000.00,
  ADD COLUMN IF NOT EXISTS paper_trades_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paper_pnl NUMERIC(12,2) DEFAULT 0.00;

-- Paper positions (simulated trades against real Polymarket prices)
CREATE TABLE IF NOT EXISTS paper_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market_slug TEXT NOT NULL,
  condition_id TEXT,
  question TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('YES','NO')),
  entry_price NUMERIC(6,4) NOT NULL,   -- 0-1
  shares NUMERIC(12,4) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,       -- USDC spent
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','sold')),
  outcome TEXT,                         -- 'YES' | 'NO' on resolution
  is_correct BOOLEAN,
  payout NUMERIC(12,2),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paper_positions_user_id ON paper_positions(user_id);
CREATE INDEX IF NOT EXISTS paper_positions_slug ON paper_positions(market_slug);

-- Daily Pick: one featured market per calendar day
CREATE TABLE IF NOT EXISTS daily_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_date DATE NOT NULL UNIQUE,
  market_slug TEXT NOT NULL,
  condition_id TEXT,
  question TEXT NOT NULL,
  yes_price NUMERIC(6,4),
  no_price NUMERIC(6,4),
  category TEXT,
  yes_votes INTEGER DEFAULT 0,
  no_votes INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- User votes on the daily pick (one per user per day)
CREATE TABLE IF NOT EXISTS user_daily_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pick_date DATE NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('YES','NO')),
  was_correct BOOLEAN,               -- filled on resolution
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, pick_date)
);

CREATE INDEX IF NOT EXISTS user_daily_picks_user_id ON user_daily_picks(user_id);

-- Market alerts: email capture (no auth required)
CREATE TABLE IF NOT EXISTS market_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  market_slug TEXT NOT NULL,
  question TEXT NOT NULL,
  threshold_pct INTEGER NOT NULL DEFAULT 10,  -- alert when price moves ±N%
  baseline_price NUMERIC(6,4),               -- price at alert creation
  triggered BOOLEAN DEFAULT false,
  triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_alerts_slug ON market_alerts(market_slug, triggered);
CREATE INDEX IF NOT EXISTS market_alerts_email ON market_alerts(email);
