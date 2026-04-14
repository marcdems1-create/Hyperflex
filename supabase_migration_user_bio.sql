-- Migration: add bio column to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio text;
