-- Migration #48: Tipster applications + tipster status on users
--
-- The sports wedge is gated: only approved tipsters can POST /api/picks.
-- This migration adds the application funnel and the user-level status flag.
--
-- Tipster status model on users (explicit enum, no NULL — every user has a state):
--   'none'     — not a tipster, never applied (default for new + existing users)
--   'applied'  — submitted an application, pending review
--   'approved' — application approved, can POST /api/picks
--   'rejected' — application declined (can re-apply)
--   'revoked'  — was approved, privileges withdrawn (spam, gaming, etc.)
--
-- Why 'none' and 'revoked' matter even though unused on day one:
--   'none' avoids NULL in WHERE clauses; queries stay simple and indexable.
--   'revoked' lets us freeze a tipster's POST /api/picks ability without
--     deleting their track record. Adding it later would require backfill
--     + query audit, so we add it now even though it's unused at launch.
--
-- tipster_revoked_at is a companion audit timestamp. Gate check is
-- tipster_status='approved' AND tipster_revoked_at IS NULL — belt and
-- suspenders against any path that flips status without clearing the
-- timestamp (or vice versa).

ALTER TABLE users ADD COLUMN IF NOT EXISTS tipster_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE users ADD COLUMN IF NOT EXISTS tipster_approved_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tipster_revoked_at  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tipster_specialty TEXT;
-- tipster_specialty: one of 'nba'|'nfl'|'mlb'|'nhl'|'soccer'|'props'|'parlays'
-- Kept as free text (not enum) so we can add sports without schema churn.

-- Normalise any pre-existing NULL rows before the CHECK constraint lands.
UPDATE users SET tipster_status = 'none' WHERE tipster_status IS NULL;

-- Explicit enum via CHECK. Drop + re-add is idempotent.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tipster_status_chk;
ALTER TABLE users ADD CONSTRAINT users_tipster_status_chk
  CHECK (tipster_status IN ('none', 'applied', 'approved', 'rejected', 'revoked'));

CREATE INDEX IF NOT EXISTS idx_users_tipster_status
  ON users(tipster_status) WHERE tipster_status <> 'none';
CREATE INDEX IF NOT EXISTS idx_users_tipster_approved
  ON users(tipster_approved_at DESC) WHERE tipster_status = 'approved';
-- Partial index for the POST /api/picks gate: only active tipsters. Keeps
-- the gate lookup single-digit milliseconds even as the users table grows.
CREATE INDEX IF NOT EXISTS idx_users_tipster_active
  ON users(id) WHERE tipster_status = 'approved' AND tipster_revoked_at IS NULL;

-- ── tipster_applications ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tipster_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- users.id is TEXT in this codebase (not UUID). All user refs follow suit.
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  email TEXT,                          -- fallback if the applicant isn't signed in
  handle TEXT NOT NULL,                -- X/Twitter handle without @
  picks_link TEXT,                     -- link to last 30 days of public picks
  units_tracked_90d NUMERIC,           -- self-reported units won/lost last 90d
  specialty TEXT NOT NULL,             -- one of the specialty values
  reach_screenshot_url TEXT,           -- followers + engagement screenshot
  failure_mode TEXT,                   -- "what would make this platform fail for you?"
  why_me TEXT,                         -- short pitch, 500 char cap
  status TEXT NOT NULL DEFAULT 'pending',  -- pending/approved/rejected
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,                   -- private admin notes
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('pending', 'approved', 'rejected')),
  CHECK (why_me IS NULL OR length(why_me) <= 500),
  CHECK (failure_mode IS NULL OR length(failure_mode) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_tipster_apps_status ON tipster_applications(status);
CREATE INDEX IF NOT EXISTS idx_tipster_apps_created ON tipster_applications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tipster_apps_user ON tipster_applications(user_id);
-- One pending application per user at a time (approved/rejected rows don't block
-- re-application). Partial unique index keeps the constraint tight.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tipster_apps_one_pending_per_user
  ON tipster_applications(user_id) WHERE status = 'pending' AND user_id IS NOT NULL;
