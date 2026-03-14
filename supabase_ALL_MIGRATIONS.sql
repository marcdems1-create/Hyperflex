-- ════════════════════════════════════════════════════════════
-- HYPERFLEX — ALL MIGRATIONS (run top to bottom, one paste)
-- Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- ════════════════════════════════════════════════════════════


-- ── 1. Community Economy ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS community_balances (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID        NOT NULL,
  creator_slug  TEXT        NOT NULL,
  balance       BIGINT      NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, creator_slug)
);
CREATE INDEX IF NOT EXISTS idx_cb_user_creator ON community_balances (user_id, creator_slug);
CREATE INDEX IF NOT EXISTS idx_cb_creator      ON community_balances (creator_slug);

ALTER TABLE creator_settings
  ADD COLUMN IF NOT EXISTS starting_balance  BIGINT   NOT NULL DEFAULT 100000,
  ADD COLUMN IF NOT EXISTS min_bet           BIGINT   NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS max_bet           BIGINT,
  ADD COLUMN IF NOT EXISTS refill_enabled    BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refill_amount     BIGINT   NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS refill_cadence    TEXT     NOT NULL DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS activity_gate     INT      NOT NULL DEFAULT 5;


-- ── 2. Refill History ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refill_history (
  id           UUID     DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID     NOT NULL,
  creator_slug TEXT     NOT NULL,
  amount       BIGINT   NOT NULL,
  week_start   DATE     NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, creator_slug, week_start)
);
CREATE INDEX IF NOT EXISTS idx_rh_creator_week ON refill_history (creator_slug, week_start);
CREATE INDEX IF NOT EXISTS idx_rh_user_creator ON refill_history (user_id, creator_slug);


-- ── 3. CPMM Dynamic Odds ─────────────────────────────────────
ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS yes_pool BIGINT NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS no_pool  BIGINT NOT NULL DEFAULT 5000;

UPDATE markets
SET
  yes_price = yes_pool::float / (yes_pool + no_pool),
  no_price  = no_pool::float  / (yes_pool + no_pool)
WHERE yes_pool + no_pool > 0;


-- ── 4. Referrals ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_history (
  id              UUID     DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id     UUID     NOT NULL,
  referred_id     UUID     NOT NULL,
  creator_slug    TEXT     NOT NULL,
  referrer_reward BIGINT   NOT NULL,
  welcome_bonus   BIGINT   NOT NULL,
  cap_exceeded    BOOLEAN  NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (referred_id, creator_slug)
);
CREATE INDEX IF NOT EXISTS idx_rh_referrer_slug ON referral_history (referrer_id, creator_slug, created_at);
CREATE INDEX IF NOT EXISTS idx_rh_referred_slug ON referral_history (referred_id, creator_slug);

ALTER TABLE creator_settings
  ADD COLUMN IF NOT EXISTS referral_reward BIGINT NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS welcome_bonus   BIGINT NOT NULL DEFAULT 5000;


-- ── 5. Custom Domains ─────────────────────────────────────────
ALTER TABLE creator_settings
  ADD COLUMN IF NOT EXISTS custom_domain             TEXT    UNIQUE,
  ADD COLUMN IF NOT EXISTS custom_domain_verified    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS custom_domain_token       TEXT    UNIQUE,
  ADD COLUMN IF NOT EXISTS custom_domain_verified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_creator_settings_custom_domain
  ON creator_settings (custom_domain)
  WHERE custom_domain IS NOT NULL AND custom_domain_verified = TRUE;


-- ── 6. Challenges ─────────────────────────────────────────────
ALTER TABLE creator_settings
  ADD COLUMN IF NOT EXISTS challenge_title      TEXT,
  ADD COLUMN IF NOT EXISTS challenge_metric     TEXT,
  ADD COLUMN IF NOT EXISTS challenge_target     INTEGER,
  ADD COLUMN IF NOT EXISTS challenge_bonus_pts  INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS challenge_end_date   TIMESTAMPTZ;

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS won BOOLEAN;


-- ── 7. Plan Trial ─────────────────────────────────────────────
ALTER TABLE creator_settings
  ADD COLUMN IF NOT EXISTS plan_trial_expires_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_creator_settings_trial_expires
  ON creator_settings (plan_trial_expires_at)
  WHERE plan_trial_expires_at IS NOT NULL;


-- ── 8. Market Suggestions ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_suggestions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_slug  TEXT NOT NULL REFERENCES creator_settings(slug) ON DELETE CASCADE,
  user_id       UUID NOT NULL,
  user_name     TEXT,
  question      TEXT NOT NULL,
  context       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_market_suggestions_slug ON market_suggestions (creator_slug, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_suggestions_user ON market_suggestions (user_id, creator_slug);

ALTER TABLE creator_settings
  ADD COLUMN IF NOT EXISTS suggestions_enabled BOOLEAN NOT NULL DEFAULT false;


-- ── 9. Announcements + Comments + Resolution Note ─────────────
CREATE TABLE IF NOT EXISTS creator_announcements (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_slug TEXT        NOT NULL REFERENCES creator_settings(slug) ON DELETE CASCADE,
  title        TEXT        NOT NULL,
  body         TEXT,
  pinned       BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_announcements_slug ON creator_announcements (creator_slug, created_at DESC);

CREATE TABLE IF NOT EXISTS market_comments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id    UUID        NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  creator_slug TEXT        NOT NULL,
  user_id      UUID        NOT NULL,
  user_name    TEXT,
  body         TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comments_market ON market_comments (market_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_comments_user   ON market_comments (user_id);

ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS resolution_note TEXT;

-- ════════════════════════════════════════════════════════════
-- DONE — all 9 migrations applied
-- ════════════════════════════════════════════════════════════
