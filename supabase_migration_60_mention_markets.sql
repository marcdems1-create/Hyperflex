-- Migration #60: Rename event_markets -> mention_markets, generalize for multi-domain MP-2d classifier.
-- Polymarket-native. Backs the two-stage rule+LLM classifier output and the 15-min sync cron.
-- event_markets has zero rows in production (dormant since #50), so the rename is metadata-only.
-- Continues mention-pages-v1 (Phase 2c -> 2d). Down migration: supabase_migration_60_mention_markets_down.sql

-- ============================================================
-- 1. Rename table + indexes + unique constraint + RLS policy
-- ============================================================
alter table event_markets rename to mention_markets;

alter index idx_event_markets_event  rename to idx_mention_markets_event;
alter index idx_event_markets_synced rename to idx_mention_markets_synced;

alter table mention_markets
  rename constraint event_markets_event_id_condition_id_key
  to             mention_markets_event_id_condition_id_key;

drop policy if exists "event markets are public read" on mention_markets;
create policy "mention markets are public read"
  on mention_markets for select using (true);

-- ============================================================
-- 2. Relax NOT NULL on Fed-tuned columns
--    Universal markets (political / geo / AI / sports / crypto) won't populate these.
--    tracked_word / tracked_phrase / threshold_count are already nullable.
-- ============================================================
alter table mention_markets alter column market_question drop not null;
alter table mention_markets alter column market_type     drop not null;

-- ============================================================
-- 3. Broaden market_type check
-- ============================================================
alter table mention_markets drop constraint event_markets_market_type_check;
alter table mention_markets add  constraint mention_markets_market_type_check
  check (market_type is null or market_type in (
    'word_count','phrase_appearance','sentiment','outcome',
    'binary','multi_outcome','scalar'
  ));

-- ============================================================
-- 4. Classifier-output columns
-- ============================================================
alter table mention_markets
  add column if not exists classification_method     text
    check (classification_method is null or classification_method in
      ('rule','llm','manual','none')),
  add column if not exists classification_confidence numeric(3,2),
  add column if not exists last_classified_at        timestamptz,
  add column if not exists classification_run_id     uuid;

create index if not exists idx_mention_markets_last_classified
  on mention_markets(last_classified_at);

-- ============================================================
-- 5. classification_runs -- operational log for the 15-min cron
--    Service-role writes only. No public select policy (ops data, not user-facing).
--    Lag surfaced via dedicated health endpoint hit with service creds.
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

create index idx_classification_runs_started on classification_runs(started_at desc);

alter table classification_runs enable row level security;

-- ============================================================
-- 6. FK from mention_markets.classification_run_id -> classification_runs.id
--    Deferred to step 6 so the target table exists first.
-- ============================================================
alter table mention_markets
  add constraint mention_markets_classification_run_id_fkey
  foreign key (classification_run_id)
  references classification_runs(id)
  on delete set null;
