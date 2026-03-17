-- Prediction Seasons / Tournaments
-- A season is a named, time-bounded competition scoped to a creator's community.
-- Members earn points only from markets inside the season; a separate leaderboard
-- tracks who's winning. Creator announces a prize; platform handles the rest.

CREATE TABLE IF NOT EXISTS seasons (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_slug    TEXT        NOT NULL,
  name            TEXT        NOT NULL CHECK (char_length(name) <= 80),
  description     TEXT        CHECK (char_length(description) <= 300),
  status          TEXT        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','ended','draft')),
  starts_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at         TIMESTAMPTZ,
  prize_description TEXT      CHECK (char_length(prize_description) <= 200),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS seasons_slug_status_idx ON seasons (creator_slug, status, created_at DESC);

-- Link markets to a season (nullable — most markets are not part of a season)
ALTER TABLE markets ADD COLUMN IF NOT EXISTS season_id UUID REFERENCES seasons(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS markets_season_id_idx ON markets (season_id) WHERE season_id IS NOT NULL;
