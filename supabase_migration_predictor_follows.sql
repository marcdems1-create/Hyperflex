CREATE TABLE IF NOT EXISTS predictor_follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(follower_id, following_id)
);
CREATE INDEX IF NOT EXISTS idx_predictor_follows_follower ON predictor_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_predictor_follows_following ON predictor_follows(following_id);
