-- ════════════════════════════════════════════════════════════
-- HYPERFLEX — Andrei Jikh Community Seed
-- Free Premium (platinum) account
-- Community: hyperflex.network/andreijikh
-- Creator login: andreijikh@hyperflex.network / HyperflexDemo2026!
-- ════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_creator_id UUID;
BEGIN

-- ── 1. Creator user ───────────────────────────────────────────
INSERT INTO users (email, password_hash, display_name, is_creator, tenant_slug, balance)
VALUES (
  'andreijikh@hyperflex.network',
  '$2b$12$Uy14b4qs8nx/qK5/Ceudwe29q1htH5fG2hhze/IM4IYBKTsdvkxCy',
  'Andrei Jikh',
  true,
  'andreijikh',
  100000000
)
ON CONFLICT (email) DO NOTHING
RETURNING id INTO v_creator_id;

IF v_creator_id IS NULL THEN
  SELECT id INTO v_creator_id FROM users WHERE email = 'andreijikh@hyperflex.network';
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
  'andreijikh',
  'Andrei Jikh',
  'Jikh Points',
  '#7c3aed',
  'Think you know where the market is heading? Prove it. Put your Jikh Points on stocks, crypto, and macro calls before they happen. The community leaderboard doesn''t lie — only your portfolio does.',
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

SELECT creator_id INTO v_creator_id FROM creator_settings WHERE slug = 'andreijikh';

-- ── 3. Markets ────────────────────────────────────────────────
INSERT INTO markets (id, creator_id, question, category, expiry_date, yes_price, no_price, yes_pool, no_pool, trader_count, resolved, archived, created_at)
VALUES
  (gen_random_uuid(), v_creator_id,
   'Will the S&P 500 reach 6,500 before end of Q2 2026?',
   'finance', NOW() + INTERVAL '77 days',
   0.48, 0.52, 24000, 26000, 712, false, false, NOW() - INTERVAL '2 days'),

  (gen_random_uuid(), v_creator_id,
   'Will Bitcoin hit a new all-time high before July 2026?',
   'crypto', NOW() + INTERVAL '108 days',
   0.69, 0.31, 34500, 15500, 983, false, false, NOW() - INTERVAL '1 day'),

  (gen_random_uuid(), v_creator_id,
   'Will the Fed cut rates at least twice in 2026?',
   'finance', NOW() + INTERVAL '260 days',
   0.57, 0.43, 28500, 21500, 541, false, false, NOW() - INTERVAL '4 days'),

  (gen_random_uuid(), v_creator_id,
   'Will NVDA stock reach $200 before end of Q2 2026?',
   'finance', NOW() + INTERVAL '77 days',
   0.45, 0.55, 22500, 27500, 867, false, false, NOW() - INTERVAL '3 days'),

  (gen_random_uuid(), v_creator_id,
   'Will the US unemployment rate rise above 5% in 2026?',
   'finance', NOW() + INTERVAL '260 days',
   0.29, 0.71, 14500, 35500, 398, false, false, NOW() - INTERVAL '5 days'),

  (gen_random_uuid(), v_creator_id,
   'Will Ethereum reclaim $3,500 before June 2026?',
   'crypto', NOW() + INTERVAL '77 days',
   0.38, 0.62, 19000, 31000, 624, false, false, NOW() - INTERVAL '2 days'),

  (gen_random_uuid(), v_creator_id,
   'Will gold hit $3,500/oz before end of 2026?',
   'finance', NOW() + INTERVAL '260 days',
   0.52, 0.48, 26000, 24000, 445, false, false, NOW() - INTERVAL '6 days'),

  (gen_random_uuid(), v_creator_id,
   'Will Apple release an AI-native iPhone model in 2026?',
   'tech', NOW() + INTERVAL '260 days',
   0.74, 0.26, 37000, 13000, 589, false, false, NOW() - INTERVAL '1 day');

-- ── 4. Announcements ──────────────────────────────────────────
INSERT INTO creator_announcements (creator_slug, title, body, pinned, created_at)
VALUES
  ('andreijikh', '🎯 Welcome to Andrei Jikh Markets — back your convictions',
   'Stop watching from the sidelines. Put your Jikh Points on the macro calls, stock plays, and crypto bets everyone''s debating. Live leaderboard, streak multipliers, and bragging rights that are actually verifiable.',
   true, NOW() - INTERVAL '2 days'),
  ('andreijikh', '📈 BTC ATH market live — community is 69% YES',
   'The Bitcoin new all-time high before July market just crossed 980 traders. Nearly 70% are bullish. Where do you stand?',
   false, NOW() - INTERVAL '5 hours');

RAISE NOTICE 'Andrei Jikh community seeded. Live at hyperflex.network/andreijikh';

END $$;
