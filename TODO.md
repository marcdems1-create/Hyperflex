# HYPERFLEX — Active Todo List

> Updated each session. Claude reads this at session start alongside CLAUDE.md and HYPERFLEX_Brief.md.
> Claude must determine what's done from git history — do not ask Marc.

---

## 🔴 Immediate

- [ ] **Stripe payments** — Pro ($29/mo) + Platinum ($99/mo) currently waitlist only. Need checkout flow, webhook to update creator tier in DB, and billing portal link.

---

## 🟡 Up Next

- [ ] **Custom domain** — Platinum tier promises it, not implemented in server
- [ ] **Settlement mapping** — scanner categories (crypto/commodities/macro) don't always map cleanly to commodity price source

---

## 🔵 Backlog

- [ ] **Cleanup** — delete old `index.html` at project root (not served, just clutter)
- [ ] **Twitter email** — Twitter API v2 doesn't return email; would need "confirmed email" access tier. Currently pseudo-email fallback + optional signup field. Good enough.

---

## ✅ Done (from git history)

- [x] Creator platform — signup, login, dashboard, community page, ToS
- [x] YouTube scanner — comments, transcript, live chat modes
- [x] AI scanner expanded — Paste mode for Twitch, Reddit, Discord, etc. (`b3a92e4`)
- [x] AI question suggestions in Create Market modal — category-aware (`b3a92e4`)
- [x] AI market generation, validation, resolution suggestions
- [x] Flex Points rewards system
- [x] Market editing + archive
- [x] Real price settlement via CoinGecko + metals API
- [x] Leaderboard — All Time / Monthly / Weekly tabs wired to API (`d9fc0ae`)
- [x] Creator dashboard redesign — Linear/Vercel aesthetic
- [x] Pro/Platinum waitlist + upgrade modal
- [x] Community watermark
- [x] Landing page rewrite — creator B2B SaaS (`febf3c5`)
- [x] Pricing fix — removed "Built with HYPERFLEX subtle footer" from Pro (`d9fc0ae`)
- [x] Debug logs stripped from production (`d9fc0ae`)
- [x] SSR OG meta tags for community pages — og:title, og:description, og:image per slug (`7b1c397`)
- [x] Creator onboarding checklist — 3-step empty state for new creators (`5a8d48e`)
- [x] OAuth (Google + X) — Google fully working, X working (name/username, no email by design) (`184fb8e`)
- [x] CLAUDE.md + TODO.md — persistent session memory
