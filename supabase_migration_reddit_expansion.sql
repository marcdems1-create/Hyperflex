-- Migration: Expand Reddit subreddit coverage for Trending feed
-- Run in Railway Postgres (not Supabase)

INSERT INTO external_influencers (id, name, platform, handle, bio, is_active) VALUES
  (gen_random_uuid(), 'r/wallstreetbets', 'reddit', 'wallstreetbets', 'Retail trading and market predictions', true),
  (gen_random_uuid(), 'r/cryptocurrency', 'reddit', 'cryptocurrency', 'Crypto markets and predictions', true),
  (gen_random_uuid(), 'r/sportsbetting', 'reddit', 'sportsbetting', 'Sports betting and odds discussion', true),
  (gen_random_uuid(), 'r/nba', 'reddit', 'nba', 'NBA discussion and game predictions', true),
  (gen_random_uuid(), 'r/nfl', 'reddit', 'nfl', 'NFL discussion and game predictions', true),
  (gen_random_uuid(), 'r/worldnews', 'reddit', 'worldnews', 'Global news with prediction market relevance', true),
  (gen_random_uuid(), 'r/geopolitics', 'reddit', 'geopolitics', 'Geopolitical analysis and forecasting', true),
  (gen_random_uuid(), 'r/economics', 'reddit', 'economics', 'Economic analysis and market forecasts', true),
  (gen_random_uuid(), 'r/soccer', 'reddit', 'soccer', 'Global football discussion and match predictions', true),
  (gen_random_uuid(), 'r/bitcoin', 'reddit', 'bitcoin', 'Bitcoin price predictions and analysis', true)
ON CONFLICT (platform, handle) DO NOTHING;
