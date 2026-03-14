-- ════════════════════════════════════════════════════════════
-- HYPERFLEX — Meet Kevin Community Seed
-- Free Premium (platinum) account
-- Community: hyperflex.network/meetkevin
-- Creator login: meetkevin@hyperflex.network / HyperflexDemo2026!
-- ════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_creator_id UUID;
BEGIN

-- ── 1. Creator user ───────────────────────────────────────────
INSERT INTO users (email, password_hash, display_name, is_creator, tenant_slug, balance)
VALUES (
  'meetkevin@hyperflex.network',
  '$2b$12$Uy14b4qs8nx/qK5/Ceudwe29q1htH5fG2hhze/IM4IYBKTsdvkxCy',
  'Meet Kevin',
  true,
  'meetkevin',
  100000000
)
ON CONFLICT (email) DO NOTHING
RETURNING id INTO v_creator_id;

IF v_creator_id IS NULL THEN
  SELECT id INTO v_creator_id FROM users WHERE email = 'meetkevin@hyperflex.network';
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
  'meetkevin',
  'Meet Kevin',
  'Kevin Coins',
  '#ef4444',
  'Everyone has opinions on the Fed, the housing market, and the next big play. Now put Kevin Coins on it. Real-time odds, community leaderboard, streak multipliers. The market is always open — are you positioned?',
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

SELECT creator_id INTO v_creator_id FROM creator_settings WHERE slug = 'meetkevin';

-- ── 3. Markets ────────────────────────────────────────────────
INSERT INTO markets (id, creator_id, question, category, expiry_date, yes_price, no_price, yes_pool, no_pool, trader_count, resolved, archived, created_at)
VALUES
  (gen_random_uuid(), v_creator_id,
   'Will the Fed cut rates at the May 2026 FOMC meeting?',
   'finance', NOW() + INTERVAL '52 days',
   0.39, 0.61, 19500, 30500, 1243, false, false, NOW() - INTERVAL '1 day'),

  (gen_random_uuid(), v_creator_id,
   'Will US housing prices fall more than 5% in 2026?',
   'finance', NOW() + INTERVAL '260 days',
   0.31, 0.69, 15500, 34500, 876, false, false, NOW() - INTERVAL '3 days'),

  (gen_random_uuid(), v_creator_id,
   'Will the S&P 500 hit a new ATH before end of Q2 2026?',
   'finance', NOW() + INTERVAL '77 days',
   0.54, 0.46, 27000, 23000, 1102, false, false, NOW() - INTERVAL '2 days'),

  (gen_random_uuid(), v_creator_id,
   'Will Tesla stock exceed $400 before end of 2026?',
   'finance', NOW() + INTERVAL '260 days',
   0.47, 0.53, 23500, 26500, 934, false, false, NOW() - INTERVAL '4 days'),

  (gen_random_uuid(), v_creator_id,
   'Will Bitcoin exceed $120K before June 2026?',
   'crypto', NOW() + INTERVAL '77 days',
   0.52, 0.48, 26000, 24000, 788, false, false, NOW() - INTERVAL '5 hours'),

  (gen_random_uuid(), v_creator_id,
   'Will US inflation (CPI) drop below 2.5% before end of 2026?',
   'finance', NOW() + INTERVAL '260 days',
   0.43, 0.57, 21500, 28500, 612, false, false, NOW() - INTERVAL '5 days'),

  (gen_random_uuid(), v_creator_id,
   'Will there be a US recession in 2026?',
   'finance', NOW() + INTERVAL '260 days',
   0.34, 0.66, 17000, 33000, 1456, false, false, NOW() - INTERVAL '6 days'),

  (gen_random_uuid(), v_creator_id,
   'Will NVDA beat Wall Street earnings estimates in Q1 2026?',
   'finance', NOW() + INTERVAL '38 days',
   0.76, 0.24, 38000, 12000, 1087, false, false, NOW() - INTERVAL '2 days');

-- ── 4. Announcements ──────────────────────────────────────────
INSERT INTO creator_announcements (creator_slug, title, body, pinned, created_at)
VALUES
  ('meetkevin', '🚀 Kevin Coin Markets are LIVE — time to get positioned',
   'You watch the videos. You hear the calls. Now put your Kevin Coins behind them. Fed decisions, housing, stocks, crypto — the community leaderboard shows who''s actually right. No more hindsight heroes.',
   true, NOW() - INTERVAL '2 days'),
  ('meetkevin', '📊 Recession market at 1,400+ traders — most bearish market on the board',
   'The "Will there be a US recession in 2026?" market just crossed 1,400 traders. 66% say no. Are you with the bulls or fading them?',
   false, NOW() - INTERVAL '4 hours');

RAISE NOTICE 'Meet Kevin community seeded. Live at hyperflex.network/meetkevin';

END $$;
