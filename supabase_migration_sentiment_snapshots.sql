-- Migration #48: Sentiment snapshots + wallet scores
-- The foundation of the Hyperflex data business. Rolls raw reactions +
-- comments into hourly materialised buckets per market so time-series
-- reads stay O(1). wallet_scores caches each trader's sharpness so the
-- sharp-weighted sentiment column doesn't re-compute Brier on every query.

-- Hourly sentiment rollup per market. The primary inventory unit for the
-- data API. Every snapshot is immutable once its bucket closes.
CREATE TABLE IF NOT EXISTS sentiment_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_slug TEXT,
  condition_id TEXT,
  bucket_start TIMESTAMPTZ NOT NULL,       -- truncated to the hour (UTC)
  -- Raw counts (anyone-can-vote, no weighting)
  agree_count INTEGER NOT NULL DEFAULT 0,
  disagree_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  unique_voters INTEGER NOT NULL DEFAULT 0,
  -- Sharp-weighted: only counts votes from wallets with sharpness_score >= 60
  -- (i.e. trading at a real profit with non-trivial sample size)
  sharp_agrees INTEGER NOT NULL DEFAULT 0,
  sharp_disagrees INTEGER NOT NULL DEFAULT 0,
  -- Volume-weighted score: sum(wallet_score × direction) / sum(wallet_score)
  -- Range -100 (all sharps disagree) ... +100 (all sharps agree)
  sharp_weighted_score NUMERIC,
  -- Computed: net = (agrees - disagrees) / (agrees + disagrees), -1..+1
  net_sentiment NUMERIC,
  -- Snapshot of the market's YES price at bucket close (from alpha cache)
  market_yes_price NUMERIC,
  -- Divergence: abs(market_yes_price - sharp_weighted_consensus)
  -- The bigger this is, the more valuable the signal.
  divergence NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(market_slug, condition_id, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_sentiment_snapshots_bucket ON sentiment_snapshots(bucket_start DESC);
CREATE INDEX IF NOT EXISTS idx_sentiment_snapshots_market ON sentiment_snapshots(market_slug, bucket_start DESC);
CREATE INDEX IF NOT EXISTS idx_sentiment_snapshots_condition ON sentiment_snapshots(condition_id, bucket_start DESC) WHERE condition_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sentiment_snapshots_divergence ON sentiment_snapshots(divergence DESC NULLS LAST, bucket_start DESC);

-- Per-user sharpness rating. Recomputed nightly from realized P&L, take
-- accuracy, and volume. Used to weight reactions in snapshots.
--
-- user_id is TEXT (not UUID) because Railway's users.id column is TEXT.
-- A UUID column here would fail every join and every seed INSERT with
-- 'operator does not exist: text = uuid'.
CREATE TABLE IF NOT EXISTS wallet_scores (
  user_id TEXT PRIMARY KEY,
  -- 0..100. Composite of (P&L tier × take accuracy × volume).
  sharpness_score NUMERIC NOT NULL DEFAULT 0,
  -- Individual components (for transparency / API sale):
  realized_pnl_usd NUMERIC NOT NULL DEFAULT 0,
  take_accuracy NUMERIC,              -- 0..1, null if <5 resolved takes
  resolved_takes INTEGER NOT NULL DEFAULT 0,
  closed_positions INTEGER NOT NULL DEFAULT 0,
  total_volume_usd NUMERIC NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_scores_sharpness ON wallet_scores(sharpness_score DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_scores_pnl ON wallet_scores(realized_pnl_usd DESC);
