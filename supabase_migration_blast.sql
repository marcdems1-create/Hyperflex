-- Migration: add blasted_at to markets for per-market email blast rate limiting
ALTER TABLE markets ADD COLUMN IF NOT EXISTS blasted_at TIMESTAMPTZ DEFAULT NULL;
