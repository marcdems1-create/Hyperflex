-- Migration #59: Phase 4.4 — video embed support on mention_events
--
-- Path A per the discussion: one canonical video URL per event,
-- rendered as a click-to-expand player below the lead blurb. No
-- timestamp scrubbing, no atomic-row clip tagging — that's Path B
-- (Phase 5+, hero events only).
--
-- video_url: full URL to source video. Page detects shape:
--   - YouTube (youtube.com / youtu.be) → embed iframe
--   - Direct video (.mp4 / .webm) → <video> element
--   - Anything else → "watch source ↗" link (no embed)
-- video_caption: optional ≤80-char human label for the player's
--   placeholder card (e.g. "FOMC press conference · 1:14:32").
--   Falls back to a generated label from speaker + event_date.
-- video_thumbnail_url: optional poster frame; YouTube thumbnails
--   are derived from the URL, so this is only needed for direct
--   video sources or when the YouTube auto-thumb isn't usable.
--
-- All columns nullable. Existing 86 Fed events backfill to null
-- and the page renders without the video block when absent.

alter table mention_events
  add column if not exists video_url           text,
  add column if not exists video_caption       text,
  add column if not exists video_thumbnail_url text;

-- No indexes — video_url is read on single-event page hits, not
-- queried as a filter. Adding an index would just be overhead.
