-- Migration #55: Phase 2f composer support — fields on mention_events
-- Adds the rollup + audit columns the composer needs. Migration #50 already
-- created mention_events with: id, slug, title, speaker, event_type, event_at,
-- source_org, blurb, status, cluster_keywords, market_count, published,
-- created_at, updated_at. Everything below is incremental.
--
-- Decisions baked in (per Phase 2f brief + concrete proposal):
--   - Bulk compose all 86 transcripts; published defaults false
--   - MIN_ROWS_FOR_COMPOSE = 3 (below: row exists, blurb null, published false)
--   - Soft-validate same-axis stance disagreement, hard-reject opposite-direction
--   - comparison_yielded_no_divergence flag for empty-divergence audit

alter table mention_events
  add column if not exists source_transcript_id uuid references transcripts(id) on delete set null,
  add column if not exists event_date date,
  add column if not exists source_url text,
  add column if not exists stance_summary jsonb,
  add column if not exists dominant_stance text
    check (dominant_stance is null or dominant_stance in ('hawkish','dovish','neutral')),
  add column if not exists dominant_confidence text
    check (dominant_confidence is null or dominant_confidence in ('high','medium','low')),
  add column if not exists compared_to_speaker text,
  add column if not exists composed_at timestamptz,
  add column if not exists composer_model text,
  -- soft-validate audit: when llm-self-reported stance differs from the
  -- count-derived dominant on the SAME axis (e.g. count=hawkish, model=neutral),
  -- accept the blurb but record the disagreement for later review.
  -- Schema: { computed: 'hawkish', model_called: 'neutral', axis: 'same' }
  add column if not exists stance_disagreement jsonb,
  -- refinement 1 audit: when compared_to_speaker is set but no same-word
  -- divergent rows exist, the comparison sentence drops out of the prompt.
  -- Flag the row so we can spot-check why a hero event came back solo.
  add column if not exists comparison_yielded_no_divergence boolean not null default false;

-- One mention_event per transcript — clean 1:1 grain. Unique partial index
-- (only when source_transcript_id is set, since legacy mention_events from
-- pre-2f phases may have null source_transcript_id).
create unique index if not exists idx_mention_events_source_transcript
  on mention_events(source_transcript_id)
  where source_transcript_id is not null;

-- Composer queries by speaker + date range; published filter is the hot path
-- for downstream Phase 3 frontend.
create index if not exists idx_mention_events_speaker_event_date
  on mention_events(speaker, event_date desc);

create index if not exists idx_mention_events_composed_at
  on mention_events(composed_at desc)
  where composed_at is not null;

create index if not exists idx_mention_events_compared_to_speaker
  on mention_events(compared_to_speaker)
  where compared_to_speaker is not null;
