-- ════════════════════════════════════════════════════════════
-- HYPERFLEX — WallStreetBets Demo Community Seed
-- Run in Supabase SQL Editor AFTER all migrations are applied.
--
-- What this does:
--   1. Creates a demo creator user (password: HyperflexDemo2026!)
--   2. Creates creator_settings for slug = 'wallstreetbets'
--   3. Seeds 8 live prediction markets with realistic pool weights
--   4. Creates a few pinned announcements
--
-- After running:
--   • Community is live at hyperflex.network/wallstreetbets
--   • Log in at /creator/login with demo@hyperflex.network
--     to manage it from the creator dashboard
-- ════════════════════════════════════════════════════════════

-- ── Step 1: Create demo creator user ─────────────────────────
-- Password: HyperflexDemo2026!  (bcrypt rounds=12, pre-hashed)

DO $$
DECLARE
  demo_user_id UUID;
  m1 UUID; m2 UUID; m3 UUID; m4 UUID;
  m5 UUID; m6 UUID; m7 UUID; m8 UUID;
BEGIN

-- ── 1. Insert demo creator user ───────────────────────────────
INSERT INTO users (email, password_hash, display_name, is_creator, tenant_slug, balance)
VALUES (
  'demo@hyperflex.network',
  '$2b$12$Uy14b4qs8nx/qK5/Ceudwe29q1htH5fG2hhze/IM4IYBKTsdvkxCy',
  'WallStreetBets',
  true,
  'wallstreetbets',
  100000000  -- 1,000,000 pts starting balance
)
ON CONFLICT (email) DO NOTHING
RETURNING id INTO demo_user_id;

-- If user already exists, fetch their id
IF demo_user_id IS NULL THEN
  SELECT id INTO demo_user_id FROM users WHERE email = 'demo@hyperflex.network';
END IF;

-- ── 2. Create creator settings ────────────────────────────────
INSERT INTO creator_settings (
  creator_id, slug, display_name, community_name,
  custom_points_name, primary_color, community_description,
  is_active, plan, starting_balance, min_bet, max_bet,
  suggestions_enabled, created_at
)
VALUES (
  demo_user_id,
  'wallstreetbets',
  'WallStreetBets',
  'WallStreetBets',
  'Tendies',
  '#00b300',
  'The most degenerate prediction market on the internet. We like the stock. Put your Tendies where your mouth is — predict earnings, squeezes, and the next meme stock before it moons. 🚀🦍',
  true,
  'platinum',
  100000,   -- 1,000 Tendies starting balance
  1000,     -- min 10 Tendies
  50000,    -- max 500 Tendies per bet
  true,
  NOW()
)
ON CONFLICT (slug) DO UPDATE SET
  display_name       = EXCLUDED.display_name,
  community_name     = EXCLUDED.community_name,
  custom_points_name = EXCLUDED.custom_points_name,
  primary_color      = EXCLUDED.primary_color,
  community_description = EXCLUDED.community_description,
  plan               = EXCLUDED.plan;

-- Re-fetch creator_id from settings in case of conflict update
SELECT creator_id INTO demo_user_id FROM creator_settings WHERE slug = 'wallstreetbets';

-- ── 3. Seed markets ───────────────────────────────────────────
-- Market 1: GME squeeze
INSERT INTO markets (
  id, creator_id, question, category, expiry_date,
  yes_price, no_price, yes_pool, no_pool,
  trader_count, resolved, archived, created_at
) VALUES (
  gen_random_uuid(), demo_user_id,
  'Will GME squeeze above $50 before end of Q2 2026?',
  'finance',
  NOW() + INTERVAL '45 days',
  0.68, 0.32, 34000, 16000,
  847, false, false, NOW() - INTERVAL '3 days'
) RETURNING id INTO m1;

-- Market 2: Fed rate cut
INSERT INTO markets (
  id, creator_id, question, category, expiry_date,
  yes_price, no_price, yes_pool, no_pool,
  trader_count, resolved, archived, created_at
) VALUES (
  gen_random_uuid(), demo_user_id,
  'Will the Fed cut rates at the May 2026 FOMC meeting?',
  'finance',
  NOW() + INTERVAL '52 days',
  0.41, 0.59, 20500, 29500,
  612, false, false, NOW() - INTERVAL '5 days'
) RETURNING id INTO m2;

-- Market 3: NVDA earnings
INSERT INTO markets (
  id, creator_id, question, category, expiry_date,
  yes_price, no_price, yes_pool, no_pool,
  trader_count, resolved, archived, created_at
) VALUES (
  gen_random_uuid(), demo_user_id,
  'Will NVIDIA beat earnings estimates in Q1 2026?',
  'finance',
  NOW() + INTERVAL '38 days',
  0.79, 0.21, 39500, 10500,
  1203, false, false, NOW() - INTERVAL '2 days'
) RETURNING id INTO m3;

-- Market 4: Bitcoin 100k
INSERT INTO markets (
  id, creator_id, question, category, expiry_date,
  yes_price, no_price, yes_pool, no_pool,
  trader_count, resolved, archived, created_at
) VALUES (
  gen_random_uuid(), demo_user_id,
  'Will Bitcoin hit $120K before June 2026?',
  'crypto',
  NOW() + INTERVAL '77 days',
  0.55, 0.45, 27500, 22500,
  934, false, false, NOW() - INTERVAL '1 day'
) RETURNING id INTO m4;

-- Market 5: AMC comeback
INSERT INTO markets (
  id, creator_id, question, category, expiry_date,
  yes_price, no_price, yes_pool, no_pool,
  trader_count, resolved, archived, created_at
) VALUES (
  gen_random_uuid(), demo_user_id,
  'Will AMC stock double from its current price by July 2026?',
  'finance',
  NOW() + INTERVAL '90 days',
  0.22, 0.78, 11000, 39000,
  418, false, false, NOW() - INTERVAL '4 days'
) RETURNING id INTO m5;

-- Market 6: Recession
INSERT INTO markets (
  id, creator_id, question, category, expiry_date,
  yes_price, no_price, yes_pool, no_pool,
  trader_count, resolved, archived, created_at
) VALUES (
  gen_random_uuid(), demo_user_id,
  'Will the US enter a technical recession by end of 2026?',
  'finance',
  NOW() + INTERVAL '260 days',
  0.37, 0.63, 18500, 31500,
  729, false, false, NOW() - INTERVAL '6 days'
) RETURNING id INTO m6;

-- Market 7: Roaring Kitty
INSERT INTO markets (
  id, creator_id, question, category, expiry_date,
  yes_price, no_price, yes_pool, no_pool,
  trader_count, resolved, archived, created_at
) VALUES (
  gen_random_uuid(), demo_user_id,
  'Will Roaring Kitty post again before end of April 2026?',
  'culture',
  NOW() + INTERVAL '47 days',
  0.61, 0.39, 30500, 19500,
  1587, false, false, NOW() - INTERVAL '7 hours'
) RETURNING id INTO m7;

-- Market 8: Apple stock
INSERT INTO markets (
  id, creator_id, question, category, expiry_date,
  yes_price, no_price, yes_pool, no_pool,
  trader_count, resolved, archived, created_at
) VALUES (
  gen_random_uuid(), demo_user_id,
  'Will AAPL reach $250 before the end of Q2 2026?',
  'finance',
  NOW() + INTERVAL '60 days',
  0.48, 0.52, 24000, 26000,
  556, false, false, NOW() - INTERVAL '2 days'
) RETURNING id INTO m8;

-- ── 4. Seed creator announcements ─────────────────────────────
INSERT INTO creator_announcements (creator_slug, title, body, pinned, created_at)
VALUES
(
  'wallstreetbets',
  '🚀 Welcome to the WSB Prediction Market — put your Tendies on it',
  'This is the only prediction market where your galaxy-brain trades can finally be proven right. Or spectacularly wrong. Place bets on earnings, squeezes, rate decisions, and meme stocks. Top apes get rewards. 🦍💎🙌',
  true,
  NOW() - INTERVAL '2 days'
),
(
  'wallstreetbets',
  '📊 NVDA earnings market is heating up — 1,200+ apes already in',
  'The "Will NVIDIA beat earnings?" market just crossed 1,200 traders. Bears are getting rekt. Are you in?',
  false,
  NOW() - INTERVAL '12 hours'
);

RAISE NOTICE 'WallStreetBets demo community seeded successfully.';
RAISE NOTICE 'Community URL: hyperflex.network/wallstreetbets';
RAISE NOTICE 'Creator login: demo@hyperflex.network / HyperflexDemo2026!';

END $$;
