-- Migration: incentive_pools + incentive_claims
--
-- The B (Incentive Manager / Liquidity-as-a-service) revenue stream.
-- Two tables:
--   incentive_pools   — sponsor-funded reward pools tied to a Polymarket market
--   incentive_claims  — per-trade payouts drawn from a pool
--
-- A pool says "I will pay $X per share/contract to anyone who takes side Y
-- on market Z, capped at pool_size_usd". Traders who place trades through
-- the HYPERFLEX builder route on the matching side rack up claims; payouts
-- settle on market resolution (or earlier if the pool is set to pay-on-fill).
--
-- /api/incentives/stats reads aggregate counts from these tables.
-- /api/incentives/active returns the currently-claimable pools.
-- Both are public endpoints. Pool creation is admin-gated (or
-- partnership-team-funded) until self-serve sponsoring lands.

-- ── incentive_pools ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incentive_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Sponsor identity. user_id is FK to users (when sponsor has a HFX
  -- account); sponsor_label is the public display name shown on the pool
  -- card. Fund-deployed pools without a HFX account use NULL user_id and
  -- a custom label like "Acme Capital" or "Polymarket".
  sponsor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sponsor_label TEXT,

  -- Market this pool is tied to.
  market_slug TEXT NOT NULL,
  condition_id TEXT,
  market_question TEXT NOT NULL,

  -- Side the pool pays out for:
  --   YES        — pay traders who take the YES side
  --   NO         — pay traders who take the NO side
  --   BOTH       — pay either side equally (used to seed total volume)
  --   LIQUIDITY  — pay LPs who provide book depth (post resting orders)
  side TEXT NOT NULL CHECK (side IN ('YES','NO','BOTH','LIQUIDITY')),

  -- Money math. pool_size_usd is the cap; reward_per_unit_usd is paid per
  -- share (or per $1 of order depth for LIQUIDITY pools). paid_out_usd
  -- updates as claims settle so we can tell when the pool is depleted.
  pool_size_usd NUMERIC(12,2) NOT NULL CHECK (pool_size_usd > 0),
  reward_per_unit_usd NUMERIC(8,4) NOT NULL CHECK (reward_per_unit_usd > 0),
  paid_out_usd NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Lifecycle.
  --   pending    — funded but not yet active (waiting on starts_at)
  --   active     — accepting claims
  --   depleted   — paid_out_usd >= pool_size_usd, no more claims accepted
  --   expired    — past expires_at without depleting
  --   cancelled  — sponsor pulled back; remaining funds returned
  --   resolved   — market settled, pool closed
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','depleted','expired','cancelled','resolved')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,

  -- Public-facing notes (e.g. "seeded by Acme MM to deepen the YES book").
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incentive_pools_status_expires
  ON incentive_pools(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_incentive_pools_market_slug
  ON incentive_pools(market_slug);
-- Active-pool listing on the page hits this index (status='active' AND
-- expires_at > now()), so a partial covers the hot read.
CREATE INDEX IF NOT EXISTS idx_incentive_pools_active
  ON incentive_pools(starts_at DESC) WHERE status = 'active';

-- ── incentive_claims ───────────────────────────────────────────────────────
-- One row per qualifying trade. Settle cron pays these out by setting
-- paid_at; until then they're earned-but-unpaid (shown in stats as "Paid
-- to traders" pending). Trade_id ties back to the user's polymarket
-- trade so we can prove eligibility and avoid double-counting.
CREATE TABLE IF NOT EXISTS incentive_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES incentive_pools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trade_id TEXT,
  shares NUMERIC(14,4) NOT NULL CHECK (shares > 0),
  reward_usd NUMERIC(10,4) NOT NULL CHECK (reward_usd > 0),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incentive_claims_pool ON incentive_claims(pool_id);
CREATE INDEX IF NOT EXISTS idx_incentive_claims_user ON incentive_claims(user_id);
-- Dedup guard: one claim per (pool, trade). Lets the claim cron be
-- idempotent — re-running it can't double-pay the same trade.
CREATE UNIQUE INDEX IF NOT EXISTS idx_incentive_claims_dedup
  ON incentive_claims(pool_id, trade_id) WHERE trade_id IS NOT NULL;
