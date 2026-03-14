-- ════════════════════════════════════════════════════════════
-- HYPERFLEX — Whiteboard Finance Community Seed
-- Free Premium (platinum) account
-- Community: hyperflex.network/whiteboardfinance
-- Creator login: whiteboardfinance@hyperflex.network / HyperflexDemo2026!
-- ════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_creator_id UUID;
BEGIN

-- ── 1. Creator user ───────────────────────────────────────────
INSERT INTO users (email, password_hash, display_name, is_creator, tenant_slug, balance)
VALUES (
  'whiteboardfinance@hyperflex.network',
  '$2b$12$Uy14b4qs8nx/qK5/Ceudwe29q1htH5fG2hhze/IM4IYBKTsdvkxCy',
  'Whiteboard Finance',
  true,
  'whiteboardfinance',
  100000000
)
ON CONFLICT (email) DO NOTHING
RETURNING id INTO v_creator_id;

IF v_creator_id IS NULL THEN
  SELECT id INTO v_creator_id FROM users WHERE email = 'whiteboardfinance@hyperflex.network';
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
  'whiteboardfinance',
  'Whiteboard Finance',
  'WB Points',
  '#0ea5e9',
  'You understand the economy better than most — now prove it. Put WB Points on rate decisions, recessions, market calls, and the economic questions everyone is debating. The leaderboard rewards people who actually did the research.',
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

SELECT creator_id INTO v_creator_id FROM creator_settings WHERE slug = 'whiteboardfinance';

-- ── 3. Markets ────────────────────────────────────────────────
INSERT INTO markets (id, creator_id, question, category, expiry_date, yes_price, no_price, yes_pool, no_pool, trader_count, resolved, archived, created_at)
VALUES
  (gen_random_uuid(), v_creator_id,
   'Will the US enter a recession before end of 2026?',
   'finance', NOW() + INTERVAL '260 days',
   0.35, 0.65, 17500, 32500, 1102, false, false, NOW() - INTERVAL '2 days'),

  (gen_random_uuid(), v_creator_id,
   'Will US national debt exceed $40 trillion in 2026?',
   'finance', NOW() + INTERVAL '260 days',
   0.78, 0.22, 39000, 11000, 643, false, false, NOW() - INTERVAL '3 days'),

  (gen_random_uuid(), v_creator_id,
   'Will the Fed cut rates more than 3 times in 2026?',
   'finance', NOW() + INTERVAL '260 days',
   0.24, 0.76, 12000, 38000, 512, false, false, NOW() - INTERVAL '5 days'),

  (gen_random_uuid(), v_creator_id,
   'Will inflation (CPI) stay above 3% for all of H1 2026?',
   'finance', NOW() + INTERVAL '90 days',
   0.41, 0.59, 20500, 29500, 387, false, false, NOW() - INTERVAL '4 days'),

  (gen_random_uuid(), v_creator_id,
   'Will US commercial real estate see a major correction in 2026?',
   'finance', NOW() + INTERVAL '260 days',
   0.56, 0.44, 28000, 22000, 734, false, false, NOW() - INTERVAL '1 day'),

  (gen_random_uuid(), v_creator_id,
   'Will Bitcoin be worth more than gold (per unit) in 2026?',
   'crypto', NOW() + INTERVAL '260 days',
   0.33, 0.67, 16500, 33500, 445, false, false, NOW() - INTERVAL '6 days'),

  (gen_random_uuid(), v_creator_id,
   'Will the dollar index (DXY) drop below 95 in 2026?',
   'finance', NOW() + INTERVAL '260 days',
   0.29, 0.71, 14500, 35500, 321, false, false, NOW() - INTERVAL '2 days'),

  (gen_random_uuid(), v_creator_id,
   'Will the S&P 500 P/E ratio compress below 20 in 2026?',
   'finance', NOW() + INTERVAL '260 days',
   0.21, 0.79, 10500, 39500, 289, false, false, NOW() - INTERVAL '1 day');

-- ── 4. Announcements ──────────────────────────────────────────
INSERT INTO creator_announcements (creator_slug, title, body, pinned, created_at)
VALUES
  ('whiteboardfinance', '📉 Welcome to Whiteboard Finance Markets — your macro calls, on record',
   'Rate decisions, recessions, debt ceilings, and real estate — the topics you actually understand. Put your WB Points behind the calls and let the community leaderboard show who''s right. No hindsight allowed.',
   true, NOW() - INTERVAL '2 days'),
  ('whiteboardfinance', '🏛️ National debt market: 78% say $40T is inevitable',
   'The US national debt exceeding $40T market has 640+ traders and overwhelming consensus. Are you in the majority or fading the math?',
   false, NOW() - INTERVAL '7 hours');

RAISE NOTICE 'Whiteboard Finance community seeded. Live at hyperflex.network/whiteboardfinance';

END $$;
