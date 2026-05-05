-- Migration #56: Phase 4 multi-domain foundation
-- Mentions are not a Fed-only product. Trump on Iran, Musk on Tesla,
-- Putin on Ukraine — any public figure saying things that move
-- Polymarket markets is in scope. The Fed pipeline is one ingestion
-- path among many; the composer / blurb / event-page surfaces are
-- domain-agnostic.
--
-- This migration is foundation, not the full reframe. Adds a `domain`
-- column to the two tables that need to know which domain a row
-- belongs to, defaults everything existing to 'fed' (backfills the 86
-- composed events + 51 transcripts automatically), and indexes for the
-- /mentions per-domain filter. No schema break; existing queries keep
-- working unchanged.

alter table transcripts
  add column if not exists domain text not null default 'fed';

alter table mention_events
  add column if not exists domain text not null default 'fed';

-- Index for /api/mentions when domain filtering kicks in (only fires
-- once ≥2 distinct domains are in the data, but cost is negligible).
create index if not exists idx_mention_events_domain_event_date
  on mention_events(domain, event_date desc);

create index if not exists idx_transcripts_domain_speaker
  on transcripts(domain, speaker);
