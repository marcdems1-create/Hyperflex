/**
 * scripts/seed_synthetic_speakers.js
 *
 * Phase 2c.5 seed harness. Walks scrapers/fed_speeches.js#KNOWN_SPEECHES
 * and ingests each via ingestOneSpeech() with synthetic_seed=true. The
 * goal is to give the clusterer a non-Powell baseline so rate-vs-corpus
 * math produces non-degenerate output before Warsh's June FOMC.
 *
 * Usage:
 *   node scripts/seed_synthetic_speakers.js                # walks KNOWN_SPEECHES
 *   node scripts/seed_synthetic_speakers.js --dry-run      # print URLs, no fetches
 *
 * Requires DATABASE_URL in env (or .env). Migrations #50 and #52 must be
 * live (transcripts table + synthetic_seed column).
 *
 * Idempotent — re-runs skip already-ingested rows via the
 * UNIQUE (speaker, transcript_date, event_type) constraint.
 *
 * After successful seed:
 *   curl -H "x-admin-secret: $ADMIN_SECRET" http://localhost:3001/api/clusterer/run
 * and verify speakers_processed >= 2 and stance_breakdown has hawkish + dovish > 0.
 */

'use strict';

require('dotenv').config({ path: '.env' });
const fetch = require('node-fetch');
const { Pool } = require('pg');
const fedSpeeches = require('../scrapers/fed_speeches');
const wordCounts = require('../lib/word_counts');

// ── ANSI helpers (degrades to plain text when piped) ──────────────────────
const TTY = process.stdout.isTTY;
const c = TTY
  ? {
      cyan:   s => `\x1b[38;5;51m${s}\x1b[0m`,
      green:  s => `\x1b[38;5;46m${s}\x1b[0m`,
      red:    s => `\x1b[38;5;196m${s}\x1b[0m`,
      yellow: s => `\x1b[38;5;220m${s}\x1b[0m`,
      pink:   s => `\x1b[38;5;205m${s}\x1b[0m`,
      dim:    s => `\x1b[2m${s}\x1b[0m`,
      bold:   s => `\x1b[1m${s}\x1b[0m`,
      mono:   s => `\x1b[38;5;245m${s}\x1b[0m`,
    }
  : Object.fromEntries(['cyan','green','red','yellow','pink','dim','bold','mono']
      .map(k => [k, s => s]));

const RULE = c.dim('─'.repeat(64));
const ok   = l => console.log(`  ${c.green('✓')}  ${l}`);
const bad  = l => console.log(`  ${c.red('✗')}  ${l}`);
const warn = l => console.log(`  ${c.yellow('!')}  ${l}`);
const info = l => console.log(`  ${c.dim('·')}  ${c.dim(l)}`);
const next = l => console.log(`  ${c.cyan('→')}  ${c.bold(l)}`);

function header(label, color = c.cyan) {
  console.log('\n' + RULE);
  console.log(`  ${c.bold(color(`[ ${label} ]`))}  ${c.dim('hyperflex · phase 2c.5 synthetic seed')}`);
  console.log(RULE);
}

// ── Pre-flight ────────────────────────────────────────────────────────────
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  header('PRE-FLIGHT', c.red);
  bad('DATABASE_URL missing in env.');
  next('Add it to .env (Railway dashboard → Postgres → Variables).');
  console.log('');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

// Same Supabase-shape pg adapter used by scripts/test_fed_scrape.js.
// Intentionally minimal — covers only what fed_speeches calls:
//   .from(t).select(c).eq(...).maybeSingle()
//   .from(t).insert(row).select(c).single()
function pgAdapter() {
  function notImpl(name) {
    return () => { throw new Error(`pg adapter: .${name}() not implemented`); };
  }
  return {
    from(table) {
      const filters = [];
      let selectCols = '*';
      const builder = {
        select(cols = '*') { selectCols = cols; return builder; },
        eq(col, val) { filters.push([col, val]); return builder; },
        async maybeSingle() {
          const where = filters.map(([col], i) => `${col} = $${i+1}`).join(' AND ');
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
        rpc:    notImpl('rpc'),
      };
      return builder;
    },
  };
}

const supabase = pgAdapter();
wordCounts.init({ pool });
fedSpeeches.init({
  fetch,
  supabase,
  computeWordCounts: wordCounts.computeWordCounts,
});

// ── Run ───────────────────────────────────────────────────────────────────
(async () => {
  const dryRun = process.argv.includes('--dry-run');
  const speeches = fedSpeeches.KNOWN_SPEECHES;

  header(`SEED · ${speeches.length} speeches${dryRun ? ' (DRY RUN)' : ''}`,
    speeches.length === 0 ? c.yellow : c.pink);

  if (speeches.length === 0) {
    warn('KNOWN_SPEECHES is empty — nothing to ingest.');
    next('Populate scrapers/fed_speeches.js#KNOWN_SPEECHES with sourced URLs, then re-run.');
    console.log('');
    await pool.end();
    return;
  }

  // Speaker breakdown of the config block (sanity check before fetching)
  const perSpeakerConfig = new Map();
  const perStanceConfig = { hawkish: 0, dovish: 0, neutral: 0, undefined: 0 };
  for (const s of speeches) {
    perSpeakerConfig.set(s.speaker, (perSpeakerConfig.get(s.speaker) || 0) + 1);
    perStanceConfig[s.expectedStance || 'undefined']++;
  }
  info(`config speaker breakdown: ${JSON.stringify(Object.fromEntries(perSpeakerConfig))}`);
  info(`config expected-stance:   ${JSON.stringify(perStanceConfig)}`);
  console.log('');

  if (dryRun) {
    for (const s of speeches) {
      info(`${s.speaker.padEnd(10)} ${s.date}  ${(s.expectedStance || '?').padEnd(8)}  ${c.mono(s.url)}`);
    }
    console.log('');
    next(`Drop --dry-run to ingest. Estimated wall time: ~${speeches.length}s.`);
    console.log('');
    await pool.end();
    return;
  }

  const t0 = Date.now();
  const r = await fedSpeeches.seedAll();
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('');
  console.log(RULE);
  ok(`${c.bold(c.green(String(r.succeeded).padStart(3)))} ingested`);
  info(`${String(r.skipped).padStart(3)} skipped (already in DB or 404)`);
  if (r.failed) bad(`${c.bold(c.red(String(r.failed).padStart(3)))} failed`);
  else          info(`${'  0'.padStart(3)} failed`);
  info(`${elapsedSec}s elapsed`);
  console.log(RULE);

  const failures = r.results.filter(x => !x.ok && !x.skipped);
  if (failures.length) {
    console.log('');
    bad(c.bold('failures:'));
    for (const f of failures) {
      console.log(`     ${c.dim(f.speaker + ' ' + f.date)}  ${c.red(f.error || '(no message)')}`);
    }
  }

  console.log('');
  if (r.failed === 0 && r.succeeded > 0) {
    next('Re-run the clusterer to pick up the new speakers:');
    console.log(`     ${c.mono('curl -H "x-admin-secret: $ADMIN_SECRET" http://localhost:3001/api/clusterer/run | jq')}`);
    console.log('');
    info('Acceptance: speakers_processed >= 2, stance_breakdown has hawkish + dovish > 0.');
  } else if (r.succeeded === 0) {
    next('No new ingests. Check if the URLs returned 404 or the rows already exist.');
  } else {
    next('Re-run after fixing the failures (idempotent — succeeded rows skip cleanly).');
  }
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
