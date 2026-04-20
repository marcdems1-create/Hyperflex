-- S1.a — @username canonical profile URL.
--
-- T1 already renamed tipster_handle → handle, added a partial UNIQUE index,
-- and a CHECK allowing 1..30 lowercase alnum/underscore. This migration
-- tightens the CHECK to 3..30 (a 1-char handle is ugly and vulnerable to
-- typosquatting) and adds a `reserved_handles` table so the handle-claim
-- endpoint can block top-level route names (admin, api, dashboard, etc).
--
-- Self-healing on boot: server.js populates handles for any rows where
-- handle IS NULL, derived from wallet_address or display_name. Runs once
-- per cold start, logs how many it auto-assigned.

BEGIN;

-- Tighten the handle format check (3-30 chars). Existing 1-char handles
-- (if any) get migrated via the auto-generate path on next boot.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_handle_format_check;
ALTER TABLE users ADD CONSTRAINT users_handle_format_check
  CHECK (handle IS NULL OR handle ~ '^[a-z0-9_]{3,30}$');

-- Case-insensitive uniqueness. A user can't claim @Marc if @marc exists
-- — matters for vanity handles.
DROP INDEX IF EXISTS idx_users_handle;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle_ci
  ON users (LOWER(handle)) WHERE handle IS NOT NULL;

-- Reserved handles — top-level route names + brand terms. Populated once;
-- admins can add more via a simple INSERT. POST /api/user/handle checks
-- this before allowing a claim.
CREATE TABLE IF NOT EXISTS reserved_handles (
  handle TEXT PRIMARY KEY,
  reason TEXT,
  added_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO reserved_handles (handle, reason) VALUES
  -- Top-level routes that exist or are planned
  ('admin', 'route'), ('api', 'route'), ('auth', 'route'), ('dashboard', 'route'),
  ('feed', 'route'), ('home', 'route'), ('landing', 'route'), ('login', 'route'),
  ('logout', 'route'), ('me', 'route'), ('predictors', 'route'), ('picks', 'route'),
  ('profile', 'route'), ('settings', 'route'), ('signup', 'route'), ('terminal', 'route'),
  ('alpha', 'route'), ('alpha-live', 'route'), ('arbitrage', 'route'), ('brief', 'route'),
  ('community', 'route'), ('compare', 'route'), ('creator', 'route'),
  ('crystal-ball', 'route'), ('data', 'route'), ('embed', 'route'), ('events', 'route'),
  ('explore', 'route'), ('flex', 'route'), ('leaderboard', 'route'), ('market', 'route'),
  ('markets', 'route'), ('nominate', 'route'), ('odds', 'route'), ('onboard', 'route'),
  ('passport', 'route'), ('privacy', 'route'), ('rewards', 'route'), ('screener', 'route'),
  ('search', 'route'), ('share', 'route'), ('signals', 'route'), ('sports', 'route'),
  ('sports_predictors', 'route'), ('spread_scanner', 'route'), ('t', 'route'),
  ('templates', 'route'), ('terms', 'route'), ('trader', 'route'), ('u', 'route'),
  ('win', 'route'), ('whales', 'route'), ('whale_index', 'route'),
  -- Brand/admin words nobody gets
  ('hyperflex', 'brand'), ('hf', 'brand'), ('official', 'brand'),
  ('support', 'brand'), ('help', 'brand'), ('team', 'brand'),
  ('security', 'brand'), ('staff', 'brand'), ('system', 'brand'),
  ('root', 'brand'), ('moderator', 'brand'), ('mod', 'brand'),
  ('null', 'brand'), ('undefined', 'brand'), ('test', 'brand')
ON CONFLICT (handle) DO NOTHING;

COMMIT;
