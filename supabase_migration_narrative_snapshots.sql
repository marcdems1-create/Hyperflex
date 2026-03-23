-- Migration #31: Narrative Intelligence snapshots
-- Stores daily dominance % per narrative theme for weekly delta calculation

CREATE TABLE IF NOT EXISTS narrative_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  narrative     TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  dominance_pct NUMERIC(5,2),
  market_count  INTEGER,
  total_volume  BIGINT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (narrative, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_narrative_snapshots_date ON narrative_snapshots (snapshot_date);
