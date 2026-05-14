-- Rollback for migration #61. Drops mention_markets + classification_runs.
-- Apply only if MP-2d work is being reverted. Does NOT restore event_markets
-- (was dropped intentionally in #61's preamble; no data to restore).

drop table if exists mention_markets cascade;
drop table if exists classification_runs cascade;
