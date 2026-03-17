-- Migration: in_app_notifications
-- Powers the bell icon notification center on community + creator dashboard pages.

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,          -- 'market_resolved', 'you_won', 'you_lost', 'new_market', 'streak_warning', 'milestone'
  title       TEXT NOT NULL,
  body        TEXT,
  market_id   UUID REFERENCES markets(id) ON DELETE SET NULL,
  community_slug TEXT,
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_id_idx    ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON notifications (user_id, read) WHERE read = false;
