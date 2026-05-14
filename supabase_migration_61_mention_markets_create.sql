-- Migration #61: idempotent self-contained CREATE for mention_markets + classification_runs
--
-- Why this exists, vs migration #60:
-- Migration #60 was a RENAME (event_markets -> mention_markets) which assumes
-- event_markets exists from migration #50. Production diag (Railway log
-- 2026-05-14) shows mention_markets doesn't exist on prod -- migration #60
-- never landed there. Migrations #58, #59 also missing per the same log.
-- This migration is self-contained: drops any orphan event_markets table
-- (it was dormant per the original audit, zero rows on prod), then creates
-- mention_markets + classification_runs from scratch in their post-#60 shape.
--
-- Idempotent: re-runnable. CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT
-- EXISTS throughout; RLS policies are drop-and-recreate. Safe to apply on
-- a DB that already has the tables -- nothing changes.
--
-- Apply in TablePlus or Railway SQL console. Then restart server (or
-- next 15-min mention-sync rule pass will populate the table).

-- ============================================================
-- 0. Clean up dormant event_markets if present (had zero rows on prod)
-- ============================================================
drop table if exists event_markets cascade;

-- ============================================================
-- 1. classification_runs -- operational log for the 15-min cron
--    Service-role writes only. No public-read policy on ops data.
--    Must exist before mention_markets (FK target).
-- ============================================================
create table if not exists classification_runs (
  id                   uuid primary key default gen_random_uuid(),
  started_at           timestamptz not null default now(),
  finished_at          timestamptz,
  candidates_examined  int not null default 0,
  rule_matched         int not null default 0,
  llm_matched          int not null default 0,
  llm_calls            int not null default 0,
  no_match             int not null default 0,
  duration_ms          int,
  status               text not null default 'running'
    check (status in ('running','success','partial','failed')),
  error                text,
  notes                text
);

create index if not exists idx_classification_runs_started
  on classification_runs(started_at desc);

alter table classification_runs enable row level security;

-- ============================================================
-- 2. mention_markets -- post-#60 shape (Fed columns + classifier columns)
-- ============================================================
create table if not exists mention_markets (
  id                        uuid primary key default gen_random_uuid(),
  event_id                  uuid not null references mention_events(id) on delete cascade,
  condition_id              text not null,
  market_question           text,
  market_type               text
    check (market_type is null or market_type in (
      'word_count','phrase_appearance','sentiment','outcome',
      'binary','multi_outcome','scalar'
    )),
  tracked_word              text,
  tracked_phrase            text,
  threshold_count           int,
  yes_price                 numeric(5,4),
  no_price                  numeric(5,4),
  volume_24h                numeric,
  edge_score                int,
  whale_count               int,
  whale_volume              numeric,
  last_synced_at            timestamptz,
  display_order             int not null default 0,
  classification_method     text
    check (classification_method is null or classification_method in
      ('rule','llm','manual','none')),
  classification_confidence numeric(3,2),
  last_classified_at        timestamptz,
  classification_run_id     uuid references classification_runs(id) on delete set null,
  created_at                timestamptz not null default now(),
  unique (event_id, condition_id)
);

create index if not exists idx_mention_markets_event
  on mention_markets(event_id, display_order);

create index if not exists idx_mention_markets_synced
  on mention_markets(last_synced_at);

create index if not exists idx_mention_markets_last_classified
  on mention_markets(last_classified_at);

alter table mention_markets enable row level security;

-- RLS policy -- drop and recreate so re-application is clean
drop policy if exists "mention markets are public read" on mention_markets;
create policy "mention markets are public read"
  on mention_markets for select using (true);
