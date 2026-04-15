#!/usr/bin/env node
/**
 * schema-diff.js — HYPERFLEX Railway Postgres schema audit
 *
 * Parses every supabase_migration_*.sql file at the repo root to build the set
 * of tables + columns the codebase expects, then queries the live Railway
 * Postgres (via DATABASE_URL) and reports:
 *   - tables declared in a migration but MISSING from prod
 *   - columns declared in a migration but MISSING from prod
 *
 * Run locally or from any host that can reach Railway Postgres:
 *   DATABASE_URL='postgresql://...' node scripts/schema-diff.js
 *
 * Exits 0 on clean diff, 1 on any missing table/column.
 *
 * Parsing is intentionally forgiving — it looks at CREATE TABLE bodies and
 * ALTER TABLE ... ADD COLUMN statements. It does NOT check types, constraints,
 * indexes, or triggers. The goal is to catch "migration never ran" bugs, which
 * is the 99% case (see CLAUDE.md migration section for why).
 */

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const REPO_ROOT = path.resolve(__dirname, '..');

// ── Strip SQL comments so regexes don't match inside them ──────────────────
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')       // /* ... */
    .replace(/--[^\n]*/g, '');              // -- to end of line
}

// ── Split a CREATE TABLE body on top-level commas only (ignore parens) ─────
function splitTopLevel(body) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// Table-level constraint keywords — any body row starting with these is NOT a column
const CONSTRAINT_KW = /^(primary\s+key|unique|foreign\s+key|check|constraint|exclude|like|index)\b/i;

// ── Parse one migration file → { tables: Map<name, Set<col>>, altered: Array<{table,col}> } ─
function parseMigration(sql) {
  const cleaned = stripComments(sql);
  const tables  = new Map();
  const altered = [];

  // CREATE TABLE [IF NOT EXISTS] schema.name (body) — greedy match body with balanced parens
  const createRx = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  let m;
  while ((m = createRx.exec(cleaned)) !== null) {
    const tableName = m[1].toLowerCase();
    // Walk from the opening paren to find the matching close
    let depth = 1;
    let i = createRx.lastIndex;
    let body = '';
    while (i < cleaned.length && depth > 0) {
      const ch = cleaned[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (depth > 0) body += ch;
      i++;
    }
    const cols = new Set();
    for (const row of splitTopLevel(body)) {
      if (!row || CONSTRAINT_KW.test(row)) continue;
      // First whitespace-separated token (strip quotes)
      const tok = row.split(/\s+/)[0].replace(/^"|"$/g, '').toLowerCase();
      if (tok && /^[a-z_][a-z0-9_]*$/.test(tok)) cols.add(tok);
    }
    if (!tables.has(tableName)) tables.set(tableName, new Set());
    for (const c of cols) tables.get(tableName).add(c);
  }

  // ALTER TABLE name ADD COLUMN [IF NOT EXISTS] colname ...
  const alterRx = /alter\s+table\s+(?:if\s+exists\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
  while ((m = alterRx.exec(cleaned)) !== null) {
    altered.push({ table: m[1].toLowerCase(), col: m[2].toLowerCase() });
  }

  return { tables, altered };
}

// ── Scan repo root for migrations ──────────────────────────────────────────
function loadAllMigrations() {
  const files = fs.readdirSync(REPO_ROOT)
    .filter(f => /^supabase_migration_.*\.sql$/i.test(f))
    .sort();

  // expected.tables: Map<tableName, { cols: Set<string>, source: string }>
  // expected.columns: Array<{ table, col, source }> — from both CREATE bodies and ALTER ADD
  const expectedTables = new Map();
  const expectedColumns = [];

  for (const f of files) {
    const sql = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
    const { tables, altered } = parseMigration(sql);

    for (const [t, cols] of tables) {
      if (!expectedTables.has(t)) {
        expectedTables.set(t, { cols: new Set(), source: f });
      }
      for (const c of cols) {
        expectedTables.get(t).cols.add(c);
        expectedColumns.push({ table: t, col: c, source: f });
      }
    }
    for (const { table, col } of altered) {
      expectedColumns.push({ table, col, source: f });
    }
  }
  return { files, expectedTables, expectedColumns };
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Export it first:');
    console.error('  export DATABASE_URL="postgresql://..."');
    process.exit(2);
  }

  const { files, expectedTables, expectedColumns } = loadAllMigrations();
  console.log(`\n=== HYPERFLEX Schema Diff ===`);
  console.log(`Scanned ${files.length} migration files.\n`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  // Identify DB
  const idRows = await pool.query(
    `SELECT current_database() AS db, inet_server_addr()::text AS host, inet_server_port() AS port`
  );
  const id = idRows.rows[0] || {};
  console.log(`Connected: db=${id.db} host=${id.host || '(local socket)'} port=${id.port}\n`);

  // Live tables + columns in `public`
  const [tRes, cRes] = await Promise.all([
    pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`),
    pool.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'`),
  ]);
  const liveTables = new Set(tRes.rows.map(r => r.table_name.toLowerCase()));
  const liveCols = new Map(); // table -> Set<col>
  for (const r of cRes.rows) {
    const t = r.table_name.toLowerCase();
    if (!liveCols.has(t)) liveCols.set(t, new Set());
    liveCols.get(t).add(r.column_name.toLowerCase());
  }

  // Diff tables
  const missingTables = [];
  for (const [t, meta] of expectedTables) {
    if (!liveTables.has(t)) missingTables.push({ table: t, source: meta.source });
  }

  // Diff columns (only for tables that DO exist — otherwise missing-table already covers it)
  const missingCols = [];
  const seen = new Set();
  for (const { table, col, source } of expectedColumns) {
    const key = `${table}.${col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!liveTables.has(table)) continue;              // covered by missing-table report
    const live = liveCols.get(table) || new Set();
    if (!live.has(col)) missingCols.push({ table, col, source });
  }

  // Report
  if (missingTables.length) {
    console.log(`❌ MISSING TABLES (${missingTables.length}):`);
    for (const { table, source } of missingTables) {
      console.log(`   ${table.padEnd(40)}  ← ${source}`);
    }
    console.log();
  }

  if (missingCols.length) {
    console.log(`❌ MISSING COLUMNS (${missingCols.length}):`);
    for (const { table, col, source } of missingCols) {
      console.log(`   ${(table + '.' + col).padEnd(50)}  ← ${source}`);
    }
    console.log();
  }

  if (!missingTables.length && !missingCols.length) {
    console.log(`✅ All ${expectedTables.size} expected tables and ${seen.size} columns are present.\n`);
  } else {
    console.log(`Summary: ${missingTables.length} missing tables, ${missingCols.length} missing columns.`);
    console.log(`Run the listed migration file(s) in Railway Postgres's Data tab (NOT Supabase).\n`);
  }

  await pool.end();
  process.exit(missingTables.length || missingCols.length ? 1 : 0);
})().catch(e => {
  console.error('schema-diff failed:', e.message);
  process.exit(2);
});
