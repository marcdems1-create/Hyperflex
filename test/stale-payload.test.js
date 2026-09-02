const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStaleStore } = require('../lib/stale-payload');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); }
}

(async () => {
  const file = path.join(os.tmpdir(), 'hfx-stale-test-' + Date.now() + '.json');
  const store = createStaleStore({ ttlMs: 50, file });

  let builds = 0;
  const a = await store.resolve('kings', async () => { builds++; return { overall: [1] }; });
  ok('cold miss builds', a.data.overall[0] === 1 && builds === 1);
  ok('cold miss is fresh', a.stale === false);

  const b = await store.resolve('kings', async () => { builds++; return { overall: [2] }; });
  ok('fresh hit does not rebuild', builds === 1, 'builds=' + builds);
  ok('fresh hit not stale', b.stale === false);

  await new Promise((r) => setTimeout(r, 60));
  let slowStarted = false;
  let slowFinished = false;
  const c = await store.resolve('kings', async () => {
    slowStarted = true;
    await new Promise((r) => setTimeout(r, 80));
    slowFinished = true;
    builds++;
    return { overall: [3] };
  });
  ok('expired hit returns last-good immediately', c.data.overall[0] === 1);
  ok('expired hit marked stale', c.stale === true);
  ok('refresh started in background', slowStarted === true);
  ok('did not wait for slow refresh', slowFinished === false);

  await new Promise((r) => setTimeout(r, 100));
  const d = await store.resolve('kings', async () => { builds++; return { overall: [4] }; });
  ok('after refresh, new payload is served', d.data.overall[0] === 3, JSON.stringify(d.data));

  // Builder failure must not wipe last-good
  await new Promise((r) => setTimeout(r, 60));
  const e = await store.resolve('kings', async () => { throw new Error('pg_timeout'); });
  ok('failed refresh still serves last-good', e.data.overall[0] === 3);
  ok('failed refresh is stale', e.stale === true);

  const store2 = createStaleStore({ ttlMs: 50, file });
  const f = await store2.resolve('kings', async () => { throw new Error('should not need this'); });
  ok('disk snapshot rehydrates after restart', f.data.overall[0] === 3);

  const seeded = createStaleStore({ ttlMs: 50, seed: { kings: { overall: [{ display_name: 'Seed' }] } } });
  const g = await seeded.resolve('kings', async () => { throw new Error('pg_timeout'); });
  ok('seed serves last-good without builder', g.data.overall[0].display_name === 'Seed');
  ok('seed is stale so a later refresh can replace it', g.stale === true);

  try { fs.unlinkSync(file); } catch (_) {}
  console.log(fail ? `stale-payload FAIL ${fail}` : `stale-payload ok ${pass}`);
  if (failures.length) failures.forEach((x) => console.log('  ✗ ' + x));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
