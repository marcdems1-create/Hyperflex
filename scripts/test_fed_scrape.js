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
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const fedTranscripts = require('../scrapers/fed_transcripts');

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in env. Aborting.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

fedTranscripts.init({
  fetch,
  supabase,
  computeWordCounts: async (id) => {
    console.log(`[stub] computeWordCounts(${id}) — will run once phase 2c lands`);
  },
});

(async () => {
  const arg = process.argv[2];

  if (arg === '--backfill') {
    console.log(`Backfilling ${fedTranscripts.KNOWN_PRESSER_DATES.length} dates (1s delay each, ~${fedTranscripts.KNOWN_PRESSER_DATES.length}s)...`);
    const r = await fedTranscripts.backfill(fedTranscripts.KNOWN_PRESSER_DATES);
    console.log(`succeeded=${r.succeeded} skipped=${r.skipped} failed=${r.failed}`);
    const failures = r.results.filter(x => !x.ok && !x.skipped);
    if (failures.length) {
      console.error('Failures:');
      for (const f of failures) console.error(`  ${f.date}: ${f.error}`);
    }
    return;
  }

  const date = arg && /^\d{8}$/.test(arg) ? arg : '20240131';
  console.log(`Ingesting FOMC presser ${date}...`);
  const r = await fedTranscripts.ingestOnePresconf(date);
  console.log(JSON.stringify(r, null, 2));
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
