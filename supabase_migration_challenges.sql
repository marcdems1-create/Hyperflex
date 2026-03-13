-- Community Challenges + Win Card tracking
-- Run in Supabase SQL Editor

-- Challenge fields on creator_settings
ALTER TABLE creator_settings
  ADD COLUMN IF NOT EXISTS challenge_title      TEXT,
  ADD COLUMN IF NOT EXISTS challenge_metric     TEXT,        -- 'bets' | 'members' | 'volume'
  ADD COLUMN IF NOT EXISTS challenge_target     INTEGER,
  ADD COLUMN IF NOT EXISTS challenge_bonus_pts  INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS challenge_end_date   TIMESTAMPTZ;

-- Store potential_payout per position so win cards can show earnings
ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS won BOOLEAN;
