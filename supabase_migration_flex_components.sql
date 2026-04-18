-- Flex Score B, Phase 2: component breakdown on users table.
--
-- The Flex Score is now a blend of two components, each computed
-- independently so the profile UI can explain where the score comes from:
--
--   flex_brier_component  — (1 − avgBrier) × 100 across resolved predictions
--   flex_pnl_component    — clamp(50 + medianRealizedROI × 50, 0, 100)
--                            across realized_trades rows
--
--   flex_score_alltime    = 0.7 × brier + 0.3 × pnl when both exist;
--                           whichever is non-null otherwise
--
-- realized_roi_median + realized_trade_count are the raw numbers behind
-- flex_pnl_component — the profile page surfaces them so users can see
-- "median +18% on 42 closed trades" under their score.

ALTER TABLE users ADD COLUMN IF NOT EXISTS flex_brier_component INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS flex_pnl_component   INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS realized_roi_median  NUMERIC(10,6);
ALTER TABLE users ADD COLUMN IF NOT EXISTS realized_trade_count INTEGER DEFAULT 0;
