-- Migration #49 v2: Add position attachment + integrity columns to takes
-- The takes table from #44/#50 already has: id, user_id, condition_id, market_slug,
-- side, entry_price, thesis, is_correct, parent_take_id, agree_count, disagree_count,
-- sharp_score, source, posted_at (or created_at), edit_window_until, deleted_at,
-- admin_hidden, resolved_outcome (verify which exist before running)

-- Stance enum (only if missing)
do $$ begin
  create type take_stance as enum (
    'backing','fading','leaning_yes','leaning_no','watching'
  );
exception when duplicate_object then null;
end $$;

-- Position attachment columns (the actual new work)
alter table takes add column if not exists position_id uuid
  references positions(id) on delete set null;
alter table takes add column if not exists attached_at timestamptz;

-- Stance column
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name='takes' and column_name='stance'
  ) then
    alter table takes add column stance take_stance not null default 'watching';
  end if;
end $$;

-- Indexes (use real column names)
create index if not exists idx_takes_position
  on takes(position_id) where position_id is not null;
create index if not exists idx_takes_orphan_candidates_condition
  on takes(user_id, condition_id)
  where position_id is null and condition_id is not null
    and posted_at > (now() - interval '24 hours');
create index if not exists idx_takes_orphan_candidates_slug
  on takes(user_id, market_slug)
  where position_id is null and market_slug is not null
    and posted_at > (now() - interval '24 hours');

-- RLS: time-locked DELETE (uses existing is_correct column)
drop policy if exists "users delete own takes" on takes;
create policy "users delete own pre-resolution takes" on takes for delete
  using (auth.uid() = user_id and is_correct is null);

-- RLS: edit-window UPDATE (assumes edit_window_until already exists from #50)
drop policy if exists "users edit own takes" on takes;
create policy "users edit own takes within window" on takes for update
  using (auth.uid() = user_id and now() < edit_window_until)
  with check (auth.uid() = user_id and now() < edit_window_until);
