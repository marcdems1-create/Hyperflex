-- Creator Wall: freestanding public comment thread on a creator's profile page
CREATE TABLE IF NOT EXISTS creator_wall (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_slug TEXT       NOT NULL,
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  content     TEXT        NOT NULL CHECK (char_length(content) <= 280),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS creator_wall_slug_idx ON creator_wall (creator_slug, created_at DESC);
