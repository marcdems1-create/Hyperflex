-- Migration: Platform referral chain (2-level)
-- Adds referral_code + referred_by to users, creates platform_referrals tracking table

-- Add referral columns to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(id);

-- Index for fast referral lookups
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by) WHERE referred_by IS NOT NULL;

-- Platform referrals log — tracks ongoing FP/USDC earned from referral chain
CREATE TABLE IF NOT EXISTS platform_referrals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id UUID NOT NULL REFERENCES users(id),
  referee_id UUID NOT NULL REFERENCES users(id),
  level INTEGER NOT NULL DEFAULT 1, -- 1 = direct, 2 = L2
  fp_earned NUMERIC DEFAULT 0,
  usdc_earned NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_referrals_referrer ON platform_referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_platform_referrals_referee ON platform_referrals(referee_id);
