/**
 * scripts/test_word_counts.js
 *
 * Manual verification harness for lib/word_counts.js. Run with:
 *
 *   node scripts/test_word_counts.js               # backfill all pending
 *   node scripts/test_word_counts.js <transcript-id>  # single transcript
 *
 * Requires DATABASE_URL in env (or .env). Migration #50 must be live and
 * the transcripts table must already have rows (Phase 2b backfill should
 * have ingested ~51).
 *
 * Phase 2c verification path (per spec):
 *   1. Run with no args → backfill every pending transcript
 *   2. Expect: ~51 succeeded, 0 failed, speakers rebuilt: Powell, ~5s elapsed
 *   3. In TablePlus:
 *        select speaker, word, total_count, source_count
 *        from speaker_word_frequency
 *        where speaker = 'Powell'
 *        order by total_count desc limit 15;
 *   4. Paste top 15 rows back to spec author for sanity-check on shape:
 *        - inflation high (1000+)
 *        - labor market high (~500+)
 *        - transitory low but non-zero (concentrated 2021)
 *        - Warsh-era words (independence, AI, disinflationary) ~ 0
 */

'use strict';

require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');
const wordCounts = require('../lib/word_counts');

// ── ANSI helpers (match test_fed_scrape.js style) ──────────────────────────
const TTY = process.stdout.isTTY;
const c = TTY
  ? {
      cyan:   (s) => `\x1b[38;5;51m${s}\x1b[0m`,
      green:  (s) => `\x1b[38;5;46m${s}\x1b[0m`,
      red:    (s) => `\x1b[38;5;196m${s}\x1b[0m`,
      yellow: (s) => `\x1b[38;5;220m${s}\x1b[0m`,
      pink:   (s) => `\x1b[38;5;205m${s}\x1b[0m`,
      dim:    (s) => `\x1b[2m${s}\x1b[0m`,
      bold:   (s) => `\x1b[1m${s}\x1b[0m`,
      mono:   (s) => `\x1b[38;5;245m${s}\x1b[0m`,
    }
  : Object.fromEntries(
      ['cyan','green','red','yellow','pink','dim','bold','mono'].map(k => [k, (s) => s])
    );

const RULE = c.dim('─'.repeat(64));
function header(label, pillColor = c.cyan) {
  const pill = pillColor(`[ ${label} ]`);
  console.log('\n' + RULE);
  console.log(`  ${c.bold(pill)}  ${c.dim('hyperflex · phase 2c verification')}`);
  console.log(RULE);
}
function ok(line)   { console.log(`  ${c.green('✓')}  ${line}`); }
function bad(line)  { console.log(`  ${c.red('✗')}  ${line}`); }
function warn(line) { console.log(`  ${c.yellow('!')}  ${line}`); }
function info(line) { console.log(`  ${c.dim('·')}  ${c.dim(line)}`); }
function next(line) { console.log(`  ${c.cyan('→')}  ${c.bold(line)}`); }

// ── Pre-flight ─────────────────────────────────────────────────────────────
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  header('PRE-FLIGHT', c.red);
  bad('DATABASE_URL missing in env.');
  next('Add it to .env (Railway dashboard → Postgres service → Variables → DATABASE_URL).');
  console.log('');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});
wordCounts.init({ pool });

// ── Run ────────────────────────────────────────────────────────────────────
(async () => {
  const arg = process.argv[2];

  if (arg && /^[0-9a-f-]{36}$/i.test(arg)) {
    // Single-transcript mode
    header(`SINGLE · ${arg.slice(0, 8)}…`, c.pink);
    const t0 = Date.now();
    const r = await wordCounts.computeWordCounts(arg);
    const elapsed = Date.now() - t0;
    console.log('');
    ok(`${c.bold(c.green('COMPUTED'))}   ${r.wordsTracked} words tracked   ${c.dim(elapsed + 'ms')}`);
    info(`transcript total length: ${r.totalWords.toLocaleString()} words`);
    console.log('');
    next('Inspect counts in TablePlus:');
    console.log(`     ${c.mono(`select word, raw_count, normalized_count`)}`);
    console.log(`     ${c.mono(`from transcript_word_counts`)}`);
    console.log(`     ${c.mono(`where transcript_id = '${arg}'`)}`);
    console.log(`     ${c.mono(`order by raw_count desc;`)}`);
    console.log(RULE);
    console.log('');
    return;
  }

  // Default: full backfill
  header(`BACKFILL · all pending`);
  info('processes every transcript not yet in transcript_word_counts');
  info('then rebuilds speaker_word_frequency rollup once per touched speaker');
  console.log('');

  const t0 = Date.now();
  const result = await wordCounts.backfillAllPending();
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('');
  console.log(RULE);
  ok(`${c.bold(c.green(String(result.succeeded).padStart(3)))} transcripts processed`);
  if (result.failed) {
    bad(`${c.bold(c.red(String(result.failed).padStart(3)))} failed`);
  } else {
    info(`${'  0'.padStart(3)} failed`);
  }
  info(`speakers rebuilt: ${result.speakersRebuilt.length ? result.speakersRebuilt.join(', ') : '(none — already up to date)'}`);
  info(`${elapsedSec}s elapsed`);
  console.log(RULE);

  console.log('');
  next('Verify in TablePlus (NOT terminal — Marc only runs SQL in TablePlus):');
  console.log(`     ${c.mono(`select speaker, word, total_count, source_count`)}`);
  console.log(`     ${c.mono(`from speaker_word_frequency`)}`);
  console.log(`     ${c.mono(`where speaker = 'Powell'`)}`);
  console.log(`     ${c.mono(`order by total_count desc limit 15;`)}`);
  console.log('');
  info('expect shape:');
  info('  • inflation         high (1000+)');
  info('  • labor market      high (~500+)');
  info('  • transitory        low but non-zero (concentrated in 2021)');
  info('  • cut, hike         meaningful counts');
  info('  • Warsh-era words   (independence, AI, disinflationary) ~0 — that is the point');
  console.log('');
})().catch(err => {
  console.log('');
  bad(c.bold(c.red(`FATAL: ${err.message}`)));
  if (err.stack) console.log(c.dim(err.stack.split('\n').slice(1, 4).join('\n')));
  console.log('');
  process.exitCode = 1;
}).finally(async () => {
  try { await pool.end(); } catch (_) {}
});
