-- Migration #49: users.tipster_handle for /t/:handle public URLs
--
-- The tipster_applications table stores the handle at application time,
-- but that's the wrong source of truth for profile URLs — an application
-- row can be rejected, superseded, or belong to a user whose status later
-- changes. We want one denormalised column on users that is:
--   - set exactly when a tipster is approved (copied from their app)
--   - unique across the active tipster population
--   - lowercase (case-insensitive routing in /t/:handle)
--
-- UNIQUE partial index means rejected/revoked rows don't block a handle
-- from being reused if we ever flip someone back to 'approved' manually.

ALTER TABLE users ADD COLUMN IF NOT EXISTS tipster_handle TEXT;

-- Normalise: stored handle is always lowercase, no @ prefix, no spaces.
-- Callers must normalise before insert; this CHECK is belt-and-suspenders.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tipster_handle_fmt;
ALTER TABLE users ADD CONSTRAINT users_tipster_handle_fmt
  CHECK (tipster_handle IS NULL OR tipster_handle ~ '^[a-z0-9_]{1,30}$');

-- Unique among approved tipsters only. Revoked/rejected don't hold slots.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tipster_handle_unique
  ON users(tipster_handle) WHERE tipster_status = 'approved' AND tipster_handle IS NOT NULL;

-- Lookup index for the public /api/tipster/:handle endpoint.
CREATE INDEX IF NOT EXISTS idx_users_tipster_handle_lookup
  ON users(tipster_handle) WHERE tipster_handle IS NOT NULL;
