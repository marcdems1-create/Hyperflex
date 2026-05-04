-- Migration #51: speaker_word_stance — Phase 2d clusterer output
-- Classifies each (speaker, word) pair as hawkish / dovish / neutral /
-- insufficient_data based on rate-vs-corpus comparison + a v1 word-stance
-- lookup. Feeds the stance-flip timeline on mention pages.
--
-- Idempotent rebuild: GET /api/clusterer/run deletes and re-inserts in a
-- transaction. Unique constraint on (speaker, word) makes upserts safe.

create table if not exists speaker_word_stance (
  id uuid primary key default gen_random_uuid(),
  speaker text not null,
  word text not null,
  stance text not null check (stance in (
    'hawkish','dovish','neutral','insufficient_data'
  )),
  speaker_rate_per_1k numeric not null default 0,
  corpus_rate_per_1k numeric not null default 0,
  rate_ratio numeric not null default 0,
  transcripts_with_word integer not null default 0,
  speaker_total_transcripts integer not null default 0,
  computed_at timestamptz not null default now(),
  unique (speaker, word)
);

create index if not exists idx_speaker_word_stance_speaker
  on speaker_word_stance(speaker);
create index if not exists idx_speaker_word_stance_word
  on speaker_word_stance(word);
create index if not exists idx_speaker_word_stance_stance
  on speaker_word_stance(stance);

alter table speaker_word_stance enable row level security;

create policy "speaker word stance is public read"
  on speaker_word_stance for select using (true);

-- Writes only via service-role key.
