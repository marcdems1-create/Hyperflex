#!/usr/bin/env bash
# HYPERFLEX Cloud Agent — start phase (idempotent, runs on every boot).
# Brings up the local Postgres daemon, ensures the dev role/database exist, and
# writes non-secret dev defaults to .env. Returns once the DB is ready; the dev
# server itself runs as a named terminal (see environment.json "terminals").
set -euo pipefail
cd "$(dirname "$0")/.."

# ── 1. Start the Postgres cluster (idempotent) ──────────────────────────────
PGVER="$(pg_lsclusters -h 2>/dev/null | awk 'NR==1{print $1}')"
PGCLUSTER="$(pg_lsclusters -h 2>/dev/null | awk 'NR==1{print $2}')"
PGVER="${PGVER:-16}"
PGCLUSTER="${PGCLUSTER:-main}"

if ! pg_lsclusters -h 2>/dev/null | awk 'NR==1{print $4}' | grep -q online; then
  sudo pg_ctlcluster "$PGVER" "$PGCLUSTER" start || true
fi

# Wait for the server to accept connections (up to ~30s).
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q 2>/dev/null; then break; fi
  sleep 1
done

# ── 2. Ensure dev role + database exist (idempotent) ────────────────────────
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hyperflex') THEN
    CREATE ROLE hyperflex LOGIN PASSWORD 'hyperflex' SUPERUSER;
  END IF;
END $$;
SQL
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='hyperflex'" | grep -q 1; then
  sudo -u postgres createdb -O hyperflex hyperflex
fi

# ── 3. Write dev .env with non-secret defaults if absent ────────────────────
# dotenv (server.js) does NOT override variables already present in the
# process environment, so real secrets injected via Cursor Secrets win over
# these local dev defaults.
if [ ! -f .env ]; then
  cat > .env <<'ENV'
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://hyperflex:hyperflex@localhost:5432/hyperflex
JWT_SECRET=dev-local-jwt-secret-at-least-32-chars-long-000
ADMIN_SECRET=dev-local-admin-secret
ENV
  echo "[start] wrote dev .env"
fi

echo "[start] Postgres ready on localhost:5432 (db=hyperflex). HYPERFLEX start phase complete."
