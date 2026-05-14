-- Rollback for migration #60. Restores event_markets shape exactly.
-- Run only if MP-2d work is being reverted. Operations reverse the forward migration in order.

-- 1. Drop the FK + classification_runs table
alter table mention_markets
  drop constraint if exists mention_markets_classification_run_id_fkey;

drop table if exists classification_runs;

-- 2. Drop the last_classified index + classifier-output columns
drop index if exists idx_mention_markets_last_classified;

alter table mention_markets
  drop column if exists classification_run_id,
  drop column if exists last_classified_at,
  drop column if exists classification_confidence,
  drop column if exists classification_method;

-- 3. Restore original market_type check
alter table mention_markets drop constraint if exists mention_markets_market_type_check;
alter table mention_markets add  constraint event_markets_market_type_check
  check (market_type in ('word_count','phrase_appearance','sentiment','outcome'));

-- 4. Re-impose NOT NULL on Fed-tuned columns
--    Will fail if any post-rename rows have NULL on these. Acceptable on rollback;
--    operator must clear or backfill those rows before re-running.
alter table mention_markets alter column market_type     set not null;
alter table mention_markets alter column market_question set not null;

-- 5. Restore RLS policy name
drop policy if exists "mention markets are public read" on mention_markets;
create policy "event markets are public read"
  on mention_markets for select using (true);

-- 6. Restore constraint, index, and table name
alter table mention_markets
  rename constraint mention_markets_event_id_condition_id_key
  to             event_markets_event_id_condition_id_key;

alter index idx_mention_markets_synced rename to idx_event_markets_synced;
alter index idx_mention_markets_event  rename to idx_event_markets_event;

alter table mention_markets rename to event_markets;
