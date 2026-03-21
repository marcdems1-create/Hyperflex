-- Manual Bets table — universal bet tracker for any platform
-- Status values: 'open', 'won', 'lost', 'push', 'void'
-- Platform values: 'draftkings', 'fanduel', 'betmgm', 'bet365', 'bovada', 'polymarket', 'kalshi', 'other'

CREATE TABLE IF NOT EXISTS manual_bets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'other',
  question TEXT NOT NULL,
  side TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  odds TEXT,
  potential_payout NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'open',
  outcome TEXT,
  pnl NUMERIC(12,2),
  settled_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manual_bets_user ON manual_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_manual_bets_status ON manual_bets(status);
