-- Migration #50: Mention pages (events, stance entries, transcripts, markets, word freq)
-- Polymarket-native. No Kalshi/Manifold dependencies.

-- ============================================================
-- 1. Events table (auto-generated from Polymarket clusters)
-- ============================================================
create table if not exists mention_events (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  speaker text not null,
  event_type text not null check (event_type in (
    'fomc_presser','speech','rally','testimony','presser','hearing','other'
  )),
  event_at timestamptz not null,
  source_org text,
  blurb text,
  status text not null default 'upcoming' check (status in (
    'upcoming','live','past','archived'
  )),
  cluster_keywords text[],
  market_count int not null default 0,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_mention_events_status_event_at
  on mention_events(status, event_at);
create index idx_mention_events_speaker
  on mention_events(speaker);
create index idx_mention_events_published
  on mention_events(published, status, event_at)
  where published = true;

-- ============================================================
-- 2. Stance entries (curated, AI-classified later in v1.1)
-- ============================================================
create table if not exists stance_entries (
  id uuid primary key default gen_random_uuid(),
  speaker text not null,
  stance text not null check (stance in ('hawk','dove','mixed')),
  entry_date date not null,
  president_at_time text,
  source_type text not null,
  source_url text,
  quote_summary text not null,
  fed_funds_range text,
  cpi_at_time text,
  ai_confidence numeric(3,2),
  approved boolean not null default false,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_stance_speaker_approved
  on stance_entries(speaker, approved, entry_date desc);

-- ============================================================
-- 3. Transcripts (Federal Reserve scraper output)
-- ============================================================
create table if not exists transcripts (
  id uuid primary key default gen_random_uuid(),
  speaker text not null,
  event_type text not null,
  source_url text not null,
  source_org text not null,
  transcript_date timestamptz not null,
  full_text text not null,
  word_count int not null,
  ingested_at timestamptz not null default now(),
  unique (speaker, transcript_date, event_type)
);

create index idx_transcripts_speaker_date
  on transcripts(speaker, transcript_date desc);

-- ============================================================
-- 4. Word counts per transcript
-- ============================================================
create table if not exists transcript_word_counts (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references transcripts(id) on delete cascade,
  word text not null,
  raw_count int not null,
  normalized_count int not null,
  computed_at timestamptz not null default now(),
  unique (transcript_id, word)
);

create index idx_word_counts_transcript on transcript_word_counts(transcript_id);
create index idx_word_counts_word on transcript_word_counts(word);

-- ============================================================
-- 5. Event markets (link Polymarket markets to mention events)
-- ============================================================
create table if not exists event_markets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references mention_events(id) on delete cascade,
  condition_id text not null,
  market_question text not null,
  market_type text not null check (market_type in (
    'word_count','phrase_appearance','sentiment','outcome'
  )),
  tracked_word text,
  tracked_phrase text,
  threshold_count int,
  yes_price numeric(5,4),
  no_price numeric(5,4),
  volume_24h numeric,
  edge_score int,
  whale_count int,
  whale_volume numeric,
  last_synced_at timestamptz,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (event_id, condition_id)
);

create index idx_event_markets_event
  on event_markets(event_id, display_order);
create index idx_event_markets_synced
  on event_markets(last_synced_at);

-- ============================================================
-- 6. Speaker word frequency rollup (for the supporting card)
-- ============================================================
create table if not exists speaker_word_frequency (
  id uuid primary key default gen_random_uuid(),
  speaker text not null,
  word text not null,
  total_count int not null,
  source_count int not null,
  last_computed timestamptz not null default now(),
  unique (speaker, word)
);

create index idx_speaker_word_freq
  on speaker_word_frequency(speaker, total_count desc);

-- ============================================================
-- RLS — public read on published events, service-role only on writes
-- ============================================================
alter table mention_events enable row level security;
alter table stance_entries enable row level security;
alter table transcripts enable row level security;
alter table transcript_word_counts enable row level security;
alter table event_markets enable row level security;
alter table speaker_word_frequency enable row level security;

create policy "published mention events are public"
  on mention_events for select
  using (published = true);

create policy "approved stance entries are public"
  on stance_entries for select
  using (approved = true);

create policy "transcripts are public read"
  on transcripts for select using (true);

create policy "word counts are public read"
  on transcript_word_counts for select using (true);

create policy "event markets are public read"
  on event_markets for select using (true);

create policy "speaker word frequency is public read"
  on speaker_word_frequency for select using (true);

-- Writes only via service-role key (no public insert/update/delete policies created).

-- ============================================================
-- Updated_at trigger for mention_events
-- ============================================================
create or replace function update_mention_events_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger mention_events_updated_at
  before update on mention_events
  for each row execute function update_mention_events_updated_at();
