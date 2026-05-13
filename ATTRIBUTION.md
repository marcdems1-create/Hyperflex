# Speaker portrait attributions

Hero portrait imagery used in `/mentions` (Powell vs Warsh) and
`/event/<slug>` (per-event speaker hero) is loaded from
`/public/speakers/<slug>.jpg` where `<slug>` is the lowercased
`mention_events.speaker` value (e.g. `powell.jpg`, `warsh.jpg`,
`trump.jpg`).

Missing files fall through to a CSS-rendered monogram via
`onerror="this.remove()"` on the `<img>`, so the surface ships clean
even when a portrait hasn't been uploaded yet.

## Why this file exists

Every image bundled below is sourced from a public-domain or
verifiable-CC-license origin. Recording the source URL + license per
file keeps us defensible if a third party asks where the image came
from. Verify each license **on the file's source page** (not just on
the URL pattern) before uploading.

## Sourcing instructions

The Claude sandbox has no outbound network to `federalreserve.gov`,
`commons.wikimedia.org`, or `upload.wikimedia.org` — sourcing and
upload happen from a human-operated machine. Workflow:

1. Open the source URL listed below in a browser.
2. Confirm the license declaration on the source page (Federal
   Reserve / Library of Congress / Treasury portraits are public
   domain under 17 U.S.C. §105; Wikimedia mirrors carry the
   underlying public-domain claim, but always verify on the file's
   Commons page).
3. Download the highest-resolution version available.
4. Crop to square or 4:3 aspect ratio.
5. Optimize to <200KB JPG (Squoosh / `cwebp` → `cjpeg` / ImageMagick).
6. Place at `public/speakers/<slug>.jpg` matching the slug column
   below.
7. Update the **Status** column in this table from `pending-upload`
   to `uploaded YYYY-MM-DD`.
8. Commit + push.

## Attribution table

Priority bucket per the spec: Tier 1 ships first (highest platform
visibility), Tier 2 in the same PR if time allows, Tier 3 falls back
gracefully to letter-avatar if licensing is uncertain.

| Tier | Speaker | File | Source URL | License | Status |
|------|---------|------|------------|---------|--------|
| 1 | Powell  | `powell.jpg`    | https://www.federalreserve.gov/aboutthefed/bios/board/powell.htm  · mirror: https://commons.wikimedia.org/wiki/File:Jerome_H._Powell,_Federal_Reserve_Chair_(cropped).jpg | Public domain (US Federal Reserve Board work, 17 USC §105) | pending-upload |
| 1 | Warsh   | `warsh.jpg`     | https://commons.wikimedia.org/wiki/File:Kevin_Warsh,_Federal_Reserve_photo_portrait.jpg | Public domain (US Federal Reserve Board work, 2006-2011 tenure photo; swap to new official portrait when federalreserve.gov publishes one post-2026 confirmation) | pending-upload |
| 1 | Trump   | `trump.jpg`     | https://www.loc.gov/resource/ppbd.00608/  · mirror: https://commons.wikimedia.org/wiki/File:Donald_Trump_official_portrait_(cropped).jpg | Public domain (US government work) — use 2025 Trump 47 portrait, NOT 2017 | pending-upload |
| 2 | Waller    | `waller.jpg`    | https://www.federalreserve.gov/aboutthefed/bios/board/waller.htm    | Public domain (US Federal Reserve Board work) | pending-upload |
| 2 | Jefferson | `jefferson.jpg` | https://www.federalreserve.gov/aboutthefed/bios/board/jefferson.htm | Public domain (US Federal Reserve Board work) | pending-upload |
| 2 | Bowman    | `bowman.jpg`    | https://www.federalreserve.gov/aboutthefed/bios/board/bowman.htm    | Public domain (US Federal Reserve Board work) | pending-upload |
| 2 | Cook      | `cook.jpg`      | https://www.federalreserve.gov/aboutthefed/bios/board/cook.htm      | Public domain (US Federal Reserve Board work) | pending-upload |
| 3 | Biden     | `biden.jpg`     | https://www.loc.gov/free-to-use/presidential-portraits/             | Public domain (US government work) | pending-upload |
| 3 | Brainard  | `brainard.jpg`  | federalreserve.gov bios archive / Wikimedia Commons (Fed-era photo) | Public domain (US Federal Reserve Board work) | pending-upload |
| 3 | Bessent   | `bessent.jpg`   | treasury.gov official portrait / Wikimedia Commons "Scott_Bessent_official_portrait" | Public domain (US Treasury Department work) | pending-upload |
| 3 | Shelton   | `shelton.jpg`   | Wikimedia Commons (no official Fed portrait — nominated but not confirmed) | **Verify on Commons page before download.** Letter-avatar fallback acceptable if no clean CC license. | pending-upload |

## Wiring summary

Three callsites reference `/speakers/<slug>.jpg`:

- `server.js:_renderMentionsHero` — Powell + Warsh hardcoded for the
  P-vs-W /mentions hero.
- `server.js` per-event preview path — slug derived from attributed
  speaker via `String(attributed).toLowerCase().replace(/[^a-z0-9-]+/g, '')`.
- `public/event.html:_portraitFile` + `public/event.html` hero block —
  per-event speaker portrait, same slug shape.

Slug normalization across these callsites is inconsistent (some strip
non-alphanumerics, some only lowercase). For single-word last-name
speakers in `mention_events.speaker` this produces identical filenames
either way (`Powell` → `powell` under both rules). Multi-word speakers
would diverge; flag if a multi-word speaker ever lands in
`mention_events.speaker`.
