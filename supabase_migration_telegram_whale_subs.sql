-- Telegram whale alert subscribers (bot /alerts command)
CREATE TABLE IF NOT EXISTS telegram_whale_subs (
  id SERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL UNIQUE,
  first_name TEXT,
  active BOOLEAN DEFAULT true,
  subscribed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tg_whale_subs_active ON telegram_whale_subs (active) WHERE active = true;
