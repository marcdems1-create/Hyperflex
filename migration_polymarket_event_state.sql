-- Migration: polymarket_event_state — sports-page hero rotation state
--
-- Path-(b)-(ii) per the /sports build: live-read event + market data from
-- Polymarket Gamma + the existing in-memory _screenerCache, persist ONLY
-- the small slice of state the rotation logic needs across restarts:
--   - which event was last shown as hero (drives the 24h-hold rule)
--   - when an event closed (recap window starts here)
--   - the recap payload itself (winner, top cashing positions, total vol)
--   - editorial "The take" copy (admin-edits via TablePlus)
--
-- Everything else (title, sport, prices, aggregate volume, status, child
-- markets, image urls) comes from the live Gamma /events response and is
-- intentionally NOT persisted here. If we later promote to a full
-- polymarket_events + polymarket_markets snapshot pipeline (path b-i),
-- this state table either folds into it or stays as a thin sidecar.
--
-- See CLAUDE.md "MUST DO BEFORE DEPLOY" section for migration runbook.
-- DO NOT run this file until columns are confirmed in TablePlus per the
-- branch's Phase 1 brief.

CREATE TABLE IF NOT EXISTS polymarket_event_state (
  -- Gamma event id (string in their API; preserve as TEXT to match how the
  -- rest of the codebase stores Polymarket identifiers — condition_id,
  -- token_id, etc. are all TEXT.)
  event_id        TEXT PRIMARY KEY,
  -- Event slug (the human-readable polymarket.com/event/<slug> URL piece).
  -- Unique because slugs are 1:1 with events on Gamma's side.
  polymarket_slug TEXT UNIQUE NOT NULL,
  -- Editorial "The take" copy. Nullable; the hero endpoint falls back to
  -- an auto-generated stub from event stats when this is NULL.
  editorial_take  TEXT,
  -- Set true the first time an event is selected as hero. Once true, the
  -- event becomes eligible for the 24h-hold treatment when it closes.
  -- Never reset.
  was_hero        BOOLEAN NOT NULL DEFAULT false,
  -- When was_hero first flipped true (debug + analytics; not used by
  -- rotation logic). Set by the same UPDATE that flips was_hero.
  hero_first_at   TIMESTAMPTZ,
  -- When the event flipped to closed (Gamma event.closed = true OR
  -- end_date < NOW()). The 24h-hold window starts here. Set by the
  -- /api/sports/hero endpoint the first time it observes a closed
  -- transition for a was_hero event; admin can override via TablePlus.
  closed_at       TIMESTAMPTZ,
  -- Recap payload, captured when closed_at is first set. Shape:
  --   { winner: string, top_cashing: [{handle, pnl, entry}, ...],
  --     total_vol_traded: number, market_id: string }
  -- JSONB so we can extend without ALTERs.
  closed_recap    JSONB,
  -- Bookkeeping. Updated on every write that touches this row.
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hero rotation reads: "any was_hero event that closed in last 24h?"
-- A partial index on closed_at WHERE was_hero is the cheapest path.
CREATE INDEX IF NOT EXISTS idx_pes_hero_closed
  ON polymarket_event_state (closed_at DESC)
  WHERE was_hero = true AND closed_at IS NOT NULL;

-- Editorial admin lookups by slug.
CREATE INDEX IF NOT EXISTS idx_pes_slug ON polymarket_event_state (polymarket_slug);
