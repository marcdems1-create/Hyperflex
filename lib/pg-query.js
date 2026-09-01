// Safe Postgres query helper.
//
// node-pg leaks a checked-out client if you `Promise.race(pool.connect(),
// timeout)` and the timeout wins: connect() still resolves later, and that
// client is never released. After `pool.max` of those the pool is wedged
// until the process restarts — which is how the homepage dies for hours
// while `/health` still returns 200.
//
// Every checkout from this helper is released, including the connect that
// lost the race. A query that times out destroys the client instead of
// returning a poisoned connection to the pool.

function makeDbQuery(getPool) {
  return async function dbQuery(text, params = [], timeoutMs = 15000) {
    const pool = typeof getPool === 'function' ? getPool() : getPool;
    if (!pool) throw new Error('No database pool');

    const connectP = pool.connect();
    let client = null;
    const timers = [];
    const timed = (ms, msg) => new Promise((_, reject) => {
      timers.push(setTimeout(() => reject(new Error(msg)), ms));
    });
    const slice = String(text || '').replace(/\s+/g, ' ').slice(0, 60);

    try {
      client = await Promise.race([
        connectP,
        timed(timeoutMs, `dbQuery connect timeout: ${slice}`),
      ]);
      const result = await Promise.race([
        client.query(text, params),
        timed(timeoutMs, `dbQuery query timeout: ${slice}`),
      ]);
      return result.rows;
    } catch (err) {
      if (!client) {
        // Timeout beat connect(). The pending checkout must still be
        // released when it arrives or it sits in `checked out` forever.
        connectP.then((c) => { try { c.release(); } catch (_) {} }).catch(() => {});
      } else {
        // Query timed out (or failed) with a live client. Destroy it —
        // the in-flight query makes this connection unsafe to reuse.
        try { client.release(err); } catch (_) {}
        client = null;
      }
      throw err;
    } finally {
      timers.forEach(clearTimeout);
      if (client) {
        try { client.release(); } catch (_) {}
      }
    }
  };
}

module.exports = { makeDbQuery };
