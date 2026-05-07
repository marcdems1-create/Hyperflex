-- Migration #57: Phase 4 multi-domain reframe — additional fields
--
-- Builds on migration #56 (which added the bare `domain` column with
-- default 'fed'). Adds the rest of the multi-domain shape: subject
-- (what the mention is ABOUT, distinct from speaker), stance_axis
-- (names the stance dimension per domain), stance_value (the actual
-- call along that axis), and market_relevance_score (Polymarket
-- volume rollup for hero ranking; populated by future ingestion
-- pipelines when they wire up market matching).
--
-- Also migrates the placeholder domain value from 'fed' (set in #56)
-- to the canonical 'fed_monetary_policy' that the registry uses.

-- New columns
alter table mention_events
  add column if not exists subject text,
  add column if not exists stance_axis text,
  add column if not exists stance_value text,
  add column if not exists market_relevance_score numeric;

-- Migrate placeholder domain value to canonical id (was 'fed' in #56)
update mention_events set domain = 'fed_monetary_policy' where domain = 'fed';
update transcripts    set domain = 'fed_monetary_policy' where domain = 'fed';

alter table mention_events alter column domain set default 'fed_monetary_policy';
alter table transcripts    alter column domain set default 'fed_monetary_policy';

-- Backfill axis + value on existing 86 events. stance_value mirrors
-- the per-event dominant_stance so the new field reads correctly the
-- moment the column lands; downstream queries can prefer stance_value
-- when present without needing to fork on domain.
update mention_events
   set stance_axis = 'hawkish_dovish',
       stance_value = dominant_stance
 where stance_axis is null
   and dominant_stance is not null;

create index if not exists idx_mention_events_subject
  on mention_events(subject)
  where subject is not null;

create index if not exists idx_mention_events_stance_axis
  on mention_events(stance_axis);

-- Hero ranking + per-domain index queries hit this. Score is null for
-- the existing 86 rows; future ingestion populates per row.
create index if not exists idx_mention_events_market_relevance
  on mention_events(market_relevance_score desc nulls last)
  where published = true;
