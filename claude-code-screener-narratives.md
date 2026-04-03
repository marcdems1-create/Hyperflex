# Claude Code: Screener — Narrative Intelligence Layer

Add a "Narrative Intelligence" section at the top of `public/screener.html` + a new `GET /api/screener/narratives` endpoint in `server.js`.

The feature answers: **"What themes are dominating prediction markets right now, and is that changing?"**

---

## What It Does

- Groups all active Polymarket markets into 8–12 narrative themes using keyword matching
- For each narrative: shows **dominance %** (share of total market volume), **weekly change** (+/- ppts), market count
- Clicking a narrative filters the screener table below to show only those markets
- Snapshots stored weekly in Supabase to power the 7d delta

---

## 1. Backend — `server.js`

### 1A. Narrative keyword map (add near top of file, with other constants)

```js
const NARRATIVE_KEYWORDS = {
  'Trump & US Politics':    ['trump', 'president', 'democrat', 'republican', 'congress', 'senate', 'maga', 'white house', 'tariff', 'executive order'],
  'Crypto & DeFi':          ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'solana', 'sol', 'defi', 'nft', 'coinbase', 'stablecoin', 'altcoin'],
  'Middle East & War':      ['israel', 'iran', 'gaza', 'hamas', 'hezbollah', 'ceasefire', 'hormuz', 'middle east', 'lebanon'],
  'AI & Big Tech':          ['ai', 'openai', 'gpt', 'artificial intelligence', 'nvidia', 'apple', 'microsoft', 'google', 'meta', 'anthropic'],
  'Macro & Economy':        ['fed', 'federal reserve', 'interest rate', 'inflation', 'recession', 'gdp', 'cpi', 'unemployment', 'rate cut', 'yield'],
  'Ukraine & Russia':       ['ukraine', 'russia', 'zelensky', 'putin', 'nato', 'kyiv', 'donbas', 'ceasefire ukraine'],
  'NBA & Basketball':       ['nba', 'basketball', 'finals', 'playoff', 'lakers', 'celtics', 'warriors', 'nuggets'],
  'NFL & American Sports':  ['nfl', 'super bowl', 'mlb', 'world series', 'nhl', 'stanley cup', 'ncaa'],
  'Global Elections':       ['election', 'vote', 'ballot', 'candidate', 'prime minister', 'chancellor', 'parliament'],
  'Other':                  [] // catch-all
};

function classifyMarketNarrative(question) {
  const q = question.toLowerCase();
  for (const [narrative, keywords] of Object.entries(NARRATIVE_KEYWORDS)) {
    if (narrative === 'Other') continue;
    if (keywords.some(kw => q.includes(kw))) return narrative;
  }
  return 'Other';
}
```

### 1B. Narrative snapshot table helper (add near other Supabase helpers)

```js
async function snapshotNarratives(narrativeData) {
  // Store daily snapshots for weekly delta calculation
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const rows = narrativeData.map(n => ({
    narrative: n.narrative,
    snapshot_date: today,
    dominance_pct: n.dominance_pct,
    market_count: n.market_count,
    total_volume: n.total_volume
  }));
  // Upsert — one row per narrative per day
  await supabase.from('narrative_snapshots')
    .upsert(rows, { onConflict: 'narrative,snapshot_date' });
}

async function getNarrativeWeeklyDeltas() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { data } = await supabase.from('narrative_snapshots')
    .select('narrative, dominance_pct, snapshot_date')
    .eq('snapshot_date', weekAgo);
  const map = {};
  (data || []).forEach(r => { map[r.narrative] = r.dominance_pct; });
  return map;
}
```

### 1C. New API endpoint (add with other screener/signal routes)

```js
// Narrative intelligence — groups markets into themes with dominance %
const _narrativeCache = { data: null, ts: 0 };
app.get('/api/screener/narratives', async (req, res) => {
  try {
    // 15-min cache
    if (_narrativeCache.data && Date.now() - _narrativeCache.ts < 15 * 60 * 1000) {
      return res.json(_narrativeCache.data);
    }

    // Fetch active markets (reuse existing Polymarket cache if available)
    // Adjust the fetch URL to match what your screener currently uses
    const pmRes = await fetch(
      'https://clob.polymarket.com/markets?active=true&closed=false&limit=500',
      { headers: { 'User-Agent': 'hyperflex.network' } }
    );
    const pmData = await pmRes.json();
    const markets = (pmData.data || pmData || []).filter(m =>
      m.volume && parseFloat(m.volume) > 1000
    );

    if (!markets.length) return res.json([]);

    // Group by narrative
    const groups = {};
    let totalVolume = 0;
    for (const m of markets) {
      const narrative = classifyMarketNarrative(m.question || '');
      if (!groups[narrative]) groups[narrative] = { markets: [], volume: 0 };
      const vol = parseFloat(m.volume) || 0;
      groups[narrative].markets.push(m);
      groups[narrative].volume += vol;
      totalVolume += vol;
    }

    // Get weekly deltas from Supabase
    const weeklyDeltas = await getNarrativeWeeklyDeltas();

    // Build result array
    const result = Object.entries(groups)
      .map(([narrative, g]) => {
        const dominance_pct = totalVolume > 0
          ? Math.round((g.volume / totalVolume) * 1000) / 10  // 1 decimal
          : 0;
        const prior = weeklyDeltas[narrative];
        const weekly_change = prior != null
          ? Math.round((dominance_pct - prior) * 10) / 10
          : null;

        // Top market by volume
        const top = g.markets.sort((a, b) =>
          (parseFloat(b.volume) || 0) - (parseFloat(a.volume) || 0)
        )[0];

        return {
          narrative,
          dominance_pct,
          weekly_change,        // null if no snapshot yet
          market_count: g.markets.length,
          total_volume: Math.round(g.volume),
          top_market: top ? {
            question: top.question,
            yes_pct: top.outcomePrices
              ? Math.round(parseFloat(JSON.parse(top.outcomePrices)[0]) * 100)
              : null,
            volume: Math.round(parseFloat(top.volume) || 0)
          } : null
        };
      })
      .filter(n => n.narrative !== 'Other' || n.market_count > 5)
      .sort((a, b) => b.dominance_pct - a.dominance_pct);

    // Snapshot for future weekly deltas (fire-and-forget)
    snapshotNarratives(result).catch(() => {});

    _narrativeCache.data = result;
    _narrativeCache.ts = Date.now();
    res.json(result);
  } catch (err) {
    console.error('[narratives]', err.message);
    res.json([]);
  }
});
```

---

## 2. Migration — `supabase_migration_narrative_snapshots.sql`

Create this file and run it in Supabase SQL editor:

```sql
CREATE TABLE IF NOT EXISTS narrative_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  narrative     TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  dominance_pct NUMERIC(5,2),
  market_count  INTEGER,
  total_volume  BIGINT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (narrative, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_narrative_snapshots_date ON narrative_snapshots (snapshot_date);
```

Add as migration **#31** in CLAUDE.md ordered list.

---

## 3. Frontend — `public/screener.html`

### 3A. Add the Narrative Intelligence section

Insert this **above the existing filter pills row** (above the `CATEGORY` / `WHALES` / `VOLUME` filters div):

```html
<!-- NARRATIVE INTELLIGENCE -->
<div id="narrative-section" style="margin: 0 0 32px; max-width: 960px; margin-left: auto; margin-right: auto;">
  <div style="display:flex; align-items:baseline; gap:12px; margin-bottom:14px;">
    <h2 style="font-family:'Syne',sans-serif; font-size:15px; font-weight:700; color:#f0ebe3; letter-spacing:.05em; text-transform:uppercase; margin:0;">
      🧭 Narrative Intelligence
    </h2>
    <span style="font-family:'Space Mono',monospace; font-size:11px; color:#555;">
      what themes dominate prediction markets this week
    </span>
  </div>

  <div id="narrative-grid" style="display:flex; flex-direction:column; gap:6px;">
    <!-- Populated by JS -->
    <div style="color:#555; font-family:'Space Mono',monospace; font-size:12px; padding:12px 0;">Loading narratives…</div>
  </div>
</div>
```

### 3B. Add CSS (inside the `<style>` block)

```css
.narrative-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: #0e0e0c;
  border: 1px solid #1e1e1c;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color .15s, background .15s;
  position: relative;
  overflow: hidden;
}
.narrative-row:hover {
  border-color: #333;
  background: #111110;
}
.narrative-row.active {
  border-color: #c9920d;
  background: #111110;
}
/* Dominance fill bar behind the row */
.narrative-bar-fill {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  background: rgba(201,146,13,0.07);
  border-radius: 8px 0 0 8px;
  pointer-events: none;
  transition: width .4s ease;
}
.narrative-name {
  font-family: 'Syne', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: #f0ebe3;
  min-width: 180px;
  flex-shrink: 0;
}
.narrative-dominance {
  font-family: 'Space Mono', monospace;
  font-size: 14px;
  font-weight: 700;
  color: #c9920d;
  min-width: 52px;
  flex-shrink: 0;
}
.narrative-weekly {
  font-family: 'Space Mono', monospace;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 4px;
  flex-shrink: 0;
  min-width: 54px;
  text-align: center;
}
.narrative-weekly.up   { background: rgba(0,200,100,.12); color: #00c864; }
.narrative-weekly.down { background: rgba(200,50,50,.12);  color: #e05252; }
.narrative-weekly.flat { background: #1a1a18; color: #555; }
.narrative-count {
  font-family: 'Space Mono', monospace;
  font-size: 11px;
  color: #555;
  flex-shrink: 0;
}
.narrative-top-market {
  font-family: 'Space Mono', monospace;
  font-size: 11px;
  color: #666;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
@media (max-width: 600px) {
  .narrative-top-market { display: none; }
  .narrative-name { min-width: 130px; }
}
```

### 3C. Add JS (inside the `<script>` block, near other init functions)

```js
let _activeNarrative = null;
const NARRATIVE_COLORS = {
  'Trump & US Politics':   '#c9920d',
  'Crypto & DeFi':         '#627eea',
  'Middle East & War':     '#e05252',
  'AI & Big Tech':         '#00c8c8',
  'Macro & Economy':       '#a0c878',
  'Ukraine & Russia':      '#e08040',
  'NBA & Basketball':      '#ff6b35',
  'NFL & American Sports': '#4a90e2',
  'Global Elections':      '#c94db4',
  'Other':                 '#555'
};

async function loadNarratives() {
  try {
    const res = await fetch('/api/screener/narratives');
    const narratives = await res.json();
    renderNarratives(narratives);
  } catch (e) {
    document.getElementById('narrative-grid').innerHTML =
      '<div style="color:#555;font-family:Space Mono,monospace;font-size:12px;padding:8px 0;">Unable to load narratives</div>';
  }
}

function renderNarratives(narratives) {
  const grid = document.getElementById('narrative-grid');
  if (!narratives.length) {
    grid.innerHTML = '<div style="color:#555;font-size:12px;font-family:Space Mono,monospace;">No narratives found</div>';
    return;
  }

  const maxDominance = narratives[0].dominance_pct;

  grid.innerHTML = narratives.map(n => {
    const color = NARRATIVE_COLORS[n.narrative] || '#c9920d';
    const barPct = maxDominance > 0 ? (n.dominance_pct / maxDominance) * 100 : 0;

    // Weekly change badge
    let weeklyHtml = '';
    if (n.weekly_change === null) {
      weeklyHtml = `<span class="narrative-weekly flat">new</span>`;
    } else if (n.weekly_change > 0.1) {
      weeklyHtml = `<span class="narrative-weekly up">▲ ${n.weekly_change.toFixed(1)}%</span>`;
    } else if (n.weekly_change < -0.1) {
      weeklyHtml = `<span class="narrative-weekly down">▼ ${Math.abs(n.weekly_change).toFixed(1)}%</span>`;
    } else {
      weeklyHtml = `<span class="narrative-weekly flat">– 0%</span>`;
    }

    // Top market preview
    const topQ = n.top_market
      ? n.top_market.question.length > 60
        ? n.top_market.question.substring(0, 57) + '…'
        : n.top_market.question
      : '';
    const topVol = n.top_market
      ? `$${n.top_market.volume >= 1000000
          ? (n.top_market.volume / 1000000).toFixed(1) + 'M'
          : (n.top_market.volume / 1000).toFixed(0) + 'K'}`
      : '';

    return `
      <div class="narrative-row" onclick="filterByNarrative('${n.narrative.replace(/'/g, "\\'")}')"
           data-narrative="${n.narrative}">
        <div class="narrative-bar-fill" style="width:${barPct}%"></div>
        <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;display:inline-block;"></span>
        <span class="narrative-name">${n.narrative}</span>
        <span class="narrative-dominance">${n.dominance_pct.toFixed(1)}%</span>
        ${weeklyHtml}
        <span class="narrative-count">${n.market_count} markets</span>
        <span class="narrative-top-market">${topQ}${topVol ? ` · <b style="color:#888">${topVol}</b>` : ''}</span>
      </div>
    `;
  }).join('');
}

function filterByNarrative(narrative) {
  if (_activeNarrative === narrative) {
    // Toggle off — clear filter
    _activeNarrative = null;
    document.querySelectorAll('.narrative-row').forEach(r => r.classList.remove('active'));
    // Re-apply normal screener filters without narrative constraint
    applyScreenerFilters(); // call whatever your existing filter function is named
    return;
  }

  _activeNarrative = narrative;
  document.querySelectorAll('.narrative-row').forEach(r => {
    r.classList.toggle('active', r.dataset.narrative === narrative);
  });

  // Filter the screener table — pass narrative as keyword search
  // This integrates with your existing filter logic:
  // Option A: if there's a search input, set its value
  const searchInput = document.getElementById('screener-search') || document.querySelector('.screener-search');
  if (searchInput) {
    searchInput.value = '';
  }

  // Option B: call the existing filter/render function with narrative keywords
  // Adjust `applyScreenerFilters` to check `_activeNarrative` and filter market questions
  applyScreenerFilters();
}
```

### 3D. Hook narrative filter into existing `applyScreenerFilters()`

Find your existing `applyScreenerFilters()` function (or whatever renders/filters the table). Add this block **at the top of that function**, before the category/whale/volume filters:

```js
// Narrative filter
if (_activeNarrative && _activeNarrative !== 'Other') {
  const NARRATIVE_FILTER_KEYWORDS = {
    'Trump & US Politics':   ['trump','president','democrat','republican','congress','senate','maga','white house','tariff'],
    'Crypto & DeFi':         ['bitcoin','btc','ethereum','eth','crypto','solana','sol','defi','nft','coinbase'],
    'Middle East & War':     ['israel','iran','gaza','hamas','hezbollah','ceasefire','hormuz','middle east'],
    'AI & Big Tech':         ['ai','openai','gpt','artificial intelligence','nvidia','apple','microsoft','google','meta'],
    'Macro & Economy':       ['fed','federal reserve','interest rate','inflation','recession','gdp','cpi','unemployment','rate cut'],
    'Ukraine & Russia':      ['ukraine','russia','zelensky','putin','nato','kyiv'],
    'NBA & Basketball':      ['nba','basketball','finals','playoff','lakers','celtics'],
    'NFL & American Sports': ['nfl','super bowl','mlb','world series','nhl','stanley cup'],
    'Global Elections':      ['election','vote','ballot','candidate','prime minister','chancellor'],
  };
  const kws = NARRATIVE_FILTER_KEYWORDS[_activeNarrative] || [];
  markets = markets.filter(m => {
    const q = (m.question || '').toLowerCase();
    return kws.some(kw => q.includes(kw));
  });
}
```

### 3E. Call `loadNarratives()` on page load

Find where the screener initialises (likely a `DOMContentLoaded` or `init()` call). Add:

```js
loadNarratives();
```

---

## 4. CLAUDE.md Updates

- Add `supabase_migration_narrative_snapshots.sql` as **#31** in the ordered migration list
- In "Current State", note: Screener now has Narrative Intelligence section — dominance % + weekly delta + click-to-filter

---

## 5. Commit

```bash
git add server.js public/screener.html supabase_migration_narrative_snapshots.sql CLAUDE.md
git commit -m "feat: screener narrative intelligence — dominant themes, dominance %, weekly change"
git push origin main
```

---

## Expected Result

Screener page now has a **Narrative Intelligence panel** above the filters showing:

```
🧭 Narrative Intelligence    what themes dominate prediction markets this week

● Trump & US Politics     31.2%  ▲ 4.1%    47 markets   Will Trump be impeached? · $12.4M
● Crypto & DeFi           18.7%  ▼ 2.3%    38 markets   Will BTC hit $100K? · $9.1M
● Middle East & War       12.1%  ▲ 0.8%    21 markets   Will Iran attack Israel? · $6.2M
● AI & Big Tech            9.4%  new        15 markets   Will OpenAI IPO in 2026? · $4.0M
● Macro & Economy          8.2%  ▼ 1.0%    19 markets   Will Fed cut rates in May? · $3.8M
…
```

Clicking any row filters the table below to that narrative. Clicking again clears the filter.
Weekly change shows null → "new" on first day, then % point movement after 7 days of snapshots.
