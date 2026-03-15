-- Fix: backfill tenant_slug on markets that have creator_id set but tenant_slug is null
-- Run once in Supabase SQL editor after seeding

UPDATE markets m
SET tenant_slug = cs.slug
FROM creator_settings cs
WHERE m.creator_id = cs.creator_id
  AND (m.tenant_slug IS NULL OR m.tenant_slug = '');
