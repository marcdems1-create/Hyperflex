# HYPERFLEX — Active Todo List

> Updated each session. Claude reads this at session start alongside CLAUDE.md and HYPERFLEX_Brief.md.
> Claude must determine what's done from git history — do not ask Marc.

---

## 🔴 Immediate

- [ ] **OAuth (Google + X)** — code is deployed but not functional yet. Needs: Google OAuth credentials in Railway env, Twitter/X credentials in Railway env, Supabase providers enabled in dashboard, redirect URIs whitelisted. Handle as dedicated session.

---

## 🟡 Up Next

- [ ] **Community meta tags** — og:image, og:title per community slug for social sharing (big for growth)
- [ ] **Creator onboarding** — empty state UX for brand-new creators with 0 markets
- [ ] **Stripe payments** — Pro/Platinum currently on waitlist only, no actual billing
- [ ] **Custom domain** — Platinum tier promises it, not implemented in server

---

## 🔵 Backlog

- [ ] **Settlement mapping** — scanner categories (crypto/commodities/macro) don't always map cleanly to commodity price source
- [ ] **Cleanup** — delete old `index.html` at project root (not served, just clutter)

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
- [x] CLAUDE.md + TODO.md — persistent session memory
- [x] OAuth routes added (Google + X) — needs env config to go live (`809abdf`)
