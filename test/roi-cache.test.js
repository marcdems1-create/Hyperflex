// Tests the REAL cache + single-flight wrapper around _computeRoiLeaderboard,
// sliced out of server.js and eval'd against a stub of the uncached query.
//
// Why this matters: that aggregate is the first thing four homepage
// endpoints each do, it had no cache, and it can hold a pool connection for
// the full 15s statement_timeout. Single-flight is the half that stops a
// cold-cache stampede — a plain cache still lets N concurrent callers each
// start their own scan.
//
// Run: npm run test:roi-cache
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const start = src.indexOf('const _roiBoardCache = new Map();');
const end = src.indexOf('async function _computeRoiLeaderboardUncached');
if (start < 0 || end < 0) throw new Error('could not locate the cache wrapper');
const block = src.slice(start, end);

let calls = 0;
let mode = 'ok';
let release;
async function _computeRoiLeaderboardUncached(window, minN) {
  calls++;
  if (mode === 'slow') await new Promise((r) => { release = r; });
  if (mode === 'fail') return null;
  return { rows: [{ user_id: 'u1', window, minN }], at: Date.now() };
}
eval(block);

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d) => { if (c) pass++; else { fail++; failures.push(n + (d ? ' — ' + d : '')); } };

(async () => {
  // ── single-flight: a stampede collapses to one query ────────────────
  mode = 'slow'; calls = 0;
  const stampede = Promise.all(Array.from({ length: 12 }, () => _computeRoiLeaderboard('all', 10)));
  await new Promise((r) => setTimeout(r, 10));
  ok('single-flight: 12 concurrent callers start exactly one query', calls === 1, 'calls=' + calls);
  mode = 'ok'; release();
  const results = await stampede;
  ok('single-flight: every caller gets a result', results.every((r) => r && r.rows));
  ok('single-flight: they all get the SAME result object', new Set(results).size === 1);

  // ── cache: a later caller inside the TTL does not re-query ──────────
  calls = 0;
  await _computeRoiLeaderboard('all', 10);
  ok('cache: a warm key issues no query', calls === 0, 'calls=' + calls);

  // ── keys do not collide ────────────────────────────────────────────
  calls = 0;
  const a = await _computeRoiLeaderboard('30d', 10);
  const b = await _computeRoiLeaderboard('all', 25);
  ok('cache: a different window is a different key', calls === 2, 'calls=' + calls);
  ok('cache: results are keyed correctly', a.rows[0].window === '30d' && b.rows[0].minN === 25);

  // ── a failed query is never cached ──────────────────────────────────
  mode = 'fail'; calls = 0;
  const f1 = await _computeRoiLeaderboard('7d', 10);
  ok('failure: null is returned to the caller', f1 === null);
  const f2 = await _computeRoiLeaderboard('7d', 10);
  ok('failure: null is NOT cached, so recovery is immediate', calls === 2, 'calls=' + calls);
  mode = 'ok';
  const f3 = await _computeRoiLeaderboard('7d', 10);
  ok('failure: the next good result is served', f3 && f3.rows.length === 1);

  // ── in-flight entry is released even when the query throws ──────────
  calls = 0;
  const boom = new Error('db exploded');
  const orig = _computeRoiLeaderboardUncached;
  // eslint-disable-next-line no-global-assign
  _computeRoiLeaderboardUncached = async () => { calls++; throw boom; };
  let threw = false;
  try { await _computeRoiLeaderboard('90d', 10); } catch (e) { threw = e === boom; }
  ok('failure: a throwing query propagates', threw);
  try { await _computeRoiLeaderboard('90d', 10); } catch (e) { /* expected */ }
  ok('failure: a throw does not wedge the in-flight slot', calls === 2, 'calls=' + calls);
  _computeRoiLeaderboardUncached = orig;

  console.log('\n' + '='.repeat(56));
  console.log('ROI CACHE SUITE:  ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) { console.log('\nFAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); }
  console.log('='.repeat(56));
  process.exit(fail ? 1 : 0);
})();
