-- Phase 4.1 seed: hand-curated Trump-on-Iran + Biden-on-Iran atomic
-- stance rows. Run in TablePlus AFTER migration #58 lands.
--
-- Trump statements span April 7 → May 1, 2026 — the "civilization
-- threat → ceasefire → indefinite extension → ops termination" arc.
-- Biden statements span 2022-11 → 2023-12 — the "JCPOA dead → prisoner
-- swap thaw → JCPOA officially abandoned" trajectory.
--
-- Stance values + confidence assigned editorially based on the actual
-- statement framing. Blurbs follow the Phase 2e voice charter:
-- observational, active voice, no editorializing, ≤ 45 words atomic,
-- max one em-dash per blurb.
--
-- Re-runnable: ON CONFLICT (speaker, subject, statement_id) DO UPDATE
-- so re-applying the seed updates the editorial calls without
-- duplicating rows.

-- ── TRUMP ON IRAN (April-May 2026) ─────────────────────────────────────

insert into political_subject_stance
  (speaker, subject, statement_id, statement_date, statement_source_url,
   statement_quote, stance_value, stance_confidence, blurb, rationale, judged_at)
values
  ('Trump', 'iran', 'truth-social-2026-04-07-civilization', '2026-04-07',
   'https://www.cnn.com/2026/04/07/politics/infrastructure-iran-trump-truth-social-legal-analysis',
   'A whole civilization will die tonight, never to be brought back again',
   'escalatory', 'high',
   'Trump struck escalatory in his April 7 Truth Social post, framing Iran''s refusal to open the Strait of Hormuz as a strike trigger and threatening infrastructure-level destruction of bridges and power plants.',
   'Explicit threat of civilization-level destruction tied to a same-day deadline; no diplomatic offramp named.',
   now()),

  ('Trump', 'iran', 'truth-social-2026-04-07-blockade', '2026-04-07',
   'https://www.cfr.org/articles/trump-vows-to-continue-blockade-against-iran',
   'Continue blockade against Iran',
   'escalatory', 'high',
   'Trump vowed to maintain the Strait of Hormuz blockade indefinitely as economic leverage, framing strangulation rather than negotiation as the path to Tehran compliance.',
   'Sustained blockade as policy, no diplomatic alternative.',
   now()),

  ('Trump', 'iran', 'truth-social-2026-04-08-ceasefire-agreed', '2026-04-08',
   'https://www.washingtonpost.com/world/2026/04/07/trump-us-iran-war-threat/',
   'Almost all of the various points of past contention have been agreed to',
   'deescalatory', 'medium',
   'Trump pivoted deescalatory hours after the April 7 threat, announcing a two-week ceasefire and signaling broad agreement on points of contention with Tehran.',
   'Same-day reversal from threat to ceasefire — directional but volatile.',
   now()),

  ('Trump', 'iran', 'truth-social-2026-04-21-ceasefire-extension', '2026-04-21',
   'https://fortune.com/2026/04/21/trump-iran-deal-truth-social-posts-peace-talks-warning/',
   'Ceasefire extended indefinitely',
   'deescalatory', 'high',
   'On April 21 Trump extended the US-Iran ceasefire indefinitely pending Tehran''s comprehensive peace proposal, while keeping the Strait of Hormuz blockade as standing leverage.',
   'Indefinite ceasefire is a substantive deescalation even with blockade pressure intact.',
   now()),

  ('Trump', 'iran', 'congressional-notification-2026-05-01', '2026-05-01',
   'https://www.armscontrol.org/act/2026-05/news/trump-dismisses-using-nuclear-arms-against-iran-talks-stall',
   'Military operations against Iran terminated',
   'deescalatory', 'high',
   'Trump notified Congress on May 1 that Operation Epic Fury military operations against Iran had ended, coinciding with the holding ceasefire and explicitly dismissing nuclear-weapons use.',
   'Formal termination of named military operation; explicit denial of nuclear option.',
   now())

on conflict (speaker, subject, statement_id) do update set
  statement_date        = excluded.statement_date,
  statement_source_url  = excluded.statement_source_url,
  statement_quote       = excluded.statement_quote,
  stance_value          = excluded.stance_value,
  stance_confidence     = excluded.stance_confidence,
  blurb                 = excluded.blurb,
  rationale             = excluded.rationale,
  judged_at             = excluded.judged_at;


-- ── BIDEN ON IRAN (2022-2023, comparison anchor) ──────────────────────

insert into political_subject_stance
  (speaker, subject, statement_id, statement_date, statement_source_url,
   statement_quote, stance_value, stance_confidence, blurb, rationale, judged_at)
values
  ('Biden', 'iran', 'rally-remarks-2022-11-04-deal-dead', '2022-11-04',
   'https://www.thenation.com/article/world/iran-accord-biden-2025/',
   'The Iran nuclear deal is dead',
   'escalatory', 'medium',
   'At a November 2022 rally Biden declared the Iran nuclear deal dead, signaling abandonment of JCPOA revival without naming an alternative diplomatic pathway.',
   'Public death-knell for the central diplomatic instrument; no replacement framework offered.',
   now()),

  ('Biden', 'iran', 'prisoner-swap-2023-08-10', '2023-08-10',
   'https://www.armscontrol.org/act/2023-07/news/united-states-iran-resume-nuclear-talks',
   'Five-for-five prisoner exchange and unfrozen oil funds',
   'deescalatory', 'high',
   'Biden''s August 2023 prisoner-swap deal — five Americans for five Iranians plus six billion in unfrozen oil funds — was the first significant US-Iran diplomatic breakthrough since the 2018 JCPOA withdrawal.',
   'Concrete diplomatic transaction with material concessions; deescalatory by action.',
   now()),

  ('Biden', 'iran', 'campbell-testimony-2023-12-07', '2023-12-07',
   'https://en.wikipedia.org/wiki/Iran%E2%80%93United_States_relations_during_the_Biden_administration',
   'I don''t think anyone sees that there''s any chance to go back to the JCPOA',
   'escalatory', 'high',
   'Biden''s deputy-secretary nominee Kurt Campbell told the Senate in December 2023 that JCPOA revival was not up for discussion, formalizing the administration''s walk away from the 2015 deal.',
   'Administrative finalization of the JCPOA-dead posture; no replacement diplomatic instrument announced.',
   now()),

  ('Biden', 'iran', 'foreign-affairs-iran-gamble-2023', '2023-09-15',
   'https://www.foreignaffairs.com/iran/bidens-iran-gamble',
   'Risky new strategy to keep Tehran from going nuclear',
   'ambiguous', 'medium',
   'Through 2023 Biden pursued a containment-without-deal posture: pressure on the nuclear program paired with selective diplomatic openings, neither full pressure nor full engagement.',
   'Hybrid strategy without a single dominant direction; ambiguous by design.',
   now())

on conflict (speaker, subject, statement_id) do update set
  statement_date        = excluded.statement_date,
  statement_source_url  = excluded.statement_source_url,
  statement_quote       = excluded.statement_quote,
  stance_value          = excluded.stance_value,
  stance_confidence     = excluded.stance_confidence,
  blurb                 = excluded.blurb,
  rationale             = excluded.rationale,
  judged_at             = excluded.judged_at;
