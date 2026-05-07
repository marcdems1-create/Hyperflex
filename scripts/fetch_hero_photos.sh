#!/usr/bin/env bash
# Phase 4.4 hero + event-page portrait fetch.
# Run from the repo root on the Mac:
#   bash scripts/fetch_hero_photos.sh
#
# Drops files into public/images/. The page renderers look for
# /images/<speaker-lowercase>.jpg (powell.jpg, warsh.jpg, etc.) and
# fall through to a CSS monogram if the file is missing — so the
# panel renders clean before any photo lands.
#
# Sources are public-domain government / institutional press photos.
# Don't substitute AI-generated faces or stock illustrations —
# credibility on a receipts product depends on real source material.

set -euo pipefail

OUT_DIR="public/images"
mkdir -p "$OUT_DIR"

# ── Powell · current Fed Chair (2026) ─────────────────────────────────
# Federal Reserve Board official portrait. Public domain (US gov work).
# Browse https://www.federalreserve.gov/aboutthefed/bios/board/powell.htm
# for the canonical PNG link if the URL below changes.
curl -fL --retry 3 -o "$OUT_DIR/powell.jpg" \
  "https://www.federalreserve.gov/aboutthefed/bios/board/images/powell.jpg" \
  || echo "[fetch] powell: source URL changed — visit federalreserve.gov/aboutthefed/bios/board/powell.htm and save manually as $OUT_DIR/powell.jpg"

# ── Warsh · incoming Fed Chair ────────────────────────────────────────
# Hoover Institution profile photo. License: institutional press use.
# https://www.hoover.org/profiles/kevin-warsh
# Hoover doesn't expose a stable .jpg URL on their profile page; the
# photo embeds via their CMS asset path. Right-click → Save Image As
# from the profile page is the most reliable path.
echo "[fetch] warsh: visit https://www.hoover.org/profiles/kevin-warsh, save profile photo as $OUT_DIR/warsh.jpg"

# ── Trump (for /event/trump-iran-* portrait pair) ─────────────────────
# Official White House portrait — public domain.
# https://www.whitehouse.gov/administration/donald-j-trump/
curl -fL --retry 3 -o "$OUT_DIR/trump.jpg" \
  "https://www.whitehouse.gov/wp-content/uploads/2025/01/donald-j-trump-portrait.jpg" \
  || echo "[fetch] trump: source URL changed — save the official portrait manually as $OUT_DIR/trump.jpg"

# ── Biden (comparison anchor for trump-iran event) ────────────────────
# Whitehouse.gov archive photo — public domain.
echo "[fetch] biden: visit https://en.wikipedia.org/wiki/Joe_Biden, download the official portrait file as $OUT_DIR/biden.jpg"

# ── Verify ────────────────────────────────────────────────────────────
echo
echo "Files in $OUT_DIR:"
ls -lh "$OUT_DIR" 2>/dev/null || echo "  (empty)"
echo
echo "Page renderers fall through to CSS monograms for any missing file —"
echo "ship clean now, swap in real photos as they're sourced."
