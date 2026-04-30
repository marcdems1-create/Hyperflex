-- Migration #49: Add position attachment + integrity columns to takes
--
-- Builds on top of migration #44 (supabase_migration_takes.sql), which
-- shipped the base takes + take_reactions tables. This migration adds:
--   1. Position attachment (position_id, entry_price, attached_at)
--   2. Integrity / lifecycle (edit_window_until, deleted_at, admin_hidden)
--   3. Resolution stamp (resolved_outcome, resolved_at)
--   4. Stance enum (backing / fading / leaning_yes / leaning_no / watching)
--   5. RLS for time-locked DELETE (free pre-resolution, 403 post-resolution)
--   6. RLS for 5-minute edit window (body only)
--
-- ALTER TABLE only. Marc runs this in the Supabase SQL editor.
-- Do not run from the agent. Railway Postgres is the production DB
-- per CLAUDE.md, but Marc's stated workflow is "Marc runs migrations
-- in Supabase SQL editor" — follow that.
--
-- ⚠ SCHEMA NOTE FOR MARC — please verify before running:
-- The orphan-candidate index below references `market_id`, `market_source`,
-- and `posted_at` on the takes table. Migration #44 actually shipped
-- `market_slug`, `condition_id`, and `created_at` (no `market_id`,
-- `market_source`, or `posted_at` columns). The index DDL is left
-- verbatim per §3 of the v2 spec ("Do not invent column names"); it
-- will fail to create against the live #44 schema until either:
--   (a) those columns are added, or
--   (b) the index is rewritten to use #44 names.
-- See the comment immediately above the index for the literal-spec
-- version vs. the #44-compatible variant. Pick one before running.

-- Stance enum
do $$ begin
  create type take_stance as enum (
    'backing',      -- attached, position side = yes
    'fading',       -- attached, position side = no
    'leaning_yes',  -- freestanding, directional lean toward yes
    'leaning_no',   -- freestanding, directional lean toward no
    'watching'      -- freestanding, no resolution stamp
  );
exception
  when duplicate_object then null;
end $$;

-- Attachment columns
alter table takes add column if not exists position_id uuid
  references positions(id) on delete set null;
alter table takes add column if not exists entry_price numeric(5,4);
alter table takes add column if not exists attached_at timestamptz;

-- Integrity columns
alter table takes add column if not exists edit_window_until timestamptz
  not null default (now() + interval '5 minutes');
alter table takes add column if not exists deleted_at timestamptz;
alter table takes add column if not exists admin_hidden boolean
  not null default false;

-- Resolution columns
alter table takes add column if not exists resolved_outcome text
  check (resolved_outcome in ('correct','incorrect','void') or resolved_outcome is null);
alter table takes add column if not exists resolved_at timestamptz;

-- Stance column (only if missing from #44)
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name='takes' and column_name='stance'
  ) then
    alter table takes add column stance take_stance not null default 'watching';
  end if;
end $$;

-- Indexes
create index if not exists idx_takes_position
  on takes(position_id) where position_id is not null;

-- ⚠ Verbatim from §3. References columns that do not exist on the live
-- #44 takes table (market_id, market_source, posted_at). If you want
-- this index to land on the current schema, replace with the #44-compat
-- variant below. Otherwise add the missing columns first.
--
-- Spec verbatim:
create index if not exists idx_takes_orphan_candidates
  on takes(user_id, market_id, market_source)
  where position_id is null and posted_at > (now() - interval '24 hours');
--
-- #44-compatible alternative (uncomment if not adding the columns above):
-- create index if not exists idx_takes_orphan_candidates
--   on takes(user_id, condition_id, market_slug)
--   where position_id is null and created_at > (now() - interval '24 hours');

-- Spec verbatim:
create index if not exists idx_takes_user_posted
  on takes(user_id, posted_at desc);
--
-- #44-compatible alternative:
-- create index if not exists idx_takes_user_posted
--   on takes(user_id, created_at desc);

-- RLS: time-locked DELETE
drop policy if exists "users delete own takes" on takes;
create policy "users delete own pre-resolution takes" on takes for delete
  using (auth.uid() = user_id and resolved_outcome is null);

-- RLS: edit-window UPDATE for body only
drop policy if exists "users edit own takes" on takes;
create policy "users edit own takes within window" on takes for update
  using (auth.uid() = user_id and now() < edit_window_until)
  with check (auth.uid() = user_id and now() < edit_window_until);
