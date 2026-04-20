-- T2 — Sport/league tagging on external markets.
--
-- Single table, polymorphic across Polymarket (source='polymarket',
-- external_id=condition_id) and Kalshi (source='kalshi',
-- external_id=ticker). Fills progressively: a nightly sweep classifies
-- every untagged (source, external_id) pair from cached_positions,
-- realized_trades, and polymarket_trades.
--
-- `tagged_by` carries provenance so the auto-sweep can re-run without
-- stomping on admin manual overrides:
--   'kalshi_taxonomy'  — ticker prefix parse (high confidence)
--   'regex'            — keyword/team-name regex (variable confidence)
--   'manual'           — admin-set via POST /api/admin/markets/sport-tag
--                        (NEVER overwritten by the sweep)
--   'claude'           — LLM fallback, reserved for later
--
-- Consumers (T4 CLV, T5 Flex Score for Sports, T6 /sports-predictors)
-- key off (source, external_id) to decide whether a trade is "sports"
-- and, if so, which sport and league.

BEGIN;

CREATE TABLE IF NOT EXISTS market_sport_tags (
  source       TEXT        NOT NULL CHECK (source IN ('polymarket','kalshi')),
  external_id  TEXT        NOT NULL,
  market_title TEXT,
  sport        TEXT        NOT NULL,   -- 'nba'|'nfl'|'mlb'|'nhl'|'soccer'|'ncaaf'|'ncaab'|'ufc'|'boxing'|'tennis'|'golf'|'f1'|'esports'|'other'
  league       TEXT,                   -- 'NFL'|'NBA'|'MLB'|'NHL'|'EPL'|'MLS'|'UCL'|'NCAAF'|'NCAAB'|'UFC'|'ATP'|'WTA'|'PGA'|'F1'|'LCS'|...
  confidence   NUMERIC(3,2) DEFAULT 1.00,
  tagged_by    TEXT        NOT NULL CHECK (tagged_by IN ('kalshi_taxonomy','regex','manual','claude')),
  tagged_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY  (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_mst_sport       ON market_sport_tags (sport, league);
CREATE INDEX IF NOT EXISTS idx_mst_tagged_at   ON market_sport_tags (tagged_at DESC);
CREATE INDEX IF NOT EXISTS idx_mst_tagged_by   ON market_sport_tags (tagged_by);

COMMIT;
