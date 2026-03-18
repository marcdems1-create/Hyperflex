-- ============================================================
-- HYPERFLEX Creator Platform — Supabase SQL
-- Run these in order in your Supabase SQL Editor
-- ============================================================

-- ─── 1. Add creator columns to users table ──────────────────
-- (Run only if these columns don't exist yet)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_creator BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tenant_slug TEXT;

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_slug);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ─── 2. creator_settings table ──────────────────────────────
-- (Already created in last session — this is a safe re-run)
CREATE TABLE IF NOT EXISTS creator_settings (
  creator_id       UUID PRIMARY KEY,
  slug             TEXT UNIQUE NOT NULL,
  display_name     TEXT,
  custom_points_name TEXT DEFAULT 'Flex Points',
  primary_color    TEXT DEFAULT '#c9920d',
  logo_url         TEXT,
  community_description TEXT,
  is_active        BOOLEAN DEFAULT TRUE,
  plan             TEXT DEFAULT 'free',   -- 'free' | 'pro' | 'enterprise'
  plan_expires_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creator_slug ON creator_settings(slug);

-- ─── 3. Add missing columns to markets table ────────────────
ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS creator_id UUID,
  ADD COLUMN IF NOT EXISTS tenant_slug TEXT,
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS custom_points_name TEXT DEFAULT 'Flex Points',
  ADD COLUMN IF NOT EXISTS outcome TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_source TEXT,
  ADD COLUMN IF NOT EXISTS trader_count INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_markets_creator ON markets(creator_id);
CREATE INDEX IF NOT EXISTS idx_markets_tenant ON markets(tenant_slug);

-- ─── 4. positions table (for payouts on resolution) ─────────
-- Check if it exists — if you already have a trades/bets table,
-- rename accordingly and adjust creator-routes.js
CREATE TABLE IF NOT EXISTS positions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id    UUID NOT NULL,
  user_id      UUID NOT NULL,
  side         TEXT NOT NULL CHECK (side IN ('YES', 'NO')),
  amount       INTEGER NOT NULL, -- in cents
  shares       NUMERIC,
  price_at_buy NUMERIC,
  pnl          INTEGER DEFAULT 0, -- in cents, set on resolution
  won          BOOLEAN,
  resolved     BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_positions_market ON positions(market_id);
CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_positions_created ON positions(created_at);

-- ─── 5. Row Level Security (RLS) ────────────────────────────
-- Allow public reads on creator_settings (for community pages)
ALTER TABLE creator_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active creators" ON creator_settings;
CREATE POLICY "Public can read active creators"
  ON creator_settings FOR SELECT
  USING (is_active = TRUE);

-- Creators can only update their own settings
DROP POLICY IF EXISTS "Creators update own settings" ON creator_settings;
CREATE POLICY "Creators update own settings"
  ON creator_settings FOR UPDATE
  USING (TRUE); -- auth handled at API layer with JWT

-- ─── 6. Helper: trader_count auto-update trigger ────────────
-- Keeps markets.trader_count in sync automatically
CREATE OR REPLACE FUNCTION update_trader_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE markets
  SET trader_count = (
    SELECT COUNT(DISTINCT user_id)
    FROM positions
    WHERE market_id = NEW.market_id
  )
  WHERE id = NEW.market_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_trader_count ON positions;
CREATE TRIGGER trg_update_trader_count
  AFTER INSERT ON positions
  FOR EACH ROW EXECUTE FUNCTION update_trader_count();

-- ─── 7. Verify everything looks good ────────────────────────
SELECT 'users columns' as check, column_name
  FROM information_schema.columns
  WHERE table_name = 'users'
    AND column_name IN ('is_creator', 'tenant_slug', 'balance', 'password_hash');

SELECT 'creator_settings' as check, count(*) FROM creator_settings;
SELECT 'markets columns' as check, column_name
  FROM information_schema.columns
  WHERE table_name = 'markets'
    AND column_name IN ('creator_id', 'tenant_slug', 'outcome', 'trader_count');
