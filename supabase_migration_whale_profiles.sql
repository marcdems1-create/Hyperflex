-- Migration #45: Whale profiles — auto-created user records for Polymarket whale wallets
-- Enables whale profiles at /m/:userId with takes, track record, follow

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_whale BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS whale_rank INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS whale_pnl NUMERIC;

CREATE INDEX IF NOT EXISTS idx_users_is_whale ON users(is_whale) WHERE is_whale = true;
CREATE INDEX IF NOT EXISTS idx_users_polymarket_address ON users(polymarket_address) WHERE polymarket_address IS NOT NULL;
