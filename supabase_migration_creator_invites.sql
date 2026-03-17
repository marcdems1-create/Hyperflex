-- Migration: creator_invites
-- Tracks outreach emails sent to potential creators from the admin dashboard.
-- 'accepted' flips to true + accepted_at is stamped when a creator signs up
-- with a matching email address.

CREATE TABLE IF NOT EXISTS creator_invites (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  email       TEXT        NOT NULL,
  channel_url TEXT,
  note        TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted    BOOLEAN     NOT NULL DEFAULT FALSE,
  accepted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS creator_invites_email_idx ON creator_invites (email);
CREATE INDEX IF NOT EXISTS creator_invites_sent_idx  ON creator_invites (sent_at DESC);
