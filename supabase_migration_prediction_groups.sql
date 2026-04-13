-- Migration: Prediction groups — private/public groups for traders
-- Groups have shared prediction feeds, internal leaderboards, and member roles

CREATE TABLE IF NOT EXISTS prediction_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_private BOOLEAN DEFAULT true,
  member_count INTEGER DEFAULT 0,
  banner_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id UUID NOT NULL REFERENCES prediction_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',  -- 'owner' | 'admin' | 'member'
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);

-- Takes shared to a group
CREATE TABLE IF NOT EXISTS group_takes (
  group_id UUID NOT NULL REFERENCES prediction_groups(id) ON DELETE CASCADE,
  take_id UUID NOT NULL,
  shared_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, take_id)
);

CREATE INDEX IF NOT EXISTS idx_group_takes_group ON group_takes(group_id, created_at DESC);

-- Leaderboard snapshots — precomputed rankings by period + category
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period TEXT NOT NULL,         -- 'weekly' | 'monthly' | 'alltime'
  category TEXT DEFAULT 'all',  -- 'all' | 'crypto' | 'politics' | 'sports'
  snapshot_date DATE NOT NULL,
  rankings JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(period, category, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_lb_snap_date ON leaderboard_snapshots(snapshot_date DESC);
