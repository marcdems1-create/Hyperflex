-- Migration: subscribers table for daily briefing email signup
-- Run after all existing migrations

CREATE TABLE IF NOT EXISTS subscribers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick duplicate checks
CREATE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers (email);
