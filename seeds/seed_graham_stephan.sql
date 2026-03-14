-- ════════════════════════════════════════════════════════════
-- HYPERFLEX — Graham Stephan Community Seed
-- Free Premium (platinum) account
-- Community: hyperflex.network/grahamstephan
-- Creator login: grahamstephan@hyperflex.network / HyperflexDemo2026!
-- ════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_creator_id UUID;
BEGIN

-- ── 1. Creator user ───────────────────────────────────────────
INSERT INTO users (email, password_hash, display_name, is_creator, tenant_slug, balance)
VALUES (
  'grahamstephan@hyperflex.network',
  '$2b$12$Uy14b4qs8nx/qK5/Ceudwe29q1htH5fG2hhze/IM4IYBKTsdvkxCy',
  'Graham Stephan',
  true,
  'grahamstephan',
  100000000
)
ON CONFLICT (email) DO NOTHING
RETURNING id INTO v_creator_id;

IF v_creator_id IS NULL THEN
  SELECT id INTO v_creator_id FROM users WHERE email = 'grahamstephan@hyperflex.network';
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
  'grahamstephan',
  'Graham Stephan',
  'Graham Bucks',
  '#16a34a',
  'Real estate, stocks, and financial independence — now with receipts. Put your Graham Bucks on the housing market, interest rate calls, and investment predictions before they play out. Leaderboard updated live.',
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

SELECT creator_id INTO v_creator_id FROM creator_settings WHERE slug = 'grahamstephan';

-- ── 3. Markets ────────────────────────────────────────────────
INSERT INTO markets (id, creator_id, question, category, expiry_date, yes_price, no_price, yes_pool, no_pool, trader_count, resolved, archived, created_at)
VALUES
  (gen_random_uuid(), v_creator_id,
   'Will US 30-year mortgage rates drop below 6% in 2026?',
   'finance', NOW() + INTERVAL '260 days',
   0.46, 0.54, 23000, 27000, 934, false, false, NOW() - INTERVAL '2 days'),

  (gen_random_uuid(), v_creator_id,
   'Will US median home prices rise more than 5% in 2026?',
   'finance', NOW() + INTERVAL '260 days',
   0.38, 0.62, 19000, 31000, 712, false, false, NOW() - INTERVAL '4 days'),

  (gen_random_uuid(), v_creator_id,
   'Will the Fed cut rates at least 3 times in 2026?',
   'finance', NOW() + INTERVAL '260 days',
   0.27, 0.73, 13500, 36500, 543, false, false, NOW() - INTERVAL '3 days'),

  (gen_random_uuid(), v_creator_id,
   'Will Bitcoin outperform the S&P 500 in 2026?',
   'finance', NOW() + INTERVAL '260 days',
   0.61, 0.39, 30500, 19500, 1087, false, false, NOW() - INTERVAL '1 day'),

  (gen_random_uuid(), v_creator_id,
   'Will Airbnb stock exceed $200 before end of 2026?',
   'finance', NOW() + INTERVAL '260 days',
   0.41, 0.59, 20500, 29500, 389, false, false, NOW() - INTERVAL '5 days'),

  (gen_random_uuid(), v_creator_id,
   'Will the S&P 500 end 2026 higher than it started?',
   'finance', NOW() + INTERVAL '290 days',
   0.67, 0.33, 33500, 16500, 1342, false, false, NOW() - INTERVAL '6 days'),

  (gen_random_uuid(), v_creator_id,
   'Will HYSAs (high-yield savings) still beat 4% APY by mid-2026?',
   'finance', NOW() + INTERVAL '90 days',
   0.33, 0.67, 16500, 33500, 456, false, false, NOW() - INTERVAL '2 days'),

  (gen_random_uuid(), v_creator_id,
   'Will Tesla stock outperform the market in Q2 2026?',
   'finance', NOW() + INTERVAL '77 days',
   0.44, 0.56, 22000, 28000, 621, false, false, NOW() - INTERVAL '1 day');

-- ── 4. Announcements ──────────────────────────────────────────
INSERT INTO creator_announcements (creator_slug, title, body, pinned, created_at)
VALUES
  ('grahamstephan', '🏠 Welcome to Graham Stephan Markets — back your financial calls',
   'Housing, interest rates, stocks, and financial freedom — put your Graham Bucks on the calls you believe in. Live community odds, a leaderboard that doesn''t reset, and streak multipliers for consistent winners.',
   true, NOW() - INTERVAL '2 days'),
  ('grahamstephan', '📈 S&P 500 ends 2026 higher — 1,300+ predict YES at 67%',
   'The "Will the S&P 500 end 2026 higher?" market is the most-traded on the board. Bulls are in firm control. Are you positioned?',
   false, NOW() - INTERVAL '6 hours');

RAISE NOTICE 'Graham Stephan community seeded. Live at hyperflex.network/grahamstephan';

END $$;
