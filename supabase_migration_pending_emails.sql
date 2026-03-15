-- ── pending_emails — email queue for scheduled onboarding sequences ──────────
-- Processed by the hourly cron in server.js
-- Run in Supabase SQL editor

CREATE TABLE IF NOT EXISTS pending_emails (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email     TEXT        NOT NULL,
  subject      TEXT        NOT NULL,
  html         TEXT        NOT NULL,
  send_after   TIMESTAMPTZ NOT NULL,
  sent         BOOLEAN     NOT NULL DEFAULT false,
  sent_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_emails_unsent
  ON pending_emails (send_after)
  WHERE sent = false;
