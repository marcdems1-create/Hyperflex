-- Migration #53: LLM judgment columns on speaker_word_stance — Phase 2d.5
-- Layers an LLM context-judgment pass on top of the rule-based clusterer
-- (Phase 2d). The original `stance` column stays untouched as audit trail;
-- `llm_stance` is the authoritative classification downstream once judged.
--
-- All five fields are nullable so existing rows from a pure rule-based run
-- still satisfy the schema. POST /api/clusterer/judge populates them in
-- place; re-running overwrites cleanly.
--
-- llm_confidence + llm_rationale are free from the API response (we ask for
-- them in the prompt anyway) — keeping both gives us actionable signal
-- when triaging disagreements between rule-based and LLM stance.

alter table speaker_word_stance
  add column if not exists llm_stance text
    check (llm_stance is null or llm_stance in (
      'hawkish','dovish','neutral','insufficient_signal'
    )),
  add column if not exists llm_confidence text
    check (llm_confidence is null or llm_confidence in (
      'high','medium','low'
    )),
  add column if not exists llm_rationale text,
  add column if not exists llm_judged_at timestamptz,
  add column if not exists llm_sentence_count integer;

-- Indexes for the comparison query the user will run after each judge pass:
--   SELECT word, stance AS rule_based, llm_stance, llm_confidence, llm_rationale
--   FROM speaker_word_stance
--   WHERE speaker = 'Waller' AND stance != llm_stance;
create index if not exists idx_speaker_word_stance_llm_stance
  on speaker_word_stance(llm_stance);
create index if not exists idx_speaker_word_stance_llm_judged_at
  on speaker_word_stance(llm_judged_at);
