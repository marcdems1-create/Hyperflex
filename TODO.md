# HYPERFLEX — Active Todo List

> Updated each session. Claude reads this at session start alongside CLAUDE.md and HYPERFLEX_Brief.md.
> Claude must determine what's done from git history — do not ask Marc.

---

## 🔴 Immediate

- [ ] **⚠️ SUPABASE MIGRATION** — Run `supabase_migration_community_economy.sql` in Supabase Dashboard → SQL Editor BEFORE deploying `c55f856`
- [ ] **Stripe env vars** — Marc needs to add to Railway: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `STRIPE_PLATINUM_PRICE_ID`
- [ ] **Admin env var** — Marc needs to add `ADMIN_SECRET` to Railway

---

## 🟡 Up Next

- [ ] **Landing page video** — Video section built, just needs real YouTube VIDEO_ID inserted in `public/index.html`
- [ ] **Custom domain** — Premium tier promises it, not implemented in server
- [ ] **AI scanner improvements** — auto-scan creator's YouTube channel on schedule
- [ ] **Economy Phase 2**: Activity-gated weekly refills, user referral system (100 pts/referral, 50 welcome bonus, capped 5/week, creator-configurable), dynamic odds (CPMM)
- [ ] **FAQ section** — explain how Flex Points work (pending Economy Phase 2 finalization)

---

## 🔵 Backlog

- [ ] **Settlement mapping** — scanner categories don't always map cleanly to price source
- [ ] **Cleanup** — delete old `index.html` at project root (not served, just clutter)

---

## ✅ Done (from git history)

- [x] Creator platform — signup, login, dashboard, community page, ToS
- [x] YouTube scanner — comments, transcript, live chat modes
- [x] AI scanner expanded — Paste mode for Twitch, Reddit, Discord, etc.
- [x] AI question suggestions in Create Market modal — category-aware (fixed localStorage key bug `b0b62d8`)
- [x] AI market generation, validation, resolution suggestions
- [x] Flex Points rewards system
- [x] Market editing + archive
- [x] Real price settlement via CoinGecko + metals API
- [x] Leaderboard — All Time / Monthly / Weekly tabs wired to API
- [x] Creator dashboard redesign — Linear/Vercel aesthetic
- [x] SSR OG meta tags for community pages
- [x] Creator onboarding checklist — 3-step empty state
- [x] OAuth (Google + X) — Google fully working, X working (name/username, no email by design)
- [x] Stripe payments — Pro ($29/mo) + Premium ($99/mo) checkout, webhook, billing portal (`17849c1`)
- [x] Admin dashboard at `/admin` — password-gated, creator table, inline plan control (`4d8db02`)
- [x] Premium rebrand — Platinum renamed to Premium in all UI, DB value stays 'platinum' (`a9cb97e`)
- [x] Premium UI — elevated dashboard styling, plan pill in sidebar, body CSS classes (`a9cb97e`)
- [x] Watermark — hidden for Premium only, shown for Free + Pro (`6352f15`)
- [x] Video section added to landing page — needs VIDEO_ID (`a9cb97e`)
- [x] Landing page rewrite — creator B2B SaaS
- [x] Pricing fix — removed "Built with HYPERFLEX" from Pro
- [x] CLAUDE.md + TODO.md — persistent session memory
- [x] Flex Points gamification — streak multipliers (3→1.5×, 5+→2×), streak badges, Power Predictor, Inner Circle callouts (`43c70fd`, `ca699e2`)
- [x] Scanner redesign — YouTube/Twitch/Paste modes, removed "Claude" branding (`b8121aa`)
- [x] Per-community points economy — community_balances table, min/max bet, economy settings UI, centpoints throughout (`c55f856`)
