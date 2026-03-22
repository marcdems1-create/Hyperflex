-- Migration: Prediction accuracy tracking
-- Tracks every prediction from crystal ball / signals for accuracy grading

CREATE TABLE IF NOT EXISTS prediction_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL, -- 'crystal_ball', 'whale_consensus', 'momentum', 'divergence', 'leverage', 'expiry'
  market_id TEXT,
  market_question TEXT,
  predicted_side TEXT, -- 'YES' or 'NO'
  predicted_confidence INTEGER,
  market_price_at_prediction NUMERIC(6,4),
  target_price NUMERIC(6,4),
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  resolved BOOLEAN DEFAULT false,
  outcome TEXT, -- 'correct', 'incorrect', 'expired', 'pending'
  market_price_at_resolution NUMERIC(6,4),
  resolved_at TIMESTAMPTZ,
  pnl_if_followed NUMERIC(12,2) -- simulated P&L if you bet $100
);
CREATE INDEX IF NOT EXISTS idx_pred_source ON prediction_log(source);
CREATE INDEX IF NOT EXISTS idx_pred_resolved ON prediction_log(resolved);
CREATE INDEX IF NOT EXISTS idx_pred_detected ON prediction_log(detected_at);
