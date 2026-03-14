-- Market Suggestions: members can submit market ideas for creator approval
CREATE TABLE IF NOT EXISTS market_suggestions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_slug  TEXT NOT NULL REFERENCES creator_settings(slug) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name     TEXT,
  question      TEXT NOT NULL,
  context       TEXT,           -- optional: why they think this is a good market
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_market_suggestions_slug   ON market_suggestions (creator_slug, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_suggestions_user   ON market_suggestions (user_id, creator_slug);

-- Allow creators to toggle member suggestions on/off
ALTER TABLE creator_settings
  ADD COLUMN IF NOT EXISTS suggestions_enabled BOOLEAN NOT NULL DEFAULT false;
