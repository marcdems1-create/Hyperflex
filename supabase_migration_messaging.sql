-- Messaging v1 — 1:1 direct messages between users.
--
-- Schema scope (locked, do NOT widen in this PR):
--   - 1:1 only. The participants table is composite-keyed on
--     (conversation_id, user_id) with no participant cardinality
--     constraint, so the data model is group-ready for v2 (n
--     participants per conversation) — but every v1 code path
--     enforces "exactly 2 participants" at write time.
--   - Plain text only. message body is TEXT with a length CHECK,
--     1..2000 chars. No attachments table in v1; defer to when the
--     upload pipeline lands.
--   - No typing indicators, no read receipts visible to the other
--     party. last_read_at is per-participant and drives the unread
--     badge for that participant only.
--
-- users.id is TEXT (DEFAULT gen_random_uuid()::text) on Railway, NOT
-- UUID — see the core users CREATE TABLE in server.js. Foreign keys
-- match TEXT-to-TEXT, no ::uuid casts needed.
--
-- Run in TablePlus or Railway's SQL console. Idempotent (CREATE TABLE
-- IF NOT EXISTS, CREATE INDEX IF NOT EXISTS) — safe to re-run.

CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

-- "List my conversations" runs a participant lookup keyed on user_id,
-- so an index on user_id (the second key column) is needed since the
-- composite PK only indexes (conversation_id, user_id).
CREATE INDEX IF NOT EXISTS idx_conv_participants_user
  ON conversation_participants(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL CHECK (length(body) > 0 AND length(body) <= 2000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- Thread fetch is "messages in conversation, newest first, paginated"
-- — composite index on (conversation_id, created_at DESC) lets the
-- planner serve the page directly from the index without a sort.
CREATE INDEX IF NOT EXISTS idx_messages_conv_created
  ON messages(conversation_id, created_at DESC);
