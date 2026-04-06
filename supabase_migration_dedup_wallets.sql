-- Deduplicate wallet users: keep the OLDEST record per wallet, delete the rest
-- Handles BOTH polymarket_address duplicates AND display_name wallet duplicates
-- Run this in Supabase SQL editor

-- Step 1: Delete duplicates by polymarket_address (keep oldest)
DELETE FROM users
WHERE polymarket_address IS NOT NULL AND polymarket_address != ''
  AND id NOT IN (
    SELECT DISTINCT ON (LOWER(polymarket_address)) id
    FROM users
    WHERE polymarket_address IS NOT NULL AND polymarket_address != ''
    ORDER BY LOWER(polymarket_address), created_at ASC
  );

-- Step 2: Delete duplicates where display_name looks like a wallet address (0x...)
-- These are wallet-auth users with NULL polymarket_address
-- Keep the oldest per display_name pattern
DELETE FROM users
WHERE display_name ~ '^0x[a-fA-F0-9]{4}\.\.\..*$'
  AND (polymarket_address IS NULL OR polymarket_address = '')
  AND email IS NULL
  AND id NOT IN (
    SELECT DISTINCT ON (LOWER(display_name)) id
    FROM users
    WHERE display_name ~ '^0x[a-fA-F0-9]{4}\.\.\..*$'
      AND (polymarket_address IS NULL OR polymarket_address = '')
      AND email IS NULL
    ORDER BY LOWER(display_name), created_at ASC
  );

-- Step 3: Also catch wallet users where display_name is a full 0x address
DELETE FROM users
WHERE display_name ~ '^0x[a-fA-F0-9]{6,}$'
  AND email IS NULL
  AND id NOT IN (
    SELECT DISTINCT ON (LOWER(display_name)) id
    FROM users
    WHERE display_name ~ '^0x[a-fA-F0-9]{6,}$'
      AND email IS NULL
    ORDER BY LOWER(display_name), created_at ASC
  );

-- Step 4: Create unique index to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_polymarket_address_lower
  ON users (LOWER(polymarket_address))
  WHERE polymarket_address IS NOT NULL AND polymarket_address != '';
