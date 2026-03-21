-- Add telegram_chat_id column to users table for Telegram bot alerts
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
