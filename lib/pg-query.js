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
//
// Connect-timeout circuit: after a few failed checkouts, fail immediately
// for a few seconds instead of letting every cron + homepage rail occupy
// a pool slot until connectionTimeoutMillis. Homepage last-good can then
// answer in milliseconds instead of 5–15s.

function isConnectFailure(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || err);
  if (code === 'PG_CIRCUIT') return true;
  if (/^(ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|EAI_AGAIN|ECONNRESET)$/.test(code)) return true;
  return /timeout exceeded when trying to connect|Connection terminated due to connection timeout|dbQuery connect timeout|pg_circuit_open|connect ETIMEDOUT|connect ECONNREFUSED/i.test(msg);
}

function createConnectCircuit(opts = {}) {
  const failLimit = opts.failLimit != null ? opts.failLimit : 2;
  const openMs = opts.openMs != null ? opts.openMs : 15000;
  let fails = 0;
  let openUntil = 0;
  let lastError = null;
  let openedAt = null;

  return {
    snapshot() {
      const now = Date.now();
      return {
        open: now < openUntil,
        open_ms_remaining: now < openUntil ? openUntil - now : 0,
        fails,
        last_error: lastError,
        opened_at: openedAt,
      };
    },
    assert() {
      if (Date.now() < openUntil) {
        const err = new Error('pg_circuit_open');
        err.code = 'PG_CIRCUIT';
        throw err;
      }
    },
    fail(err) {
      lastError = err && (err.message || String(err));
      if (!isConnectFailure(err)) {
        fails = 0;
        return false;
      }
      fails++;
      if (fails >= failLimit) {
        openUntil = Date.now() + openMs;
        openedAt = new Date().toISOString();
        fails = 0;
        return true;
      }
      return false;
    },
    ok() {
      fails = 0;
      openUntil = 0;
      openedAt = null;
      lastError = null;
    },
  };
}

function createPgGate() {
  let ready = false;
  const queued = [];
  return {
    isReady() { return ready; },
    queuedCount() { return queued.length; },
    whenReady(fn) {
      if (typeof fn !== 'function') return;
      if (ready) {
        Promise.resolve().then(fn).catch(() => {});
        return;
      }
      queued.push(fn);
    },
    markReady() {
      if (ready) return;
      ready = true;
      const q = queued.splice(0);
      for (const fn of q) Promise.resolve().then(fn).catch(() => {});
    },
    markUnready() {
      ready = false;
    },
  };
}

function makeDbQuery(getPool, circuit) {
  return async function dbQuery(text, params = [], timeoutMs = 15000) {
    if (circuit) circuit.assert();
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
      if (circuit) circuit.ok();
      return result.rows;
    } catch (err) {
      if (circuit) circuit.fail(err);
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

function pgHostKind(url) {
  if (!url) return { kind: 'none', host: null };
  try {
    const u = new URL(String(url).replace(/^postgresql:/i, 'http:'));
    const host = u.hostname || '';
    let kind = 'other';
    if (/\.railway\.internal$/i.test(host)) kind = 'private';
    else if (/\.rlwy\.net$/i.test(host) || /\.proxy\.rlwy\.net$/i.test(host) || /\.railway\.app$/i.test(host)) kind = 'public-proxy';
    return { kind, host: host.replace(/^.{0,8}/, (s) => s[0] + '…') };
  } catch (_) {
    return { kind: 'unknown', host: null };
  }
}

function makePoolConfig(connectionString, extra = {}) {
  const max = extra.max != null ? extra.max : 8;
  return {
    connectionString,
    ssl: { rejectUnauthorized: false },
    max,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: extra.connectionTimeoutMillis != null ? extra.connectionTimeoutMillis : 2500,
    statement_timeout: 10000,
    query_timeout: 10000,
    allowExitOnIdle: true,
    keepAlive: true,
    keepAliveInitialDelayMillis: 5000,
  };
}

module.exports = {
  makeDbQuery,
  createConnectCircuit,
  createPgGate,
  isConnectFailure,
  pgHostKind,
  makePoolConfig,
};
