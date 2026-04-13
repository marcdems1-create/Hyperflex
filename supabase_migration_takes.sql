-- Migration #44: Takes system — social layer for prediction markets
-- The atomic unit of the social feed: a public prediction with optional thesis

-- Takes table
CREATE TABLE IF NOT EXISTS takes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  wallet_address TEXT,
  display_name TEXT,
  avatar_url TEXT,
  market_slug TEXT,
  condition_id TEXT,
  question TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_price NUMERIC,
  amount NUMERIC,
  thesis TEXT,
  source TEXT NOT NULL DEFAULT 'user',
  sharp_score NUMERIC,
  parent_take_id UUID REFERENCES takes(id) ON DELETE SET NULL,
  agree_count INTEGER NOT NULL DEFAULT 0,
  disagree_count INTEGER NOT NULL DEFAULT 0,
  is_correct BOOLEAN,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for feed queries
CREATE INDEX IF NOT EXISTS idx_takes_created_at ON takes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_takes_user_id ON takes(user_id);
CREATE INDEX IF NOT EXISTS idx_takes_source ON takes(source);
CREATE INDEX IF NOT EXISTS idx_takes_market_slug ON takes(market_slug);
CREATE INDEX IF NOT EXISTS idx_takes_condition_id ON takes(condition_id);
CREATE INDEX IF NOT EXISTS idx_takes_parent ON takes(parent_take_id);
CREATE INDEX IF NOT EXISTS idx_takes_trending ON takes(agree_count DESC, disagree_count DESC, created_at DESC);

-- Take reactions table (agree/disagree)
CREATE TABLE IF NOT EXISTS take_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  take_id UUID NOT NULL REFERENCES takes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL CHECK (reaction IN ('agree', 'disagree')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(take_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_take_reactions_take_id ON take_reactions(take_id);
CREATE INDEX IF NOT EXISTS idx_take_reactions_user_id ON take_reactions(user_id);
