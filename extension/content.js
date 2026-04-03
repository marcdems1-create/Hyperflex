// HyperFlex Market Intelligence — Polymarket Overlay
// Aggregates whale data, AI signals, screener, cross-platform odds

(function() {
  'use strict';

  const API = 'https://hyperflex.network';
  let cache = { whales: null, screener: null, signals: null, ts: 0 };
  let panelEl = null;
  let collapsed = false;
  let lastUrl = '';

  // Fetch all data sources in parallel
  async function fetchAllData() {
    if (Date.now() - cache.ts < 5 * 60 * 1000 && cache.whales) return cache;
    const [whales, screener, signals] = await Promise.all([
      fetch(`${API}/api/whale-index`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null),
      fetch(`${API}/api/screener`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null),
      fetch(`${API}/api/signals`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null),
    ]);
    cache = { whales, screener: Array.isArray(screener) ? screener : screener?.markets || [], signals: signals?.signals || [], ts: Date.now() };
    return cache;
  }

  // Get page title from Polymarket
  function getPageTitle() {
    const h1 = document.querySelector('h1');
    if (h1) return h1.textContent.trim();
    const meta = document.querySelector('meta[property="og:title"]');
    if (meta) return meta.content;
    return document.title.split('|')[0].trim();
  }

  // Fuzzy match a title against a market name
  function matchScore(pageTitle, marketName) {
    const stop = new Set(['will','the','that','this','what','when','before','after','from','with','have','been','does','price','above','below','market','event']);
    const pWords = pageTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !stop.has(w));
    const mWords = marketName.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !stop.has(w));
    if (!pWords.length || !mWords.length) return 0;
    let hits = 0;
    for (const pw of pWords) {
      for (const mw of mWords) {
        if (pw.includes(mw) || mw.includes(pw)) { hits++; break; }
      }
    }
    return hits;
  }

  function fmt(n) {
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return '$' + Math.round(n / 1000) + 'K';
    return '$' + n;
  }

  // Build intelligence for current market
  function buildIntel(title, data) {
    const intel = { market: title, sections: [] };

    // 1. Whale data
    if (data.whales?.picks?.length) {
      let best = null, bestScore = 0;
      for (const p of data.whales.picks) {
        const s = matchScore(title, p.market);
        if (s >= 2 && s > bestScore) { bestScore = s; best = p; }
      }
      if (best) {
        intel.sections.push({
          type: 'whales',
          icon: '\uD83D\uDC33',
          title: 'Whale Positions',
          data: best,
          html: `
            <div class="hfx-stat-row">
              <span class="hfx-label">Whales</span>
              <span class="hfx-val hfx-gold">${best.whale_count}</span>
            </div>
            <div class="hfx-stat-row">
              <span class="hfx-label">Capital</span>
              <span class="hfx-val">${fmt(best.total_capital)}</span>
            </div>
            <div class="hfx-stat-row">
              <span class="hfx-label">Consensus</span>
              <span class="hfx-val hfx-green">${best.consensus_side} (${best.consensus_pct}%)</span>
            </div>
            <div class="hfx-bar"><div class="hfx-bar-fill" style="width:${best.consensus_pct}%"></div></div>
            <div class="hfx-stat-row">
              <span class="hfx-label">YES Capital</span>
              <span class="hfx-val hfx-green">${fmt(best.yes_capital || 0)}</span>
            </div>
            <div class="hfx-stat-row">
              <span class="hfx-label">NO Capital</span>
              <span class="hfx-val hfx-red">${fmt(best.no_capital || 0)}</span>
            </div>
            <div class="hfx-strength-badge hfx-strength-${best.strength || 'EMERGING'}">${best.strength || 'EMERGING'}</div>
          `
        });
      }
    }

    // 2. Screener data (edge score, volume, 24h change)
    if (data.screener?.length) {
      let best = null, bestScore = 0;
      for (const m of data.screener) {
        const s = matchScore(title, m.question || '');
        if (s >= 2 && s > bestScore) { bestScore = s; best = m; }
      }
      if (best) {
        const edgeScore = best.edge_score || 0;
        const edgeColor = edgeScore >= 60 ? 'hfx-green' : edgeScore >= 30 ? 'hfx-gold' : '';
        intel.sections.push({
          type: 'screener',
          icon: '\uD83D\uDCCA',
          title: 'Market Data',
          html: `
            <div class="hfx-stat-row">
              <span class="hfx-label">Edge Score</span>
              <span class="hfx-val ${edgeColor}">${edgeScore}/100</span>
            </div>
            <div class="hfx-stat-row">
              <span class="hfx-label">Volume</span>
              <span class="hfx-val">${fmt(best.volume || 0)}</span>
            </div>
            ${best.price_change_24h != null ? `<div class="hfx-stat-row">
              <span class="hfx-label">24h Change</span>
              <span class="hfx-val ${best.price_change_24h > 0 ? 'hfx-green' : best.price_change_24h < 0 ? 'hfx-red' : ''}">${best.price_change_24h > 0 ? '+' : ''}${Math.round(best.price_change_24h)}%</span>
            </div>` : ''}
            ${best.ai_hook ? `<div class="hfx-ai-hook">${best.ai_hook}</div>` : ''}
            ${best.trade ? `<div class="hfx-trade">
              <span class="hfx-label">Trade</span>
              <span class="hfx-val">BUY ${best.trade.side} @ ${best.trade.entry_cost}\u00A2 \u2192 +${best.trade.roi_pct}% ROI</span>
            </div>` : ''}
          `
        });
      }
    }

    // 3. AI Signals
    if (data.signals?.length) {
      const matching = data.signals.filter(s => matchScore(title, s.market || s.question || '') >= 2);
      if (matching.length) {
        const sig = matching[0];
        const typeLabels = { whale_cluster: 'Whale Cluster', momentum: 'Momentum Shift', volume_surge: 'Volume Surge', new_entry: 'New Whale Entry', arbitrage: 'Arbitrage' };
        intel.sections.push({
          type: 'signal',
          icon: '\uD83D\uDCE1',
          title: 'AI Signal',
          html: `
            <div class="hfx-signal-type">${typeLabels[sig.type] || sig.type}</div>
            <div class="hfx-signal-conf">Confidence: <span class="${sig.confidence === 'HIGH' ? 'hfx-green' : sig.confidence === 'MEDIUM' ? 'hfx-gold' : ''}">${sig.confidence || 'LOW'}</span></div>
            ${sig.description ? `<div class="hfx-signal-desc">${sig.description}</div>` : ''}
          `
        });
      }
    }

    return intel;
  }

  // Render panel
  function render(intel) {
    if (!panelEl) {
      panelEl = document.createElement('div');
      panelEl.id = 'hfx-whale-panel';
      document.body.appendChild(panelEl);
    }

    if (collapsed) {
      panelEl.className = 'hfx-collapsed';
      panelEl.innerHTML = '<span class="hfx-fab-icon">\uD83D\uDC33</span>';
      panelEl.onclick = () => { collapsed = false; render(intel); };
      return;
    }

    panelEl.className = '';
    panelEl.onclick = null;

    const hasSections = intel.sections.length > 0;

    panelEl.innerHTML = `
      <div class="hfx-content">
        <div class="hfx-header">
          <span class="hfx-logo">HYPERFLEX</span>
          <button class="hfx-close" id="hfx-close">\u00D7</button>
        </div>
        <div class="hfx-body">
          ${hasSections ? intel.sections.map(s => `
            <div class="hfx-section">
              <div class="hfx-section-title">${s.icon} ${s.title}</div>
              ${s.html}
            </div>
          `).join('') : `
            <div class="hfx-no-data">
              No intelligence available for this market yet.<br><br>
              We track whale wallets, AI signals, and cross-platform odds across 200+ markets.
            </div>
          `}
        </div>
        <div class="hfx-footer">
          <a href="${API}" target="_blank">Powered by HyperFlex</a>
          <a href="${API}/screener" target="_blank" style="font-size:11px">Full Screener \u2192</a>
        </div>
      </div>
    `;

    panelEl.querySelector('#hfx-close').onclick = () => { collapsed = true; render(intel); };
  }

  // Main update
  async function update() {
    const title = getPageTitle();
    if (!title || title.length < 5) return;

    const data = await fetchAllData();
    const intel = buildIntel(title, data);
    render(intel);
  }

  // Watch for SPA navigation
  function watchNav() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      if (lastUrl.includes('/event/') || lastUrl.includes('/market/')) {
        setTimeout(update, 1500);
      } else if (panelEl) {
        panelEl.style.display = 'none';
      }
    }
  }

  setInterval(watchNav, 1000);
  if (window.location.href.includes('/event/') || window.location.href.includes('/market/')) {
    setTimeout(update, 2000);
  }
  setInterval(update, 5 * 60 * 1000);

  console.log('[HyperFlex] Market intelligence extension loaded');
})();
