-- Migration #54: Phase 2e blurb generator support
-- Adds atomic per-(speaker, word) blurb storage on speaker_word_stance plus
-- the partial index that 2e/2f/3 will hammer when filtering out
-- insufficient_signal rows.
--
-- Grain note: speaker_word_stance.blurb is the atomic blurb per (speaker, word).
-- Phase 2f composes 1-N of these into mention_events.blurb (different grain;
-- column already exists from migration #50). Don't conflate the two.

alter table speaker_word_stance
  add column if not exists blurb text,
  add column if not exists blurb_generated_at timestamptz;

-- Partial index for the hot path: 2e/2f/3 queries all start with
--   WHERE llm_stance != 'insufficient_signal'
-- ~60% of rows clear that filter, so the partial index is meaningfully
-- smaller than a full one and lets us order/scan by stance cheaply.
create index if not exists idx_speaker_word_stance_llm_judgable
  on speaker_word_stance(llm_stance)
  where llm_stance is not null and llm_stance != 'insufficient_signal';

-- Secondary index for "give me everything blurbed since X" — supports the
-- ?since= param on POST /api/clusterer/blurb.
create index if not exists idx_speaker_word_stance_blurb_generated_at
  on speaker_word_stance(blurb_generated_at)
  where blurb_generated_at is not null;
