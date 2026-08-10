# "Smart Money On Your Book" — Comparison Against Bullpen's Whales

**Status:** research only, for Marc's decision. No schema changes, no new endpoints, no frontend work in this doc or its branch.
**Scope of the feature being scoped:** Phase 1 expanded state, SHARP tier only, of the smart-money-on-your-book wallet list. Still gated on the wallet-position-schema endpoint merge + live curl (branch `9d7341d`) before any Phase 1 build starts, per SESSION_STATE.md 2026-08-05c.

**Sourcing caveat, stated plainly:** this session's sandbox cannot reach `bullpen.fi` / `docs.bullpen.fi` / `cli.bullpen.fi` directly — WebFetch to all three returned `EGRESS_BLOCKED`. Everything below comes from search-engine result snippets referencing Bullpen's own blog/docs and third-party writeups (Medium, PANews/Odaily/MEXC "7 tools" roundups), not a first-hand product walkthrough or screenshots. Treat the framing conclusions as directionally reliable, not pixel-verified — same discipline this repo already applies to every other unverified number. If this feature moves toward an actual build, a real walkthrough (Marc has an account or can get one) should confirm before we copy any specific pattern.

---

## 1. Inflow direction (buying vs. selling) vs. our side/size/CLV-grade model

**Bullpen's framing is direction-and-convergence first, grade-of-trader second.** The unit of the feed is the *event* — a wallet (or cluster of wallets) took a side, right now — not the wallet's standing record. Recurring pattern across sources:

- "3 sharp traders just bought $113K of Yes on this market" — the headline is the aggregate flow (side + dollar size + count of wallets), not any individual wallet's CLV or lifetime grade.
- "Each market card directly displays the direction and whale purchase amount" — direction (buy/sell, which side) is a first-class rendered field, not something you click into a wallet to find.
- Convergence is the marquee signal: multiple smart-money wallets landing on the *same side* of the *same market* is treated as the strongest form of the alert, stronger than any single large trade.
- Per-wallet quality (win rate, lifetime P/L, hold time) exists but lives one layer down, in "WalletScope" — a wallet deep-dive you navigate to, not the primary list view.

**Our planned model inverts that emphasis: wallet-grade first, individual trade second.** The wallet list is scoped to SHARP-tier wallets specifically — i.e., we've already filtered to "wallets whose grade we trust" before showing any position. Side and size are attributes of a row in a graded wallet's list, not the organizing principle of the whole surface. This is consistent with the product's core rule (CLAUDE.md: "a win never appears naked" / score+n always travel with a trade) — we're not going to show a raw $-weighted buy/sell flow untethered from who made it, the way Bullpen's top-level feed does.

**Practical implication for scoping, not a decision:** if Marc wants a Bullpen-style "aggregate flow" glance (e.g. "$340K net BUY across SHARP wallets on this market") as a *summary row above* the graded wallet list, that's additive and doesn't conflict with the CLV-grade-first model — it would sit above the collapsed strip, not replace the wallet-level rows. Flagging as an option, not proposing to build it.

---

## 2. Real-time streaming vs. snapshot-on-load

**Bullpen's language is unambiguously live-streaming**, not periodic refresh:

- "Real-time alerts fire the moment whale activity hits, and you get notified before the crowd piles in"
- "Live chronological feed of the biggest, highest-win-rate trades happening right now"
- "Smart Money feed shows aggregated signals in real time"
- Indexes 12,000+ wallets with continuous position tracking (implied by "tracks their performance in real-time")

The whole value proposition is speed — being notified *as* a whale moves, not after. That's a fundamentally different infra commitment than what we've scoped: it implies either a push/webhook pipeline off on-chain events or continuous polling with a short interval, plus a client-side live-update mechanism (websocket/SSE), sustained per-user.

**We are explicitly snapshot-on-login for Phase 1 of this feature**, per the task framing, and that's consistent with how the rest of the platform already handles wallet data — `syncAllUserPositions()` runs hourly, `/connect` ingestion timing is measured in the 8.5–14.7s "progressive load" band (not sub-second streaming), and nothing else in the codebase currently holds an open per-user stream for position data. Matching Bullpen's real-time framing would be a materially larger infra lift (continuous ingestion + push delivery), not a copy-paste of the pattern — and nothing in the current scope calls for it. **Recommend not chasing real-time parity in Phase 1**; if "came in while you were away" freshness ever becomes a retention lever worth building (it fits the NORTH STAR loyalty-hook logic — "something new since last visit, surfaced the moment they open the app" — as a *notification on return*, not a live stream), that's a distinct, later scoping question, not implied by matching Bullpen's UI.

---

## 3. UI patterns worth stealing, given the collapsed strip is locked $-weighted split

The collapsed strip (already locked) shows a $-weighted buy/sell split at a glance. The open question is what the *expanded* wallet list looks like once a SHARP-tier user drills in. From what's visible in Bullpen's pattern:

**Worth taking:**
- **Direction as a rendered field per row, not an inferred color only.** Bullpen puts the side and dollar amount directly on the card text ("bought $113K of Yes"), not just as a green/red bar. For a graded wallet list, each row should say the side and size in words as well as color — helps at a glance and doesn't rely purely on color perception.
- **Convergence as a distinguishable grouping, not just a longer list.** When multiple SHARP wallets are on the same side of the same market, that's worth visually clustering (e.g., grouped under the market, not just N separate rows scattered by recency) rather than treating it as coincidence buried in a chronological feed. This maps cleanly onto our existing multi-whale-consensus detection pattern already in the codebase (`consensusMap` in the whale-cluster signal logic) — we already compute this concept elsewhere, so surfacing it in the wallet list is reusing existing machinery, not inventing new grouping logic.
- **Size concentration as a visual-weight signal**, not just a sort key. Bullpen "highlights size concentration... instantly" — i.e., a $500K position should visually read as heavier than a $2K one at a glance (size, weight, or emphasis), not just be sorted above it in a plain list.

**Worth explicitly NOT taking:**
- **Chronological-feed-as-primary-sort.** Bullpen's whale feed is time-ordered (most recent first) because its whole premise is "catch it as it happens." Our snapshot-on-login model has no "as it happens" moment to anchor a chronological feed to — sorting our SHARP wallet list by CLV grade (or $-size, consistent with the locked collapsed-strip logic) makes more sense than recency, since we're not claiming freshness we don't have.
- **Wallet-quality-as-a-drill-down.** Given SHARP tier is already the *filter* for who appears on our list at all, burying grade behind a second click (Bullpen's WalletScope pattern) would be redundant — the grade is why the wallet is there, so it should be visible at the row, not one tap deeper.

---

## Bottom line

Bullpen and our planned feature are solving adjacent but distinct problems: Bullpen answers "what's moving right now, and who's behind it," we answer "here's who's proven right, and what they currently hold." The size/color/grouping-weight patterns are reusable regardless of that difference. The direction-first framing and the real-time cadence are not things to copy wholesale — they'd fight the CLV-grade-first, snapshot-on-login model we've already locked.

No changes made to schema, endpoints, or frontend. This is unblocking Marc's decision on the expanded-state design, not implementation — implementation stays gated on the wallet-position-schema live curl per SESSION_STATE.md 2026-08-05c.
