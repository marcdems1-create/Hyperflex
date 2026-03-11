# HYPERFLEX — Active Todo List

> Updated each session. This is the source of truth for what needs doing.
> Claude reads this at session start alongside CLAUDE.md and HYPERFLEX_Brief.md.

---

## 🔴 In Progress / Immediate

- [ ] Push new landing page to Railway (`git push origin main`) — **Marc does this from terminal**

---

## 🟡 Up Next

- [ ] Landing page — review live version after deploy, iterate on copy/design
- [ ] Leaderboard — wire weekly/monthly tabs to API (currently only all-time works)
- [ ] Scanner markets — ensure `yes_price` / `no_price` are set on creation (default to 50/50 if missing)
- [ ] Remove or gate debug logs in production (noisy console output)

---

## 🔵 Backlog

- [ ] Custom domain support for Platinum tier (promised in pricing but not implemented)
- [ ] Pro/Platinum — move off waitlist, wire up actual Stripe payments
- [ ] Delete old `index.html` at project root (not served, just clutter)
- [ ] Settlement — improve commodity mapping for scanner-generated markets
- [ ] Community page — add social sharing meta tags (og:image, og:title per community)
- [ ] Creator dashboard — onboarding flow for brand-new creators (empty state)

---

## ✅ Recently Done

- [x] Rewrite `public/index.html` as creator B2B SaaS landing page (commit `febf3c5`)
- [x] Add Platinum tier to pricing modal in creator dashboard (commit `f34ae8e`)
- [x] Redesign community watermark — HYPERFLEX logo + CTA pill (commit `f34ae8e`)
- [x] Creator dashboard redesign — Linear/Vercel-style SaaS aesthetic (commit `cb9f958`)
- [x] YouTube scanner — comments + transcript + live chat modes
- [x] AI market generation, AI resolution suggestions, AI question validation
- [x] Flex Points rewards system
- [x] Pro/Platinum waitlist capture
- [x] Add `CLAUDE.md` for session memory (commit `545b884`)
