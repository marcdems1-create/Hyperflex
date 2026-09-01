// Proves the pool-leak fix: a connect that loses the timeout race is still
// released. Without that release, 25 hung checkouts wedge production and
// the homepage APIs 500 forever while /health stays 200.
const { makeDbQuery } = require('../lib/pg-query');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  let released = 0;
  let connects = 0;
  const hangingConnects = [];

  const pool = {
    connect() {
      connects++;
      return new Promise((resolve) => {
        const client = {
          query() { return new Promise(() => {}); },
          release() { released++; },
        };
        hangingConnects.push({ client, resolve });
        // Resolve AFTER the dbQuery timeout, mimicking a slow/queued checkout.
        setTimeout(() => resolve(client), 80);
      });
    },
  };

  const dbQuery = makeDbQuery(pool);
  let threw = false;
  try {
    await dbQuery('SELECT 1', [], 20);
  } catch (e) {
    threw = /connect timeout/.test(e.message);
  }
  ok('timeout rejects', threw);
  ok('no release yet (connect still pending)', released === 0, 'released=' + released);

  await sleep(120);
  ok('late connect is released (no leak)', released === 1, 'released=' + released);
  ok('exactly one checkout', connects === 1, 'connects=' + connects);

  // Query-timeout path: connect wins, query hangs, client is destroyed
  // via release(err) — not returned to the pool as a live query.
  let destroyed = 0;
  let returnedClean = 0;
  const pool2 = {
    connect() {
      return Promise.resolve({
        query() { return new Promise(() => {}); },
        release(err) { if (err) destroyed++; else returnedClean++; },
      });
    },
  };
  const dbQuery2 = makeDbQuery(pool2);
  try { await dbQuery2('SELECT hang', [], 20); } catch (_) {}
  await sleep(30);
  ok('hung query destroys client', destroyed === 1, 'destroyed=' + destroyed);
  ok('hung query is not returned clean', returnedClean === 0, 'clean=' + returnedClean);

  console.log(fail ? `pg-query FAIL ${fail}` : `pg-query ok ${pass}`);
  if (failures.length) failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
