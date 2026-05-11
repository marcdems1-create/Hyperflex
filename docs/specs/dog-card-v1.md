# Dog Card v1 — Spec

**Status:** v1 shipped 2026-05-12
**Locks:** Decision #2 in SESSION_STATE.md 2026-05-10 entry, follows from Decision #1 Option C (WHALE / FLEX semantic split).

## What it is

A "dog card" surfaces a Polymarket market where one side is steeply priced down (the **dog side**, ≤ 30¢) AND at least one sharp or whale has taken that side. Two parallel lineups expose smart-money disagreement with the consensus: *"the public says NO, but here's who's on YES with real money."*

## Surfaces

| Surface | Density | Rationale |
|---|---|---|
| `/feed` (showcase section) | Top 5 | Highest-visibility daily-driver. Mixed in with takes. |
| `/dogs` (dedicated page) | Top 20 | Standalone grid for the audience that wants the full list. Backlinked from `/feed` + `/alpha-live`. |

## Card body

- Market question + slug → `/market/:slug`
- Dog side highlighted prominently (e.g. `YES @ 18¢`), favorite side muted
- 24h volume + edge_score (when available from screener cache)
- Two parallel lineups, distinct labels, distinct visual treatment:
  - **SHARPS ON THIS SIDE** — top 3 users with takes on the dog side
    - Source: `users.flex_score`
    - Filter: `flex_qualifies = true` (must have cleared the 5-settled threshold)
    - Sort: `flex_score DESC`
    - Each entry: avatar, display name, Flex tier badge, `flex_score`
  - **WHALES ON THIS SIDE** — top 3 users with takes on the dog side
    - Source: `users.flex_score_90d`
    - Filter: none beyond having a take + a non-null score
    - Sort: `flex_score_90d DESC` (tie-break `whale_pnl DESC`)
    - Each entry: avatar, display name, whale rank (if any), `flex_score_90d`

## Empty-state discipline

**A card does not render** unless at least one lineup has ≥ 1 entry. Voice charter §10: no playful surfaces on empty data. A "dog" with no smart money on it is just a market the public ignored — that's not a card, that's noise.

When **the entire dog cards list is empty** (no markets meet criteria today):
- `/feed` showcase section: hidden entirely
- `/dogs` page: honest empty state — "No contrarian plays from sharps or whales today. Check back after the next screener refresh." Plus a backlink to `/alpha-live` for users who want regular edge cards.

## Dog criterion

A market qualifies as a dog card candidate if:

1. **Dog side ≤ 30¢** — strict contrarian threshold. Filters to genuinely steep underdogs where smart-money disagreement is interesting signal. (`yes_price ≤ 0.30` OR `yes_price ≥ 0.70` — whichever side is sub-30¢ becomes the dog.)
2. **Market is active** — `closed = false`, has live CLOB price via `upgradeToClobPrices()`.
3. **At least one user has a take on the dog side** — checked via the `takes` table.

The card renders if ≥1 of (sharps, whales) is non-empty post-filtering.

## Card ranking (for top-N selection)

Cards are ranked by a composite signal that combines lineup quality + market liquidity. The exact formula:

```
rank_score = max_sharp_flex_score * 1.5
           + sharp_count * 10
           + max_whale_score * 1.0
           + whale_count * 5
           + (edge_score * 0.5)            // from screener cache, if available
```

This biases toward markets where a *high-quality* sharp + multiple whales are aligned, even over markets with many low-flex sharps. Edge score (from `_screenerCache`) is a tie-breaker, not a primary signal — a dog card is a take-side signal, not an alpha-edge signal.

## API

```
GET /api/dog-cards?limit=N         (default 20, max 50)
```

Response:
```json
{
  "cards": [
    {
      "market_slug": "...",
      "condition_id": "0x...",
      "question": "Will X happen by Y?",
      "yes_price": 0.18,
      "no_price":  0.82,
      "dog_side": "YES",
      "dog_price": 0.18,
      "fav_side": "NO",
      "fav_price": 0.82,
      "volume_24h": 124000,
      "edge_score": 67,
      "rank_score": 152.5,
      "sharps": [
        { "user_id": "...", "display_name": "...", "username": "...", "flex_score": 78, "flex_tier": "Sharp" }
      ],
      "whales": [
        { "user_id": "...", "display_name": "...", "username": "...", "whale_score": 88, "whale_rank": 12, "whale_pnl": 245000 }
      ]
    }
  ],
  "generated_at": "ISO-8601",
  "ttl_seconds": 180
}
```

## Caching

`_dogCardsCache` in `server.js`, 3-minute TTL. Refresh is on-demand (next GET after expiry) — no cron. Cheap to rebuild because it reuses `_screenerCache` for live prices.

## Out of scope (v1)

- **Notifications.** No "a sharp just took the dog side on X" push. Surface-only.
- **Filtering / categories.** No category chips on /dogs in v1 — single feed of all dog cards.
- **Time-based sorting.** "Recent takes" sort comes in v2 once we see usage.
- **Profile integration.** No "your dog cards" personalised view. Generic for everyone.
- **Take-creation flow.** Dog cards link to `/market/:slug` for trading; they don't have a "post your take" CTA inline. Take cards stay the primary creation surface.
- **Settlement scoring.** Dog cards don't update post-resolution with "the dog won/lost." Out of scope until v2; track-record lives on profile pages.

## Voice charter compliance

- No exclamation points. No emoji (functional `●` for live status is the only exception).
- Dry register. "YES @ 18¢" — the price IS the editorial. No "Bold call!", no "Hot dog play."
- Side label is the price + cent suffix. No "dog" in user-facing copy unless we're naming the surface explicitly.
- Empty state is honest. No "Building..." or "Coming soon." Either it's a card or it's silent.
