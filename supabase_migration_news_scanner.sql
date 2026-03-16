-- News Intelligence Scanner
-- Adds news feed settings to creator_settings
-- Markets table already has tweet_text / source_tweet_url / tweet_author which we reuse for news

ALTER TABLE creator_settings
  ADD COLUMN IF NOT EXISTS news_feed_enabled    BOOLEAN      DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS news_feed_last_scan  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS news_feed_categories TEXT         DEFAULT 'all';
  -- news_feed_categories: 'all' or comma-separated list e.g. 'crypto,politics,sports'

-- Optional: index to quickly find creators with news feed enabled
CREATE INDEX IF NOT EXISTS idx_creator_settings_news_feed
  ON creator_settings (news_feed_enabled)
  WHERE news_feed_enabled = TRUE;
