-- Migration: discord_webhook
-- Adds discord_webhook_url column to creator_settings.
-- Creators can set a Discord incoming webhook URL; new public markets auto-post a card.

ALTER TABLE creator_settings ADD COLUMN IF NOT EXISTS discord_webhook_url TEXT;
