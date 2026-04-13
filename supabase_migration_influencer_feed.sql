-- Migration: Polymarket influencer monitoring feed
-- Run after supabase_migration_takes.sql (takes table must exist)

-- ── Curated influencer list ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS external_influencers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  platform       TEXT NOT NULL CHECK (platform IN ('x','youtube','reddit','substack')),
  handle         TEXT NOT NULL,       -- @handle for X, channel_id for YT, username for Reddit, slug for Substack
  platform_id    TEXT,                -- numeric user ID (X), channel_id (YT) — pre-resolved
  avatar_url     TEXT,
  bio            TEXT,
  follower_count INTEGER DEFAULT 0,
  known_accuracy NUMERIC(4,1),        -- % of resolved calls that were correct (0-100)
  total_calls    INTEGER DEFAULT 0,   -- total predictions tracked
  correct_calls  INTEGER DEFAULT 0,
  is_active      BOOLEAN DEFAULT true,
  last_fetched   TIMESTAMPTZ,
  added_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, handle)
);

-- ── Individual posts/videos from monitored influencers ───────────────────────
CREATE TABLE IF NOT EXISTS influencer_posts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id    UUID REFERENCES external_influencers(id) ON DELETE CASCADE,
  platform         TEXT NOT NULL,
  external_id      TEXT NOT NULL,     -- tweet ID, YouTube video ID, Reddit post ID
  content_url      TEXT,
  content_text     TEXT,              -- tweet text, video title+description, Reddit post title
  published_at     TIMESTAMPTZ,
  -- Market matching (Claude-extracted)
  market_slug      TEXT,              -- matched Polymarket market slug
  market_question  TEXT,              -- matched market question text
  predicted_side   TEXT CHECK (predicted_side IN ('YES','NO',NULL)),
  match_confidence INTEGER,           -- 0-100, Claude's confidence in the match
  -- Take creation
  take_id          UUID,              -- references takes.id if we auto-created a take
  -- Accuracy (filled on market resolution)
  resolved_at      TIMESTAMPTZ,
  was_correct      BOOLEAN,
  fetched_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, external_id)
);

CREATE INDEX IF NOT EXISTS influencer_posts_influencer_idx ON influencer_posts(influencer_id);
CREATE INDEX IF NOT EXISTS influencer_posts_published_idx  ON influencer_posts(published_at DESC);
CREATE INDEX IF NOT EXISTS influencer_posts_market_idx     ON influencer_posts(market_slug);
CREATE INDEX IF NOT EXISTS influencer_posts_take_idx       ON influencer_posts(take_id);

-- ── Seed: known Polymarket influencers ──────────────────────────────────────

-- X/Twitter — traders & analysts
INSERT INTO external_influencers (name, platform, handle, bio, is_active) VALUES
  ('Polymarket',          'x', 'Polymarket',        'Official Polymarket account',                              true),
  ('Nate Silver',         'x', 'NateSilver538',     'Forecaster, author of The Signal and the Noise',           true),
  ('Manifold Markets',    'x', 'ManifoldMarkets',   'Prediction market platform',                               true),
  ('Metaculus',           'x', 'metaculus',          'Prediction platform & forecasting community',              true),
  ('Robin Hanson',        'x', 'robinhanson',        'Economist, prediction market pioneer',                    true),
  ('Philip Tetlock',      'x', 'PTetlock',           'Superforecasting researcher',                             true),
  ('Matthew Yglesias',    'x', 'mattyglesias',      'Journalist, frequent prediction market bettor',            true),
  ('Scott Alexander',     'x', 'slatestarcodex',    'ACX author, prominent forecaster',                        true),
  ('Zoltu',               'x', 'Zoltu',             'Crypto & prediction market trader',                       true),
  ('Kalshi',              'x', 'Kalshi',             'CFTC-regulated prediction market',                        true),
  -- Requested traders
  ('NotSoEasyMoney',      'x', 'NotSoEasyMoney',    'Prediction market trader',                                 true),
  ('Tradermayne',         'x', 'Tradermayne',        'Active Polymarket trader',                                true),
  -- CSPTRADING.eth: X handles cannot contain periods — stored without the dot.
  -- Bearer-token sweep will confirm actual handle ID on first run.
  ('CSPTRADING',          'x', 'CSPTRADINGeth',     'Polymarket trader (known as CSPTRADING.eth)',             true),
  ('massieforky',         'x', 'massieforky',        'Prediction market & political commentary account',        true)
ON CONFLICT (platform, handle) DO NOTHING;

-- X/Twitter — politicians who actively discuss prediction markets
-- Mix of pro-market (libertarian/crypto wing) and critics (both generate signal).
-- The system filters their tweets for prediction-market keywords before processing.
INSERT INTO external_influencers (name, platform, handle, bio, is_active) VALUES
  -- Libertarian / pro-deregulation (explicitly supportive of prediction markets)
  ('Rep. Thomas Massie',     'x', 'ThomasMassie',   'KY-4 congressman, libertarian, vocal prediction market supporter',          true),
  ('Sen. Rand Paul',         'x', 'RandPaul',        'KY senator, libertarian, free-market advocate',                            true),
  ('Rep. Warren Davidson',   'x', 'WarrenDavidson',  'OH-8, crypto & fintech-friendly congressman',                              true),
  ('Rep. Tom Emmer',         'x', 'TomEmmer',        'House Majority Whip, pro-crypto, prediction market adjacent',              true),
  ('Sen. Cynthia Lummis',    'x', 'SenLummis',       'WY senator, Bitcoin Senator, pro-prediction markets',                     true),
  ('Rep. Patrick McHenry',   'x', 'PatrickMcHenry',  'House Financial Services Chair, fintech & prediction market regulation',  true),
  ('Rep. Byron Donalds',     'x', 'ByronDonalds',    'FL-19, crypto-friendly Republican',                                       true),
  -- Vocal critics (still tweet about them, generate strong signal when they do)
  ('Sen. Elizabeth Warren',  'x', 'SenWarren',       'MA senator, frequent critic of prediction markets & crypto',               true),
  ('Rep. Alexandria Ocasio-Cortez','x','AOC',         'NY-14, has tweeted about prediction market concerns',                    true),
  ('Sen. Bernie Sanders',    'x', 'BernieSanders',   'VT senator, critic of speculative markets',                               true),
  -- High-signal political figures whose Polymarket odds are widely discussed
  ('Donald Trump',           'x', 'realDonaldTrump', 'POTUS45/47 — most-traded Polymarket subject, tweets about his odds',      true),
  ('Elon Musk',              'x', 'elonmusk',         'Twitter/X owner, frequently cites Polymarket odds in tweets',            true),
  ('Vivek Ramaswamy',        'x', 'VivekGRamaswamy', 'Has cited prediction market odds during political campaigns',             true),
  ('Sen. Ted Cruz',          'x', 'SenTedCruz',       'TX senator, has referenced prediction market signals',                   true),
  ('Rep. Matt Gaetz',        'x', 'mattgaetz',        'FL congressman, referenced Polymarket during political battles',         true),
  ('RFK Jr.',                'x', 'RobertKennedyJr', 'Mentioned prediction market odds during 2024 campaign',                   true),
  ('Tulsi Gabbard',          'x', 'TulsiGabbard',     'Dir. of National Intelligence, mentioned prediction markets',            true),
  ('Marjorie Taylor Greene', 'x', 'RepMTG',           'GA-14, tweets about political prediction markets',                      true),
  ('Rep. Jim Jordan',        'x', 'Jim_Jordan',       'House Judiciary Chair, political prediction market subject',             true),
  ('Gov. Ron DeSantis',      'x', 'GovRonDeSantis',  'FL governor, Polymarket-tracked political figure',                       true)
ON CONFLICT (platform, handle) DO NOTHING;

-- YouTube — channels covering Polymarket/prediction markets
INSERT INTO external_influencers (name, platform, handle, platform_id, bio, is_active) VALUES
  ('Forecasting Research Institute', 'youtube', 'ForecastingRI',  'UCXgfHLbSXDLZFBCOoFqTOOQ', 'Forecasting research & prediction market analysis', true),
  ('Good Judgment',                  'youtube', 'GoodJudgment',   'UCpGFCE9y9U-8fLjJD5kH3Mg', 'Superforecasting organization',                     true)
ON CONFLICT (platform, handle) DO NOTHING;

-- Reddit — top prediction market subreddits (handle = subreddit name)
INSERT INTO external_influencers (name, platform, handle, bio, is_active) VALUES
  ('r/Polymarket',          'reddit', 'Polymarket',        'Polymarket trading community',      true),
  ('r/predictionmarkets',   'reddit', 'predictionmarkets', 'Prediction market discussion',      true),
  ('r/metaculus',           'reddit', 'metaculus',         'Metaculus forecasting community',   true),
  ('r/politics',            'reddit', 'politics',          'US politics — high prediction market overlap', true),
  ('r/poker',               'reddit', 'poker',             'Poker/gambling community, prediction market crossover', true)
ON CONFLICT (platform, handle) DO NOTHING;
