-- ─────────────────────────────────────────────────────────────────────────────
-- HYPERFLEX — CPMM Dynamic Odds Migration
-- Run this in Supabase Dashboard → SQL Editor
-- Prerequisites: supabase_migration_community_economy.sql must be run first
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Adds yes_pool and no_pool to markets.
-- Price formula: yes_price = yes_pool / (yes_pool + no_pool)
--
-- Default seed: 5000 centpoints (50 pts) per side → initial price = 0.5
-- PostgreSQL will backfill all existing rows with these defaults.
--
ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS yes_pool BIGINT NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS no_pool  BIGINT NOT NULL DEFAULT 5000;

-- Sync yes_price / no_price for all existing markets from their new pool values
-- (Existing markets have 5000/5000, so price stays 0.5 — this is a no-op in practice
--  but ensures the formula is the source of truth going forward.)
UPDATE markets
SET
  yes_price = yes_pool::float / (yes_pool + no_pool),
  no_price  = no_pool::float  / (yes_pool + no_pool)
WHERE yes_pool + no_pool > 0;
