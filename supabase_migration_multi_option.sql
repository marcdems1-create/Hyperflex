-- Migration: multi_option_markets
-- Adds support for markets with more than 2 outcome options.
-- Run this in the Supabase SQL editor.

ALTER TABLE markets ADD COLUMN IF NOT EXISTS options JSONB;

-- options is NULL for binary markets (unchanged behaviour).
-- For multi-option markets the value is a JSON array, e.g.:
-- [{"label":"Team A","votes":0,"pct":33},{"label":"Team B","votes":0,"pct":33},{"label":"Draw","votes":0,"pct":34}]
