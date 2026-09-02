// Homepage APIs must keep serving last-good as 200 when Postgres is down.
// A cold miss with an open circuit must fail immediately (no 5–15s wait).
const { createStaleStore } = require('../lib/stale-payload');
const { createConnectCircuit } = require('../lib/pg-query');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); }
}

function sendHomepage(store, circuit, key, builder) {
  if (circuit.snapshot().open && !store.peek(key)) {
    return Promise.resolve({ status: 503, body: { unavailable: true, error: 'pg_circuit_open' } });
  }
  return store.resolve(key, builder).then(
    (r) => ({ status: 200, stale: r.stale, body: r.data }),
    (e) => ({ status: 503, body: { unavailable: true, error: e.message } })
  );
}

(async () => {
  const store = createStaleStore({ ttlMs: 50 });
  const circuit = createConnectCircuit({ failLimit: 1, openMs: 5000 });

  const good = await sendHomepage(store, circuit, 'kings', async () => ({
    overall: [{ display_name: 'TB14', flex_score: 91 }],
    categories: [],
  }));
  ok('fresh build is 200', good.status === 200);
  ok('fresh payload has a trader', good.body.overall[0].display_name === 'TB14');

  circuit.fail(new Error('timeout exceeded when trying to connect'));
  ok('circuit is open', circuit.snapshot().open === true);

  let built = false;
  const stale = await sendHomepage(store, circuit, 'kings', async () => {
    built = true;
    throw new Error('should not rebuild');
  });
  ok('last-good is still 200 when circuit is open', stale.status === 200);
  ok('last-good keeps the trader', stale.body.overall[0].display_name === 'TB14');
  ok('last-good does not wait on a builder', built === false);

  const cold = await sendHomepage(store, circuit, 'board-stats', async () => {
    throw new Error('should not be called');
  });
  ok('cold miss with open circuit is 503', cold.status === 503);
  ok('cold miss does not wait on postgres', cold.body.error === 'pg_circuit_open');

  console.log(fail ? `homepage-failopen FAIL ${fail}` : `homepage-failopen ok ${pass}`);
  if (failures.length) failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
