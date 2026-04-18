-- Migration #47: Take comments (reaction-gated)
-- Every comment is tied to a mandatory agree/disagree stance. This keeps
-- the social feed high-signal: you can't just chatter on a take, you have
-- to commit to a side first — and that reaction is recorded alongside the
-- comment, so every reply improves the market-signal data too.

CREATE TABLE IF NOT EXISTS take_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  take_id UUID NOT NULL REFERENCES takes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  reaction TEXT NOT NULL CHECK (reaction IN ('agree','disagree')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_take_comments_take ON take_comments(take_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_take_comments_user ON take_comments(user_id);

-- Denormalised comment_count on takes so feed queries don't have to
-- aggregate on every render.
ALTER TABLE takes ADD COLUMN IF NOT EXISTS comment_count INTEGER NOT NULL DEFAULT 0;
