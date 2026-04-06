-- Deduplicate wallet users: keep the OLDEST record per polymarket_address, delete the rest
-- Run this in Supabase SQL editor

-- Step 1: See what will be deleted (preview — run this first to check)
-- SELECT id, display_name, polymarket_address, created_at
-- FROM users
-- WHERE polymarket_address IS NOT NULL AND polymarket_address != ''
--   AND id NOT IN (
--     SELECT DISTINCT ON (LOWER(polymarket_address)) id
--     FROM users
--     WHERE polymarket_address IS NOT NULL AND polymarket_address != ''
--     ORDER BY LOWER(polymarket_address), created_at ASC
--   )
-- ORDER BY polymarket_address, created_at;

-- Step 2: Delete duplicates (keep oldest per wallet address)
DELETE FROM users
WHERE polymarket_address IS NOT NULL AND polymarket_address != ''
  AND id NOT IN (
    SELECT DISTINCT ON (LOWER(polymarket_address)) id
    FROM users
    WHERE polymarket_address IS NOT NULL AND polymarket_address != ''
    ORDER BY LOWER(polymarket_address), created_at ASC
  );

-- Step 3: Create unique index to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_polymarket_address_lower
  ON users (LOWER(polymarket_address))
  WHERE polymarket_address IS NOT NULL AND polymarket_address != '';
