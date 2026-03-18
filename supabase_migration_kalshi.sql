-- Kalshi integration: API key + username storage on users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS kalshi_api_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS kalshi_username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS manifold_username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS polymarket_address TEXT;
