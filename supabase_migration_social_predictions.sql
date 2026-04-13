-- Social Predictions: the core content unit of the HYPERFLEX social network
-- A prediction is a public, verifiable position statement: "I'm buying YES on X because Y"
-- Backed by real on-chain positions. Scored on resolution. Builds reputation.

-- ═══════════════════════════════════════════
-- PREDICTIONS
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS social_predictions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Market reference
  platform        TEXT NOT NULL DEFAULT 'polymarket',  -- 'polymarket' | 'kalshi'
  market_slug     TEXT NOT NULL,
  condition_id    TEXT,
  market_title    TEXT NOT NULL,
  market_url      TEXT,

  -- The prediction
  side            TEXT NOT NULL,                        -- 'YES' | 'NO'
  entry_price     NUMERIC(6,4) NOT NULL,               -- price when prediction posted
  amount_usd      NUMERIC(10,2),                       -- position size (optional)
  show_size       BOOLEAN DEFAULT FALSE,               -- user controls visibility

  -- Thesis (the content)
  thesis          TEXT,                                 -- markdown, max 2000 chars

  -- Verification
  trade_id        UUID,                                -- FK to polymarket_trades if from trade flow
  tx_hash         TEXT,                                 -- on-chain proof
  verified        BOOLEAN DEFAULT FALSE,               -- position confirmed on-chain

  -- Resolution
  status          TEXT DEFAULT 'active',                -- 'active' | 'closed' | 'resolved_win' | 'resolved_loss'
  exit_price      NUMERIC(6,4),
  pnl             NUMERIC(10,2),
  resolved_at     TIMESTAMPTZ,

  -- Engagement counters (denormalized for fast reads)
  comment_count   INTEGER DEFAULT 0,
  reaction_count  INTEGER DEFAULT 0,
  share_count     INTEGER DEFAULT 0,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sp_author ON social_predictions(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sp_market ON social_predictions(market_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sp_status ON social_predictions(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_sp_hot ON social_predictions(reaction_count DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sp_created ON social_predictions(created_at DESC);


-- ═══════════════════════════════════════════
-- COMMENTS on predictions
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS social_comments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prediction_id   UUID NOT NULL REFERENCES social_predictions(id) ON DELETE CASCADE,
  parent_id       UUID REFERENCES social_comments(id) ON DELETE CASCADE,  -- threaded replies

  body            TEXT NOT NULL,                        -- max 1000 chars

  reaction_count  INTEGER DEFAULT 0,

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sc_prediction ON social_comments(prediction_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sc_parent ON social_comments(parent_id);


-- ═══════════════════════════════════════════
-- REACTIONS (agree / disagree / fire)
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS social_reactions (
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type     TEXT NOT NULL,                        -- 'prediction' | 'comment'
  target_id       UUID NOT NULL,
  reaction_type   TEXT NOT NULL DEFAULT 'agree',        -- 'agree' | 'disagree' | 'fire'
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_sr_target ON social_reactions(target_type, target_id);
