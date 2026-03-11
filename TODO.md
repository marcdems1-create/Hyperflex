# HYPERFLEX — Active Todo List

> Updated each session. Claude reads this at session start alongside CLAUDE.md and HYPERFLEX_Brief.md.
> Claude must determine what's done from git history — do not ask Marc.

---

## 🔴 Immediate

- [ ] **Push to Railway** — `git push origin main` (commit `b3a92e4` pending: AI question suggestions + multi-platform scanner)

---

## 🟡 Up Next

- [ ] **Landing page** — review live after deploy, iterate on copy/design
- [ ] **Leaderboard** — weekly/monthly tabs exist in UI but not wired to API (only all-time works)
- [ ] **Scanner markets** — `yes_price` / `no_price` not set on AI-generated markets, defaults needed
- [ ] **Debug logs** — `[scanAndCreateMarkets]` and `[markets fetch]` logs still noisy in production

---

## 🔵 Backlog

- [ ] **Stripe payments** — Pro/Platinum currently on waitlist only, no actual billing
- [ ] **Custom domain** — Platinum tier promises it, not implemented in server
- [ ] **Community meta tags** — og:image, og:title per community slug for social sharing
- [ ] **Creator onboarding** — empty state UX for brand-new creators with 0 markets
- [ ] **Settlement mapping** — scanner categories (crypto/commodities/macro) don't always map cleanly to a commodity price source
- [ ] **Cleanup** — delete old `index.html` at project root (not served, just clutter)

---

## ✅ Done (from git history)

- [x] Creator platform — signup, login, dashboard, community page, ToS (`0ec7450` → `b2728a2`)
- [x] YouTube scanner — comments mode (`938f82a`), transcript mode (`e70a3f2`), live chat mode (`ad2f43d`)
- [x] AI market generation via Claude (`938f82a`)
- [x] AI question validation on blur (`211d1bf`)
- [x] AI resolution suggestions (`7ff0041`)
- [x] Flex Points rewards system (`7cf68bf`)
- [x] Market editing + archive (`5b70859`)
- [x] Real price settlement via CoinGecko + metals API (`43b7548`)
- [x] Leaderboard with PnL rankings (`0218a48`)
- [x] Creator dashboard redesign — Linear/Vercel aesthetic (`cb9f958`)
- [x] Pro/Platinum waitlist + upgrade modal (`c047ede`)
- [x] Platinum tier + 3-column pricing modal (`f34ae8e`)
- [x] Community watermark redesign (`f34ae8e`)
- [x] Landing page rewrite — creator B2B SaaS (`febf3c5`)
- [x] CLAUDE.md + TODO.md — persistent session memory (`545b884`, `3184172`)
