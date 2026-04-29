-- Migration: takes.outcome_label
--
-- For multi-outcome markets (Fed rate cuts at N bps levels, NFL playoff
-- bracket positions, election state-by-state, etc.), Polymarket models
-- each outcome as its own binary YES/NO child market. A whale's take
-- against the YES side of "0 bps" and against the YES side of "25 bps"
-- both render today as "YES 62¢" — the take card on a parent event page
-- can't tell the user which child outcome the position was on.
--
-- New column captures the outcome label (e.g. "0 bps", "25 bps", "Trump",
-- "Steelers"). Nullable — binary markets without a parent group leave it
-- empty. Whale-take synthesis resolves it from the screener cache via
-- condition_id; user-posted takes can populate it from the trade widget.
--
-- Adding it as a separate column (not appended to thesis) keeps the
-- structured side / outcome / price triple intact, so the card can render
-- "YES · 25 bps · 62¢" instead of stuffing it into prose.

ALTER TABLE takes
  ADD COLUMN IF NOT EXISTS outcome_label TEXT;

-- No index needed — the column is read-only-with-the-row, never filtered.
