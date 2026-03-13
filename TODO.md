# HYPERFLEX — Active Todo List

> Updated each session. Claude reads this at session start alongside CLAUDE.md and HYPERFLEX_Brief.md.
> Claude must determine what's done from git history — do not ask Marc.

---

## 🔴 Immediate

- [ ] **Stripe env vars** — Marc needs to add to Railway: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `STRIPE_PLATINUM_PRICE_ID`
- [ ] **Admin env var** — Marc needs to add `ADMIN_SECRET` to Railway
- [ ] **package-lock.json** — needs `npm install` run locally to add stripe, then commit+push (Railway deploy failing without it)

---

## 🟡 Up Next

- [ ] **Landing page video** — Video section built, just needs real YouTube VIDEO_ID inserted in `public/index.html`
- [ ] **Custom domain** — Premium tier promises it, not implemented in server
- [ ] **AI scanner improvements** — auto-scan creator's YouTube channel on schedule

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
