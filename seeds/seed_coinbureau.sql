-- ════════════════════════════════════════════════════════════
-- HYPERFLEX — Coin Bureau Community Seed
-- Free Premium (platinum) account
-- Community: hyperflex.network/coinbureau
-- Creator login: coinbureau@hyperflex.network / HyperflexDemo2026!
-- ════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_creator_id UUID;
BEGIN

-- ── 1. Creator user ───────────────────────────────────────────
INSERT INTO users (email, password_hash, display_name, is_creator, tenant_slug, balance)
VALUES (
  'coinbureau@hyperflex.network',
  '$2b$12$Uy14b4qs8nx/qK5/Ceudwe29q1htH5fG2hhze/IM4IYBKTsdvkxCy',
  'Coin Bureau',
  true,
  'coinbureau',
  100000000
)
ON CONFLICT (email) DO NOTHING
RETURNING id INTO v_creator_id;

IF v_creator_id IS NULL THEN
  SELECT id INTO v_creator_id FROM users WHERE email = 'coinbureau@hyperflex.network';
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
  'coinbureau',
  'Coin Bureau',
  'Bureau Bucks',
  '#1a6bff',
  'Cut through the noise. Guy''s research is on record — now yours can be too. Put your Bureau Bucks on the calls that matter: macro, altcoins, regulation, and the big narratives before they play out.',
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

SELECT creator_id INTO v_creator_id FROM creator_settings WHERE slug = 'coinbureau';

-- ── 3. Markets ────────────────────────────────────────────────
INSERT INTO markets (id, creator_id, question, category, expiry_date, yes_price, no_price, yes_pool, no_pool, trader_count, resolved, archived, created_at)
VALUES
  (gen_random_uuid(), v_creator_id,
   'Will Bitcoin close above $100K before end of Q2 2026?',
   'crypto', NOW() + INTERVAL '77 days',
   0.64, 0.36, 32000, 18000, 891, false, false, NOW() - INTERVAL '3 days'),

  (gen_random_uuid(), v_creator_id,
   'Will the SEC approve a spot Ethereum ETF by end of 2026?',
   'crypto', NOW() + INTERVAL '260 days',
   0.72, 0.28, 36000, 14000, 643, false, false, NOW() - INTERVAL '2 days'),

  (gen_random_uuid(), v_creator_id,
   'Will Ethereum flip Bitcoin in market cap before 2027?',
   'crypto', NOW() + INTERVAL '290 days',
   0.19, 0.81, 9500, 40500, 427, false, false, NOW() - INTERVAL '5 days'),

  (gen_random_uuid(), v_creator_id,
   'Will the EU MiCA regulation hurt altcoin prices in H1 2026?',
   'regulation', NOW() + INTERVAL '90 days',
   0.44, 0.56, 22000, 28000, 318, false, false, NOW() - INTERVAL '4 days'),

  (gen_random_uuid(), v_creator_id,
   'Will Solana break its all-time high before July 2026?',
   'crypto', NOW() + INTERVAL '108 days',
   0.53, 0.47, 26500, 23500, 774, false, false, NOW() - INTERVAL '1 day'),

  (gen_random_uuid(), v_creator_id,
   'Will a G7 country ban crypto trading before end of 2026?',
   'regulation', NOW() + INTERVAL '260 days',
   0.11, 0.89, 5500, 44500, 502, false, false, NOW() - INTERVAL '6 days'),

  (gen_random_uuid(), v_creator_id,
   'Will total DeFi TVL exceed $200B in 2026?',
   'crypto', NOW() + INTERVAL '260 days',
   0.41, 0.59, 20500, 29500, 389, false, false, NOW() - INTERVAL '2 days'),

  (gen_random_uuid(), v_creator_id,
   'Will Cardano (ADA) outperform BTC in Q2 2026?',
   'crypto', NOW() + INTERVAL '77 days',
   0.33, 0.67, 16500, 33500, 456, false, false, NOW() - INTERVAL '1 day');

-- ── 4. Announcements ──────────────────────────────────────────
INSERT INTO creator_announcements (creator_slug, title, body, pinned, created_at)
VALUES
  ('coinbureau', '📊 Welcome to Coin Bureau Markets — your research, on the record',
   'No more "I said that months ago." Put your Bureau Bucks on the macro calls, altcoin plays, and regulatory bets before they happen. Live odds, community leaderboard, streak multipliers. Let''s see who''s actually reading the research.',
   true, NOW() - INTERVAL '2 days'),
  ('coinbureau', '🔥 ETF market heating up — 640+ analysts already in',
   'The SEC spot ETH ETF market just crossed 640 traders. 72% say yes by year end. Are you in the majority or fading?',
   false, NOW() - INTERVAL '3 hours');

RAISE NOTICE 'Coin Bureau community seeded. Live at hyperflex.network/coinbureau';

END $$;
