# Claude Code: Signals Page — Deduplication + Narrative Diversity

Two fixes in `server.js` (signal generation) and `public/signals.html` (display).

## The Problem

The signals feed shows "US x Iran ceasefire by March 31", "...by April 15", "...by April 30"
as three separate WHALE CLUSTER signals. They're the same event — just different expiry dates.
This happens because:
1. Polymarket creates one market per deadline for the same underlying event
2. The same whales hedge across all dates, so each passes the whale threshold
3. No deduplication or per-narrative cap exists

---

## FIX 1: Base-question deduplication in `server.js`

Find the function that builds signal results (likely `getSignals()` or the `/api/signals` handler).
After collecting all raw signals but **before** returning them, add a dedup pass.

### 1A. Strip date noise from questions to find duplicates

```js
function baseQuestion(question) {
  // Remove trailing date phrases like "by March 31", "by April 15?", "before Q2 2026", etc.
  return question
    .replace(/\s+by\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}(\?)?$/i, '')
    .replace(/\s+by\s+\w+\s+\d{4}(\?)?$/i, '')
    .replace(/\s+before\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}(\?)?$/i, '')
    .replace(/\s+in\s+(q[1-4]|q[1-4]\s+\d{4}|\d{4})(\?)?$/i, '')
    .replace(/\s+(by|before|in|through|until)\s+\d{4}(\?)?$/i, '')
    .replace(/\?$/, '')
    .trim()
    .toLowerCase();
}
```

### 1B. Deduplicate signals by base question — keep the best one per group

Add this dedup function and call it on your raw signals array:

```js
function deduplicateSignals(signals) {
  const seen = new Map(); // baseQ -> best signal so far

  for (const signal of signals) {
    const base = baseQuestion(signal.question || signal.market?.question || '');
    const existing = seen.get(base);

    if (!existing) {
      // First time seeing this base question
      seen.set(base, { ...signal, _altCount: 0, _altMarkets: [] });
    } else {
      // Already have one — keep whichever has more whales (or higher score)
      const existingScore = (existing.whaleCount || existing.whale_count || 0) * 10
        + (existing.score || 0);
      const newScore = (signal.whaleCount || signal.whale_count || 0) * 10
        + (signal.score || 0);

      if (newScore > existingScore) {
        // New one is better — replace, but carry over the alt count
        const altMarkets = existing._altMarkets.concat([{
          question: existing.question || existing.market?.question,
          expiry: existing.endDate || existing.market?.endDate
        }]);
        seen.set(base, {
          ...signal,
          _altCount: existing._altCount + 1,
          _altMarkets: altMarkets
        });
      } else {
        // Keep existing — just increment alt count
        existing._altCount += 1;
        existing._altMarkets.push({
          question: signal.question || signal.market?.question,
          expiry: signal.endDate || signal.market?.endDate
        });
      }
    }
  }

  return Array.from(seen.values());
}
```

### 1C. Call dedup in the signals handler

Find where signals are assembled and add the dedup call:

```js
// After building `signals` array, before sorting/returning:
const deduped = deduplicateSignals(signals);
// Return deduped instead of signals
```

Also expose `_altCount` in the API response (it's used in the frontend to show "2 more" note).

---

## FIX 2: Per-narrative cap — max 2 signals per narrative

After deduplication, apply a narrative diversity cap:

```js
function applyNarrativeCap(signals, maxPerNarrative = 2) {
  // Reuse the same keyword map from screener narratives
  const NARRATIVE_KEYWORDS = {
    'Trump & US Politics':   ['trump','president','democrat','republican','congress','senate','maga','white house','tariff','executive order'],
    'Crypto & DeFi':         ['bitcoin','btc','ethereum','eth','crypto','solana','sol','defi','nft','coinbase','stablecoin'],
    'Middle East & War':     ['israel','iran','gaza','hamas','hezbollah','ceasefire','hormuz','middle east','lebanon'],
    'AI & Big Tech':         ['ai','openai','gpt','artificial intelligence','nvidia','apple','microsoft','google','meta'],
    'Macro & Economy':       ['fed','federal reserve','interest rate','inflation','recession','gdp','cpi','unemployment','rate cut'],
    'Ukraine & Russia':      ['ukraine','russia','zelensky','putin','nato','kyiv','donbas'],
    'NBA & Basketball':      ['nba','basketball','finals','playoff','lakers','celtics','warriors'],
    'NFL & American Sports': ['nfl','super bowl','mlb','world series','nhl','stanley cup'],
    'Global Elections':      ['election','vote','ballot','candidate','prime minister'],
  };

  function getSignalNarrative(signal) {
    const q = (signal.question || signal.market?.question || '').toLowerCase();
    for (const [narrative, keywords] of Object.entries(NARRATIVE_KEYWORDS)) {
      if (keywords.some(kw => q.includes(kw))) return narrative;
    }
    return 'Other';
  }

  const narrativeCounts = {};
  const result = [];

  for (const signal of signals) {
    const narrative = getSignalNarrative(signal);
    narrativeCounts[narrative] = (narrativeCounts[narrative] || 0) + 1;

    if (narrative === 'Other' || narrativeCounts[narrative] <= maxPerNarrative) {
      result.push({ ...signal, _narrative: narrative });
    }
    // Signals beyond the cap are silently dropped (already deduped, so these are truly different)
  }

  return result;
}
```

### Apply after dedup:

```js
const deduped = deduplicateSignals(signals);
const diversified = applyNarrativeCap(deduped, 2); // max 2 per narrative
// Sort by score descending
diversified.sort((a, b) => (b.score || 0) - (a.score || 0));
// Return diversified
```

---

## FIX 3: Frontend — show "N more like this" note in `public/signals.html`

When a signal was deduped, show a small note under the card so the user knows similar markets exist.

Find the signal card rendering code. After the main card content (whale count, capital, buttons),
add this conditional block:

```js
// In the card render template — after the action buttons:
${signal._altCount > 0 ? `
  <div style="
    margin-top: 8px;
    padding: 6px 10px;
    background: #0e0e0c;
    border: 1px solid #222;
    border-radius: 6px;
    font-family: 'Space Mono', monospace;
    font-size: 10px;
    color: #555;
    display: flex;
    align-items: center;
    gap: 6px;
  ">
    <span style="color:#444">📅</span>
    <span>+${signal._altCount} similar market${signal._altCount > 1 ? 's' : ''} (different deadline)</span>
  </div>
` : ''}
```

---

## FIX 4: Add "narrative diversity" label to the signal type filter

In `signals.html`, the filter pills are: All | Whale Cluster | Momentum | New Entry | Arbitrage.

After deduplification, each signal now has `_narrative` attached. Add a subtle narrative label
on each card (small pill below the signal type badge), so the feed feels categorized:

```js
// In the card header area, after the signal type badge:
${signal._narrative && signal._narrative !== 'Other' ? `
  <span style="
    font-family: 'Space Mono', monospace;
    font-size: 9px;
    padding: 1px 6px;
    border-radius: 3px;
    background: #1a1a18;
    color: #555;
    border: 1px solid #222;
    letter-spacing: .04em;
    text-transform: uppercase;
  ">${signal._narrative}</span>
` : ''}
```

---

## Expected Result

**Before:** 5 signals, all Iran ceasefire with different dates
**After:** 2 signals max from "Middle East & War" narrative, each deduplicated to the strongest
version, with a small "📅 +2 similar markets (different deadline)" note on the shown card.

The feed will now show a mix like:
- 🐋 WHALE CLUSTER — US x Iran ceasefire by April 30 (+2 similar) · Middle East & War
- 🐋 WHALE CLUSTER — Will BTC hit $90K by March 31? · Crypto & DeFi
- ⚡ MOMENTUM — Will the Fed cut in May? · Macro & Economy
- 🆕 NEW ENTRY — NBA Finals: Will the Celtics repeat? · NBA & Basketball
- 📊 ARBITRAGE — Ethereum above $2,400 · Crypto & DeFi

---

## Commit

```bash
git add server.js public/signals.html
git commit -m "fix: signals dedup by base question + 2-per-narrative cap to prevent feed flooding"
git push origin main
```
