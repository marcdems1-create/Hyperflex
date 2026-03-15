-- Migration: Add tweet source columns to markets table
-- Run in Supabase SQL editor

ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS source_tweet_url TEXT,
  ADD COLUMN IF NOT EXISTS tweet_text        TEXT,
  ADD COLUMN IF NOT EXISTS tweet_author      TEXT;
