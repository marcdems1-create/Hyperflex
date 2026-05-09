// Messaging v1 — schema + helper tests.
//
// Uses node:test (built-in, Node 20+). Skips the suite when DATABASE_URL
// isn't set so the file is safe to keep in CI even on environments
// without a Postgres instance.
//
// Each test runs in its own transaction with ROLLBACK at the end, so
// the suite leaves no rows behind. Required users are inserted as
// fixtures inside the same transaction.
//
// Runs against the live `findOrCreateOneOnOneConversation` helper
// exported from server.js. Endpoints are tested at the SQL/helper
// layer rather than via HTTP — the express layer is a thin wrapper
// around dbQuery + the helper, and a full HTTP integration test
// would require booting the server which adds 30+ seconds and a
// port-conflict risk to every test run. v2 can layer HTTP tests on
// top once the UI is in place.
//
// Run: node --test test/messaging.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const skipReason = process.env.DATABASE_URL ? null : 'DATABASE_URL not set';

if (skipReason) {
  test('messaging suite (skipped)', { skip: skipReason }, () => {});
} else {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('railway') || process.env.DATABASE_URL.includes('supabase')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  // Loaded inside the !skip branch so requiring server.js doesn't
  // run at module-eval time on environments without a DB. server.js
  // boot has side effects (auto-migration, cron schedules) so we
  // import only the named helper.
  const { findOrCreateOneOnOneConversation } = require('../server.js');

  // Run a callback inside a transaction, ROLLBACK at the end.
  // The callback receives a client that has the same .query() shape
  // as a pool, so the helper-under-test is happy with it.
  async function inTx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await fn(client);
    } finally {
      try { await client.query('ROLLBACK'); } catch {}
      client.release();
    }
  }

  // Insert two test users inside the current tx, return their ids.
  // Uses random emails to avoid UNIQUE collisions across runs (paranoia
  // — the ROLLBACK should clean up, but if a prior run crashed mid-test
  // these would otherwise step on stale rows).
  async function makeTwoUsers(client) {
    const suffix = Math.random().toString(36).slice(2, 10);
    const a = await client.query(
      `INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id`,
      [`a-${suffix}@test.local`, `Alice ${suffix}`]
    );
    const b = await client.query(
      `INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id`,
      [`b-${suffix}@test.local`, `Bob ${suffix}`]
    );
    return { aliceId: a.rows[0].id, bobId: b.rows[0].id };
  }

  test('findOrCreateOneOnOneConversation: creates a thread on first call', async () => {
    await inTx(async (client) => {
      const { aliceId, bobId } = await makeTwoUsers(client);
      const result = await findOrCreateOneOnOneConversation(aliceId, bobId, client);
      assert.equal(result.created, true);
      assert.match(result.id, /^[0-9a-f-]+$/);

      const parts = await client.query(
        'SELECT user_id FROM conversation_participants WHERE conversation_id = $1 ORDER BY user_id',
        [result.id]
      );
      assert.equal(parts.rows.length, 2, 'exactly 2 participants');
      const userIds = parts.rows.map(r => r.user_id).sort();
      assert.deepEqual(userIds, [aliceId, bobId].sort());
    });
  });

  test('findOrCreateOneOnOneConversation: idempotent — same two users → same id', async () => {
    await inTx(async (client) => {
      const { aliceId, bobId } = await makeTwoUsers(client);
      const first  = await findOrCreateOneOnOneConversation(aliceId, bobId, client);
      const second = await findOrCreateOneOnOneConversation(aliceId, bobId, client);
      assert.equal(second.created, false);
      assert.equal(second.id, first.id);
    });
  });

  test('findOrCreateOneOnOneConversation: order-independent', async () => {
    await inTx(async (client) => {
      const { aliceId, bobId } = await makeTwoUsers(client);
      const aFirst = await findOrCreateOneOnOneConversation(aliceId, bobId, client);
      const bFirst = await findOrCreateOneOnOneConversation(bobId, aliceId, client);
      assert.equal(bFirst.id, aFirst.id, '(alice, bob) and (bob, alice) match the same thread');
      assert.equal(bFirst.created, false);
    });
  });

  test('findOrCreateOneOnOneConversation: rejects self-DM', async () => {
    await inTx(async (client) => {
      const { aliceId } = await makeTwoUsers(client);
      await assert.rejects(
        () => findOrCreateOneOnOneConversation(aliceId, aliceId, client),
        /cannot DM yourself/
      );
    });
  });

  test('messages: body length CHECK constraint enforces 1..2000', async () => {
    await inTx(async (client) => {
      const { aliceId, bobId } = await makeTwoUsers(client);
      const conv = await findOrCreateOneOnOneConversation(aliceId, bobId, client);

      // Empty body rejected.
      await assert.rejects(() => client.query(
        `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)`,
        [conv.id, aliceId, '']
      ));

      // 2001-char body rejected.
      const tooLong = 'x'.repeat(2001);
      await assert.rejects(() => client.query(
        `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)`,
        [conv.id, aliceId, tooLong]
      ));

      // 2000-char body accepted.
      const maxLen = 'x'.repeat(2000);
      await client.query(
        `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)`,
        [conv.id, aliceId, maxLen]
      );
    });
  });

  test('unread math: new message → unread until last_read_at advances', async () => {
    await inTx(async (client) => {
      const { aliceId, bobId } = await makeTwoUsers(client);
      const conv = await findOrCreateOneOnOneConversation(aliceId, bobId, client);

      // Alice sends a message. Bob should see unread=true.
      await client.query(
        `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)`,
        [conv.id, aliceId, 'hello']
      );

      // Mirror the SQL the list endpoint runs for the unread check
      // (single conversation, one participant POV).
      const unreadForBob = await client.query(
        `SELECT EXISTS (
            SELECT 1 FROM messages m
              JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
             WHERE m.conversation_id = $1
               AND cp.user_id = $2
               AND m.created_at > cp.last_read_at
               AND m.sender_id <> $2
               AND m.deleted_at IS NULL
        ) AS unread`,
        [conv.id, bobId]
      );
      assert.equal(unreadForBob.rows[0].unread, true, "Bob's view should be unread");

      // Alice viewing her own conversation should NOT see unread (her own message).
      const unreadForAlice = await client.query(
        `SELECT EXISTS (
            SELECT 1 FROM messages m
              JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
             WHERE m.conversation_id = $1
               AND cp.user_id = $2
               AND m.created_at > cp.last_read_at
               AND m.sender_id <> $2
               AND m.deleted_at IS NULL
        ) AS unread`,
        [conv.id, aliceId]
      );
      assert.equal(unreadForAlice.rows[0].unread, false, "Alice should not see her own message as unread");

      // Bob marks read. Now unread should flip to false.
      await client.query(
        `UPDATE conversation_participants SET last_read_at = NOW()
          WHERE conversation_id = $1 AND user_id = $2`,
        [conv.id, bobId]
      );
      const stillUnread = await client.query(
        `SELECT EXISTS (
            SELECT 1 FROM messages m
              JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
             WHERE m.conversation_id = $1
               AND cp.user_id = $2
               AND m.created_at > cp.last_read_at
               AND m.sender_id <> $2
               AND m.deleted_at IS NULL
        ) AS unread`,
        [conv.id, bobId]
      );
      assert.equal(stillUnread.rows[0].unread, false, 'after mark-read, unread is false');
    });
  });

  test('soft-deleted messages excluded from thread fetch', async () => {
    await inTx(async (client) => {
      const { aliceId, bobId } = await makeTwoUsers(client);
      const conv = await findOrCreateOneOnOneConversation(aliceId, bobId, client);
      await client.query(
        `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)`,
        [conv.id, aliceId, 'visible']
      );
      const ins = await client.query(
        `INSERT INTO messages (conversation_id, sender_id, body, deleted_at)
          VALUES ($1, $2, $3, NOW()) RETURNING id`,
        [conv.id, aliceId, 'soft-deleted']
      );

      const visible = await client.query(
        `SELECT body FROM messages WHERE conversation_id = $1 AND deleted_at IS NULL`,
        [conv.id]
      );
      assert.equal(visible.rows.length, 1);
      assert.equal(visible.rows[0].body, 'visible');
    });
  });

  // Cleanup the pool after the suite so the test process exits cleanly.
  test.after(async () => { await pool.end(); });
}
