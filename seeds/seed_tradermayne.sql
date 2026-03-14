-- ════════════════════════════════════════════════════════════
-- HYPERFLEX — TraderMayne Community Seed
-- Free Premium (platinum) account
-- Community: hyperflex.network/tradermayne
-- Creator login: tradermayne@hyperflex.network / HyperflexDemo2026!
-- ════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_creator_id UUID;
BEGIN

-- ── 1. Creator user ───────────────────────────────────────────
INSERT INTO users (email, password_hash, display_name, is_creator, tenant_slug, balance)
VALUES (
  'tradermayne@hyperflex.network',
  '$2b$12$Uy14b4qs8nx/qK5/Ceudwe29q1htH5fG2hhze/IM4IYBKTsdvkxCy',
  'TraderMayne',
  true,
  'tradermayne',
  100000000
)
ON CONFLICT (email) DO NOTHING
RETURNING id INTO v_creator_id;

IF v_creator_id IS NULL THEN
  SELECT id INTO v_creator_id FROM users WHERE email = 'tradermayne@hyperflex.network';
END IF;

-- ── 2. Creator settings (Free Premium) ───────────────────────
INSERT INTO creator_settings (
  creator_id, slug, display_name,
  custom_points_name, primary_color, community_description,
  is_active, plan, starting_balance, min_bet, max_bet,
  suggestions_enabled, created_at
)
VALUES (
  v_creator_id,
  'tradermayne',
  'TraderMayne',
  'Mayne Points',
  '#f7931a',
  'Price action. No indicators. No BS. Put your Mayne Points on the next move before it happens — then let the market prove you right. Markets with Mayne, now with a leaderboard.',
  true,
  'platinum',
  100000,
  1000,
  50000,
  true,
  NOW()
)
ON CONFLICT (slug) DO UPDATE SET
  display_name          = EXCLUDED.display_name,
  custom_points_name    = EXCLUDED.custom_points_name,
  primary_color         = EXCLUDED.primary_color,
  community_description = EXCLUDED.community_description,
  plan                  = EXCLUDED.plan;

SELECT creator_id INTO v_creator_id FROM creator_settings WHERE slug = 'tradermayne';

-- ── 3. Markets ────────────────────────────────────────────────
INSERT INTO markets (id, creator_id, question, category, expiry_date, yes_price, no_price, yes_pool, no_pool, trader_count, resolved, archived, created_at)
VALUES
  (gen_random_uuid(), v_creator_id,
   'Will Bitcoin close above $90K by end of April 2026?',
   'crypto', NOW() + INTERVAL '47 days',
   0.62, 0.38, 31000, 19000, 743, false, false, NOW() - INTERVAL '2 days'),

  (gen_random_uuid(), v_creator_id,
   'Will Ethereum reclaim $3,000 before May 2026?',
   'crypto', NOW() + INTERVAL '60 days',
   0.44, 0.56, 22000, 28000, 518, false, false, NOW() - INTERVAL '1 day'),

  (gen_random_uuid(), v_creator_id,
   'Will BTC dominance stay above 60% through Q2 2026?',
   'crypto', NOW() + INTERVAL '77 days',
   0.58, 0.42, 29000, 21000, 621, false, false, NOW() - INTERVAL '3 days'),

  (gen_random_uuid(), v_creator_id,
   'Will the Fed cut rates at the May 2026 FOMC meeting?',
   'finance', NOW() + INTERVAL '52 days',
   0.38, 0.62, 19000, 31000, 412, false, false, NOW() - INTERVAL '4 days'),

  (gen_random_uuid(), v_creator_id,
   'Will Solana outperform ETH in April 2026?',
   'crypto', NOW() + INTERVAL '47 days',
   0.51, 0.49, 25500, 24500, 834, false, false, NOW() - INTERVAL '6 hours'),

  (gen_random_uuid(), v_creator_id,
   'Will Bitcoin hit a new all-time high before July 2026?',
   'crypto', NOW() + INTERVAL '108 days',
   0.71, 0.29, 35500, 14500, 1102, false, false, NOW() - INTERVAL '5 days'),

  (gen_random_uuid(), v_creator_id,
   'Will the total crypto market cap exceed $4T in 2026?',
   'crypto', NOW() + INTERVAL '260 days',
   0.49, 0.51, 24500, 25500, 389, false, false, NOW() - INTERVAL '2 days'),

  (gen_random_uuid(), v_creator_id,
   'Will XRP flip ETH by market cap before end of 2026?',
   'crypto', NOW() + INTERVAL '260 days',
   0.27, 0.73, 13500, 36500, 567, false, false, NOW() - INTERVAL '1 day');

-- ── 4. Announcements ──────────────────────────────────────────
INSERT INTO creator_announcements (creator_slug, title, body, pinned, created_at)
VALUES
  ('tradermayne', '👋 Welcome to Markets with Mayne — put your calls on record',
   'No more "I called that" without receipts. Drop your Mayne Points on the next move before it happens. Live odds, real-time leaderboard, streak multipliers. Prove you''re not just another hindsight trader.',
   true, NOW() - INTERVAL '2 days'),
  ('tradermayne', '🔥 BTC ATH market is live — 1,100+ traders already in',
   'Will Bitcoin hit a new all-time high before July? 71% of the community says yes. Are you fading or riding?',
   false, NOW() - INTERVAL '4 hours');

RAISE NOTICE 'TraderMayne community seeded. Live at hyperflex.network/tradermayne';

END $$;
