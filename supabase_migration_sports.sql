-- Migration: Sports wedge (NBA first) — tipster profiles + verified picks
--
-- Three tables:
--   sport_teams   — canonical team roster (ESPN team_id keyed, aliases for matching)
--   sport_games   — game schedule + live scores, populated by ESPN cron
--   picks         — timestamped, immutable pre-game picks (the tipster wedge)
--
-- The `picks` table is the product: every row is a verifiable pre-tip-off
-- call. Two triggers enforce the guarantees:
--   1. locked_at must be before the game's starts_at (no backdating)
--   2. core fields are immutable after insert (no silent edits)
-- Settlement fields (settlement_status / settled_units / settled_at) and
-- the optional twitter_receipt_id are the only columns allowed to update.
-- lock_hash is server-signed at insert — public verification endpoint will
-- recompute and prove the row is original.

-- ── sport_teams ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sport_teams (
  id TEXT PRIMARY KEY,                  -- ESPN team id, e.g. "13" = Lakers
  sport TEXT NOT NULL,                  -- nba / nfl / mlb / nhl
  league TEXT NOT NULL,                 -- NBA / NFL / MLB / NHL
  name TEXT NOT NULL,                   -- canonical display name
  abbreviation TEXT,                    -- LAL, LAK, etc.
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,  -- ["Lakers","LA Lakers","Los Angeles Lakers"]
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sport_teams_sport ON sport_teams(sport);
CREATE INDEX IF NOT EXISTS idx_sport_teams_aliases ON sport_teams USING GIN (aliases);

-- ── sport_games ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sport_games (
  id TEXT PRIMARY KEY,                  -- ESPN event id
  sport TEXT NOT NULL,
  league TEXT NOT NULL,
  home_team_id TEXT REFERENCES sport_teams(id) ON DELETE SET NULL,
  away_team_id TEXT REFERENCES sport_teams(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled / live / final / postponed
  home_score INTEGER,
  away_score INTEGER,
  period TEXT,                          -- "Q3", "Final/OT", etc.
  last_polled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sport_games_starts_at ON sport_games(starts_at);
CREATE INDEX IF NOT EXISTS idx_sport_games_status ON sport_games(status);
CREATE INDEX IF NOT EXISTS idx_sport_games_sport ON sport_games(sport);
-- Partial index for the resolution cron: only games waiting to be settled.
CREATE INDEX IF NOT EXISTS idx_sport_games_final_unsettled
  ON sport_games(status, starts_at) WHERE status = 'final';

-- ── picks ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES sport_games(id) ON DELETE CASCADE,
  sport TEXT NOT NULL,
  bet_type TEXT NOT NULL CHECK (bet_type IN ('spread','moneyline','total','prop')),
  side TEXT NOT NULL,                   -- home/away for spread+ml; over/under for total; free text for prop
  line NUMERIC,                         -- null for moneyline
  odds NUMERIC NOT NULL,                -- American odds, e.g. -110, +150
  units NUMERIC NOT NULL CHECK (units > 0 AND units <= 10),
  thesis TEXT CHECK (thesis IS NULL OR length(thesis) <= 500),
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lock_hash TEXT NOT NULL,              -- sha256(user_id|game_id|side|line|odds|units|locked_at|SECRET)
  twitter_receipt_id TEXT,              -- v2: tweet id of public timestamp receipt
  settled_units NUMERIC,                -- signed: +1.91 for 1u @ -110 win, -1 for 1u loss, 0 for push
  settlement_status TEXT CHECK (settlement_status IS NULL OR settlement_status IN ('win','loss','push','void')),
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_picks_user_id ON picks(user_id);
CREATE INDEX IF NOT EXISTS idx_picks_game_id ON picks(game_id);
CREATE INDEX IF NOT EXISTS idx_picks_sport ON picks(sport);
CREATE INDEX IF NOT EXISTS idx_picks_locked_at ON picks(locked_at DESC);
CREATE INDEX IF NOT EXISTS idx_picks_unsettled
  ON picks(game_id) WHERE settlement_status IS NULL;

-- ── Trigger: enforce pre-tip-off lock ─────────────────────────────────────
-- locked_at must be strictly before the game's starts_at. Rejects backdated
-- or post-tip-off picks at the DB layer so no application bug can let one
-- slip through.
CREATE OR REPLACE FUNCTION enforce_pick_pregame()
RETURNS TRIGGER AS $$
DECLARE
  game_start TIMESTAMPTZ;
BEGIN
  SELECT starts_at INTO game_start FROM sport_games WHERE id = NEW.game_id;
  IF game_start IS NULL THEN
    RAISE EXCEPTION 'game % does not exist', NEW.game_id;
  END IF;
  IF NEW.locked_at >= game_start THEN
    RAISE EXCEPTION 'pick locked_at (%) must be before game starts_at (%)',
      NEW.locked_at, game_start;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_picks_pregame ON picks;
CREATE TRIGGER trg_picks_pregame
  BEFORE INSERT ON picks
  FOR EACH ROW EXECUTE FUNCTION enforce_pick_pregame();

-- ── Trigger: core fields are immutable ────────────────────────────────────
-- Only settlement_* + twitter_receipt_id may be updated after insert.
-- Anything else triggers a hard exception — the whole point of the product
-- is that a posted pick is a permanent record.
CREATE OR REPLACE FUNCTION enforce_pick_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.user_id   IS DISTINCT FROM NEW.user_id OR
      OLD.game_id   IS DISTINCT FROM NEW.game_id OR
      OLD.sport     IS DISTINCT FROM NEW.sport OR
      OLD.bet_type  IS DISTINCT FROM NEW.bet_type OR
      OLD.side      IS DISTINCT FROM NEW.side OR
      OLD.line      IS DISTINCT FROM NEW.line OR
      OLD.odds      IS DISTINCT FROM NEW.odds OR
      OLD.units     IS DISTINCT FROM NEW.units OR
      OLD.thesis    IS DISTINCT FROM NEW.thesis OR
      OLD.locked_at IS DISTINCT FROM NEW.locked_at OR
      OLD.lock_hash IS DISTINCT FROM NEW.lock_hash) THEN
    RAISE EXCEPTION 'pick core fields are immutable after insert';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_picks_immutable ON picks;
CREATE TRIGGER trg_picks_immutable
  BEFORE UPDATE ON picks
  FOR EACH ROW EXECUTE FUNCTION enforce_pick_immutable();
