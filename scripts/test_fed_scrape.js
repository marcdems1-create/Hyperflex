/**
 * scripts/test_fed_scrape.js
 *
 * Manual verification harness for scrapers/fed_transcripts.js. Run with:
 *
 *   node scripts/test_fed_scrape.js               # ingests 20240131
 *   node scripts/test_fed_scrape.js 20240320      # ingests a specific date
 *   node scripts/test_fed_scrape.js --backfill    # ingests KNOWN_PRESSER_DATES (~50s)
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in env (or .env). Migration
 * #50 must be live — the scraper writes to the `transcripts` table and will
 * fail loudly if it doesn't exist.
 *
 * Phase 2b verification path (per spec):
 *   1. Run with default 20240131
 *   2. Expect: { ok: true, transcriptId: '<uuid>' }
 *   3. In Supabase: select id, speaker, transcript_date, word_count,
 *        length(full_text) from transcripts where transcript_date = '2024-01-31T18:30:00Z';
 *   4. Speaker = 'Powell', word_count > 5000, length(full_text) > 30000.
 *   5. If clean, run with --backfill.
 */

'use strict';

require('dotenv').config({ path: '.env' });
const fetch = require('node-fetch');
const fedTranscripts = require('../scrapers/fed_transcripts');

// ── ANSI helpers ───────────────────────────────────────────────────────────
// Auto-detect TTY; degrade gracefully when piped to a file.
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
  console.log(`  ${c.bold(pill)}  ${c.dim('hyperflex · phase 2b verification')}`);
  console.log(RULE);
}

function ok(line)    { console.log(`  ${c.green('✓')}  ${line}`); }
function bad(line)   { console.log(`  ${c.red('✗')}  ${line}`); }
function warn(line)  { console.log(`  ${c.yellow('!')}  ${line}`); }
function info(line)  { console.log(`  ${c.dim('·')}  ${c.dim(line)}`); }
function next(line)  { console.log(`  ${c.cyan('→')}  ${c.bold(line)}`); }

function jsonCard(obj) {
  const pretty = JSON.stringify(obj, null, 2)
    .split('\n')
    .map(l => '  ' + c.mono(l))
    .join('\n');
  console.log(pretty);
}

// ── Pre-flight ─────────────────────────────────────────────────────────────
// Database is Railway Postgres (per phase 2b.2). The previous Supabase URL
// `cukmymrmivsqneyrkmuo.supabase.co` no longer resolves — that project is
// dead. Talk to pg directly via DATABASE_URL.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  header('PRE-FLIGHT', c.red);
  bad('DATABASE_URL missing in env.');
  next('Add it to .env (Railway dashboard → Postgres service → Variables → DATABASE_URL).');
  console.log('');
  process.exit(1);
}

const { Pool } = require('pg');
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }, // Railway proxy uses SSL with their cert
});

// ── Supabase-shape adapter over pg ─────────────────────────────────────────
// Intentionally minimal: covers ONLY the methods scrapers/fed_transcripts.js
// uses against this client. Specifically:
//   .from(t).select(c).eq(k,v).eq(k,v).eq(k,v).maybeSingle()
//   .from(t).insert(row).select(c).single()
// Anything else ( .update, .delete, .rpc, .order, .limit chained off select )
// will throw "method not implemented" rather than silently fail. The full
// Supabase→pg scrub across server.js + lib/ is a separate follow-up.
function pgAdapter() {
  function notImpl(name) {
    return () => { throw new Error(`pg adapter: .${name}() not implemented`); };
  }
  return {
    from(table) {
      const filters = [];
      let selectCols = '*';
      const builder = {
        _table: table,
        select(cols = '*') { selectCols = cols; return builder; },
        eq(col, val) { filters.push([col, val]); return builder; },
        async maybeSingle() {
          const where = filters.map(([c], i) => `${c} = $${i+1}`).join(' AND ');
          const sql = `select ${selectCols} from ${table}${where ? ' where ' + where : ''} limit 1`;
          try {
            const { rows } = await pool.query(sql, filters.map(([, v]) => v));
            return { data: rows[0] || null, error: null };
          } catch (err) {
            return { data: null, error: { message: err.message } };
          }
        },
        async single() {
          const r = await builder.maybeSingle();
          if (!r.data && !r.error) return { data: null, error: { message: 'no row' } };
          return r;
        },
        insert(row) {
          const cols = Object.keys(row);
          const vals = Object.values(row);
          const placeholders = cols.map((_, i) => `$${i+1}`).join(', ');
          let sql = `insert into ${table} (${cols.join(', ')}) values (${placeholders})`;
          const insertBuilder = {
            select(retCols = '*') { sql += ` returning ${retCols}`; return insertBuilder; },
            async single() {
              try {
                const { rows } = await pool.query(sql, vals);
                return { data: rows[0] || null, error: null };
              } catch (err) {
                return { data: null, error: { message: err.message } };
              }
            },
          };
          return insertBuilder;
        },
        update: notImpl('update'),
        delete: notImpl('delete'),
        rpc: notImpl('rpc'),
      };
      return builder;
    },
  };
}

const supabase = pgAdapter();

fedTranscripts.init({
  fetch,
  supabase,
  computeWordCounts: async (id) => {
    info(`computeWordCounts(${id}) — phase 2c stub, no-op`);
  },
});

// ── Run ────────────────────────────────────────────────────────────────────
(async () => {
  const arg = process.argv[2];

  if (arg === '--backfill') {
    const dates = fedTranscripts.KNOWN_PRESSER_DATES;
    header(`BACKFILL · ${dates.length} dates`);
    info(`1s delay between each — estimated ~${dates.length}s wall time`);
    info('idempotent — re-runs are safe; already-ingested dates skip cleanly');
    console.log('');

    const t0 = Date.now();
    const r = await fedTranscripts.backfill(dates);
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

    console.log('');
    console.log(RULE);
    ok(`${c.bold(c.green(String(r.succeeded).padStart(3)))} ingested`);
    info(`${String(r.skipped).padStart(3)} skipped (already in DB or 404)`);
    if (r.failed) {
      bad(`${c.bold(c.red(String(r.failed).padStart(3)))} failed`);
    } else {
      info(`${'  0'.padStart(3)} failed`);
    }
    info(`${elapsedSec}s elapsed`);
    console.log(RULE);

    const failures = r.results.filter(x => !x.ok && !x.skipped);
    if (failures.length) {
      console.log('');
      bad(c.bold('failures:'));
      for (const f of failures) console.log(`     ${c.dim(f.date)}  ${c.red(f.error || '(no error message)')}`);
    }

    console.log('');
    if (r.failed === 0) {
      next('Run word-count rollup once Phase 2c lands');
    } else {
      next('Inspect failures above, then re-run --backfill (idempotent)');
    }
    console.log('');
    return;
  }

  const date = arg && /^\d{8}$/.test(arg) ? arg : '20240131';
  header(`SINGLE · ${date}`, c.pink);
  info(`source: ${c.mono(`https://www.federalreserve.gov/mediacenter/files/FOMCpresconf${date}.pdf`)}`);
  info(`expected speaker: ${c.mono(fedTranscripts.chairAtDate(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`))}`);
  console.log('');

  const t0 = Date.now();
  const r = await fedTranscripts.ingestOnePresconf(date);
  const elapsedMs = Date.now() - t0;

  console.log('');
  jsonCard(r);
  console.log('');
  console.log(RULE);
  if (r.ok && !r.skipped) {
    ok(`${c.bold(c.green('INGESTED'))}   id ${c.mono(r.transcriptId)}   ${c.dim(elapsedMs + 'ms')}`);
    console.log('');
    next('Verify the row in Supabase:');
    console.log(`     ${c.mono(`select speaker, transcript_date, word_count, length(full_text)`)}`);
    console.log(`     ${c.mono(`from transcripts`)}`);
    console.log(`     ${c.mono(`where transcript_date = '${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T18:30:00Z';`)}`);
    console.log('');
    info('expect: word_count > 5000, length(full_text) > 30000');
    next(`If clean: ${c.bold('node scripts/test_fed_scrape.js --backfill')}`);
  } else if (r.ok && r.skipped) {
    warn(`${c.bold(c.yellow('SKIPPED'))}    ${r.skipped}`);
    if (r.transcriptId) info(`existing row: ${c.mono(r.transcriptId)}`);
    next('Already verified — proceed to --backfill if not run yet');
  } else {
    bad(`${c.bold(c.red('FAILED'))}     ${r.error || '(no error)'}`);
    if (r.skipped) info(`skipped reason: ${r.skipped}`);
    console.log('');
    if (r.error && /text too short/.test(r.error)) {
      next('HTML selector is the highest-risk assumption — flag to Marc.');
      info('The extractTranscriptText regex assumes <div id="article"> wraps the body.');
      info('If fed.gov changed structure, update the selector before backfilling.');
    } else if (r.error && /relation .* does not exist/.test(r.error)) {
      next('Migration #50 not applied yet. Run supabase_migration_50_mention_events.sql.');
    } else {
      next('Inspect the error above + check fed.gov reachability from this machine.');
    }
  }
  console.log(RULE);
  console.log('');
})().catch(err => {
  console.log('');
  bad(c.bold(c.red(`FATAL: ${err.message}`)));
  if (err.stack) console.log(c.dim(err.stack.split('\n').slice(1, 4).join('\n')));
  console.log('');
  process.exitCode = 1;
}).finally(async () => {
  // Release idle pg connections so the process exits instead of hanging
  // on the pool's keep-alive timers.
  try { await pool.end(); } catch (_) {}
});
