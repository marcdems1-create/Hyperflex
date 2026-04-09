-- ══════════════════════════════════════════════════════════════════════
-- FLYWHEEL DISTRIBUTION — 50% of Polymarket builder fees back to traders
-- ══════════════════════════════════════════════════════════════════════
--
-- Previous model (supabase_migration_trade_rewards.sql): admin manually
-- entered a weekly pool amount, distributed pro-rata by CLICK count.
-- Misaligned incentive — rewarded clicking, not trading.
--
-- New model: 50% of our actual Polymarket builder-fee revenue is auto-
-- computed from weekly trade volume (volume × 0.003), then split:
--   - Base pool (80% of the 50% = 40% of revenue) → pro-rata by volume
--   - Flex pot  (20% of the 50% = 10% of revenue) → top engaged users
--                                                    by blended score
--
-- The most engaged users (top 20% by score) get BOTH — a base share
-- from their volume AND a flex pot bonus. Casual traders get the base.
-- ══════════════════════════════════════════════════════════════════════

-- Extend rewards_pool with the source breakdown so the admin + audit
-- trail can see exactly what the pool came from
ALTER TABLE rewards_pool ADD COLUMN IF NOT EXISTS builder_fees_total NUMERIC DEFAULT 0;
ALTER TABLE rewards_pool ADD COLUMN IF NOT EXISTS base_pool_amount   NUMERIC DEFAULT 0;
ALTER TABLE rewards_pool ADD COLUMN IF NOT EXISTS flex_pot_amount    NUMERIC DEFAULT 0;
ALTER TABLE rewards_pool ADD COLUMN IF NOT EXISTS total_volume       NUMERIC DEFAULT 0;

-- Extend user_rewards to track the two components separately. Legacy
-- `usdc_earned` stays as the SUM of both so existing queries don't break.
ALTER TABLE user_rewards ADD COLUMN IF NOT EXISTS base_usdc       NUMERIC DEFAULT 0;
ALTER TABLE user_rewards ADD COLUMN IF NOT EXISTS flex_bonus_usdc NUMERIC DEFAULT 0;
ALTER TABLE user_rewards ADD COLUMN IF NOT EXISTS volume_usd      NUMERIC DEFAULT 0;
ALTER TABLE user_rewards ADD COLUMN IF NOT EXISTS trade_count     INTEGER DEFAULT 0;
ALTER TABLE user_rewards ADD COLUMN IF NOT EXISTS engagement_score NUMERIC DEFAULT 0;
ALTER TABLE user_rewards ADD COLUMN IF NOT EXISTS is_flex_tier    BOOLEAN DEFAULT false;

-- Index for weekly lookups
CREATE INDEX IF NOT EXISTS idx_user_rewards_week ON user_rewards(week_start);
CREATE INDEX IF NOT EXISTS idx_user_rewards_user_week ON user_rewards(user_id, week_start);
