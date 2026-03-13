# HYPERFLEX — Active Todo List

> Updated each session. Claude reads this at session start alongside CLAUDE.md and HYPERFLEX_Brief.md.
> Claude must determine what's done from git history — do not ask Marc.

---

## 🔴 Immediate

- [ ] **Stripe env vars** — Marc needs to add to Railway: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `STRIPE_PLATINUM_PRICE_ID`
- [ ] **Admin env var** — Marc needs to add `ADMIN_SECRET` to Railway

---

## 🟡 Up Next

- [ ] **PUSH** — `git push origin main` to deploy commits `c5509cd` through `8c20977`
- [ ] **Run 2 new migrations** in Supabase SQL editor: `supabase_migration_custom_domains.sql` + `supabase_migration_challenges.sql`
- [ ] **Landing page video** — Video section built, just needs real YouTube VIDEO_ID inserted in `public/index.html`
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
- [x] Flex Points gamification — streak multipliers (3→1.5×, 5+→2×), streak badges, Power Predictor, Inner Circle callouts (`43c70fd`, `ca699e2`)
- [x] Scanner redesign — YouTube/Twitch/Paste modes, removed "Claude" branding (`b8121aa`)
- [x] Per-community points economy — community_balances table, min/max bet, economy settings UI, centpoints throughout (`c55f856`)
- [x] Analytics dashboard — trade activity chart, top markets, market breakdown, economy health, referrals (Pro/Premium gated) (`a564fa3`)
- [x] Economy tab — dedicated sidebar tab for all economy settings (`a564fa3`)
- [x] Supabase migrations — all 4 run and deployed (community_economy, refill_history, cpmm, referrals)
- [x] Custom domain routing (CNAME + DNS verify, Premium only) (`c5509cd`)
- [x] Pro referral analytics access + preset cards + milestone preview (`8e18b29`, `d2d2721`)
- [x] Market ideas speed boost — merged DB queries, trimmed prompt, skeleton loading fix (`97f90a1`, `b5dae24`)
- [x] Bulk market creation from idea cards (`099b162`)
- [x] Stat card overflow fix — abbreviation + auto font-size (`1bb8bb5`)
- [x] Community challenges + shareable win cards (`053c860`)
- [x] Leaderboard: weekly tab, win rate %, accuracy tier badges 🎯📊🎲 (`4c41d54`)
- [x] UX fixes: archived markets hidden from overview, 🎁 Reward member modal + endpoint, milestone 🏆 toasts (`b5dae24`)
- [x] Tab review additions: ↻ Duplicate market, 📱 QR code, community URL bar, leaderboard member count, reward on PP/IC rows, win rate in community header (`dc742bf`)
- [x] Mobile UX round 1 — leaderboard pill, creator login bar, carousel tap fix, watermark overlap, archived markets, milestone toasts (`7db546e`)
- [x] Reward presets + member claim button (`258804e`)
- [x] Mobile UX round 2 — plan pill onclick, AI Scanner icon in topbar, Dupe→Duplicate, analytics overflow (`8c20977`)
