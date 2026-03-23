-- Migration: HFX Alpha Score + Signal Urgency columns
-- Add odds_at_signal, signal_urgency, outcome_return to agent_decisions

ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS odds_at_signal REAL;
ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS signal_urgency REAL;
ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS outcome_return REAL;
ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS outcome_set_at TIMESTAMPTZ;
