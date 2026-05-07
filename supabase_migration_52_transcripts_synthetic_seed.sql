-- Migration #52: synthetic_seed flag on transcripts
-- Phase 2c.5 ingests handpicked Williams/Waller/Brainard (or Bostic/Daly)
-- speeches as a non-Powell baseline so the clusterer's rate-vs-corpus math
-- has a second voice to compare against. These rows are flagged
-- synthetic_seed=true so they can be filtered out (or kept as additional
-- baseline) once Phase 2g ships real ingestion of speeches/testimony.
--
-- Powell's existing 51 FOMC presconfs default to false — no backfill needed.

alter table transcripts
  add column if not exists synthetic_seed boolean not null default false;

-- Partial index for fast filter-out when downstream queries want
-- production-only data. Tiny table at v1 so cost is negligible; the index
-- lets `where synthetic_seed = true` scans avoid touching Powell's rows.
create index if not exists idx_transcripts_synthetic_seed
  on transcripts(synthetic_seed)
  where synthetic_seed = true;
