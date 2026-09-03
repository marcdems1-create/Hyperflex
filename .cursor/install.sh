#!/usr/bin/env bash
# HYPERFLEX Cloud Agent — install phase (idempotent, one-time baseline setup).
# Installs system packages and Node dependencies. Runtime services (Postgres
# daemon, dev server) are started in start.sh / terminals, not here.
set -euo pipefail
cd "$(dirname "$0")/.."

# ── System packages ────────────────────────────────────────────────────────
# PostgreSQL provides the local dev database. The app talks to it over TCP+SSL
# (server.js forces ssl: { rejectUnauthorized: false }); Ubuntu's postgresql
# package enables SSL with a self-signed cert out of the box, which satisfies it.
# canvas (cairo/pango) runtime libs ship in the base image and sharp bundles
# its own libvips, so no extra graphics packages are required.
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib
fi

# ── Node dependencies ────────────────────────────────────────────────────────
# npm ci is deterministic against the committed package-lock.json and rebuilds
# the native modules (bcrypt, canvas) / prebuilt binaries (sharp) each run.
npm ci

echo "[install] HYPERFLEX install phase complete."
