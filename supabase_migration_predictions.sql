-- Migration #47: predictions + flex score columns
-- Prediction posts linked to real wallet positions

CREATE TABLE IF NOT EXISTS predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  platform text DEFAULT 'polymarket',          -- 'polymarket' | 'kalshi' | 'manifold'
  market_id text,                               -- external market identifier (conditionId etc)
  market_title text NOT NULL,
  posted_at timestamptz DEFAULT now(),
  direction text NOT NULL,                      -- 'YES' | 'NO'
  entry_price numeric(5,2),                     -- 0.00–1.00
  position_size_usd numeric,                   -- pulled from wallet
  size_display text DEFAULT 'range',            -- 'exact' | 'range'
  conviction text DEFAULT 'medium',             -- 'low' | 'medium' | 'high'
  thesis_text text,                             -- 500 char max
  category_tags text[],                         -- auto-detected from market data
  resolved_at timestamptz,
  outcome text DEFAULT 'pending',               -- 'correct' | 'incorrect' | 'void' | 'pending'
  brier_contribution numeric,                   -- computed on resolution
  pnl_usd numeric                               -- computed on resolution
);

CREATE INDEX IF NOT EXISTS predictions_user_id_idx ON predictions(user_id);
CREATE INDEX IF NOT EXISTS predictions_market_id_idx ON predictions(market_id);
CREATE INDEX IF NOT EXISTS predictions_posted_at_idx ON predictions(posted_at DESC);
CREATE INDEX IF NOT EXISTS predictions_outcome_idx ON predictions(outcome);

-- Flex score columns on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS flex_score_90d numeric DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS flex_score_alltime numeric DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS predictions_resolved integer DEFAULT 0;
