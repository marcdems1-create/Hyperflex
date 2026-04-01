-- Migration: featured markets for Editor's Picks section
ALTER TABLE markets ADD COLUMN IF NOT EXISTS featured BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_markets_featured ON markets(featured) WHERE featured = true;
