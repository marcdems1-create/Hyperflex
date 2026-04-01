-- Migration: creator_nominations table for fan follow-up emails
CREATE TABLE IF NOT EXISTS creator_nominations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_name TEXT NOT NULL,
  creator_url TEXT,
  fan_name TEXT,
  fan_email TEXT,
  message TEXT,
  notified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creator_nominations_notified ON creator_nominations(notified);
