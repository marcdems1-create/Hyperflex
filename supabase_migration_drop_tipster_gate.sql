-- T1 — Rip the tipster gate. One account type for everyone.
--
-- Pre-pivot, the product separated "tipster" from regular user via an
-- application funnel and an admin approval queue. This ticket drops the
-- separation: anyone signed in can post a pick. Quality is enforced by
-- the Flex Score math (sample minimum, CLV weighting, time decay) — not
-- by permission gates.
--
-- Runs BEFORE the companion code changes land in server.js, picks.html,
-- and the admin dashboard. The code changes remove every query that
-- reads the dropped columns.
--
-- Idempotent: all operations use IF EXISTS / IF NOT EXISTS.

BEGIN;

-- Application funnel gone entirely — no more "apply / pending / approved".
DROP TABLE IF EXISTS tipster_applications CASCADE;

-- Rename the public-facing handle column to something every user can own,
-- not just approved tipsters. Preserves data on existing approved tipsters
-- (~25 rows at founding cohort cap).
ALTER TABLE users RENAME COLUMN tipster_handle TO handle;

-- Drop the permission / review machinery. `handle` is what remains — just
-- a free-form public identity, unique per user.
ALTER TABLE users DROP COLUMN IF EXISTS tipster_status;
ALTER TABLE users DROP COLUMN IF EXISTS tipster_approved_at;
ALTER TABLE users DROP COLUMN IF EXISTS tipster_revoked_at;
ALTER TABLE users DROP COLUMN IF EXISTS tipster_revoked_reason;

-- Specialty was admin-selected at approval time. Diversity in Flex Score
-- v1 is computed from actual pick activity (≥2 sports OR ≥2 bet types),
-- so the self-declared field is no longer used.
ALTER TABLE users DROP COLUMN IF EXISTS tipster_specialty;

-- Preserve handle uniqueness. CHECK: lowercase, alnum + underscore, 1..30.
-- Matches the sanitiser the approval flow used — existing approved
-- handles already conform.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_handle_format_check;
ALTER TABLE users ADD CONSTRAINT users_handle_format_check
  CHECK (handle IS NULL OR handle ~ '^[a-z0-9_]{1,30}$');

-- The old index was on tipster_handle; drop and recreate on the new name.
DROP INDEX IF EXISTS idx_users_tipster_handle;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle
  ON users (handle) WHERE handle IS NOT NULL;

COMMIT;
