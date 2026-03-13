-- ─────────────────────────────────────────────────────────────────────────────
-- HYPERFLEX — Resonance Score Migration
-- Run this in Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds resonance_score to markets.
-- Scored 1-10 by Claude at market creation time.
-- Higher = AI thinks this market will drive more community engagement.
-- NULL = not yet scored (markets created before this migration).

ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS resonance_score SMALLINT;
