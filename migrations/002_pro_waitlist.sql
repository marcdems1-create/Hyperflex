-- Pro Waitlist
-- Captures creator emails interested in HYPERFLEX Pro before launch.
-- Run this in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS pro_waitlist (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT        NOT NULL,
  creator_id  UUID,                          -- nullable: may be submitted by non-creators in future
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Prevent duplicate emails on the waitlist
CREATE UNIQUE INDEX IF NOT EXISTS idx_pro_waitlist_email ON pro_waitlist(email);

-- Index for lookups by creator
CREATE INDEX IF NOT EXISTS idx_pro_waitlist_creator_id ON pro_waitlist(creator_id);

-- Disable RLS (service key used server-side)
ALTER TABLE pro_waitlist DISABLE ROW LEVEL SECURITY;
