-- Migration #46: Influencer Social Layer
-- Adds reactions, comments, and follows for influencer posts
-- Run AFTER supabase_migration_influencer_feed.sql (#45)

-- Add engagement counters to influencer_posts
ALTER TABLE influencer_posts ADD COLUMN IF NOT EXISTS agree_count INTEGER DEFAULT 0;
ALTER TABLE influencer_posts ADD COLUMN IF NOT EXISTS disagree_count INTEGER DEFAULT 0;
ALTER TABLE influencer_posts ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0;
ALTER TABLE influencer_posts ADD COLUMN IF NOT EXISTS fire_count INTEGER DEFAULT 0;

-- Reactions on influencer posts (agree/disagree/fire)
CREATE TABLE IF NOT EXISTS influencer_post_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES influencer_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  reaction TEXT NOT NULL CHECK (reaction IN ('agree', 'disagree', 'fire')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);

-- Comments on influencer posts
CREATE TABLE IF NOT EXISTS influencer_post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES influencer_posts(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  parent_id UUID REFERENCES influencer_post_comments(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User follows on influencers
CREATE TABLE IF NOT EXISTS influencer_follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  influencer_id UUID NOT NULL REFERENCES external_influencers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, influencer_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_inf_reactions_post ON influencer_post_reactions(post_id);
CREATE INDEX IF NOT EXISTS idx_inf_reactions_user ON influencer_post_reactions(user_id);
CREATE INDEX IF NOT EXISTS idx_inf_comments_post ON influencer_post_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_inf_comments_created ON influencer_post_comments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inf_follows_user ON influencer_follows(user_id);
CREATE INDEX IF NOT EXISTS idx_inf_follows_influencer ON influencer_follows(influencer_id);
