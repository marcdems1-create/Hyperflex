// HYPERFLEX <SubMarketGrid> — full sub-market list as a tappable grid.
//
// Mounts below the SurvivalCurve on /fight/<slug>. Renders every sub-
// market in the gamma event payload as a compact tile (winner binary,
// method markets, round/duration markets, props — everything). Click
// any tile to swap the TradeComposer above it to that sub-market's
// outcomes. Curve sets the read, tiles are the expressions, composer
// is the trigger.
//
// USAGE
//   HFXSubMarketGrid.mount(targetEl, {
//     markets: [{ question, slug, conditionId, yesPrice, noPrice,
//                 volume, volume24hr, liquidity, tokenIds,
//                 category, label }, ...],
//     onPick:  function(market) { ... }   // fires on tile click
//     activeSlug: '...'                    // optional — highlight tile
//   });
//
// Returns { update({markets, activeSlug}), destroy() }.

(function() {
  'use strict';
  if (window.HFXSubMarketGrid) return; // singleton

  // Style injection — reuses the same dark/coral/yellow palette as
  // TradeComposer + SurvivalCurve so all three panels read as one
  // surface. Single inline injection per page; idempotent.
  var STYLE_INJECTED = false;
  function injectStyles() {
    if (STYLE_INJECTED) return;
    STYLE_INJECTED = true;
    var s = document.createElement('style');
    s.id = 'hfx-sub-grid-styles';
    s.textContent = [
      '.hfx-smg{background:#0d0d0d;border:1px solid #1f1f1f;border-radius:14px;padding:24px;font-family:Inter,system-ui,sans-serif;color:#f0f0f5;margin-bottom:18px}',
      '.hfx-smg-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:8px;padding-bottom:14px;border-bottom:1px solid #1a1a1a}',
      '.hfx-smg-h{font-family:Inter,system-ui,sans-serif;font-size:16px;letter-spacing:0.02em;color:#f0f0f5;font-weight:700}',
      '.hfx-smg-meta{font-family:JetBrains Mono,ui-monospace,monospace;font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:#6e6790;padding:4px 10px;border:1px solid #1f1f1f;background:#141414;border-radius:999px}',
      '.hfx-smg-section{margin-bottom:28px}',
      '.hfx-smg-section:last-child{margin-bottom:0}',
      '.hfx-smg-section-h{display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-left:10px;border-left:3px solid #f5c518}',
      '.hfx-smg-section-h .lbl{font-family:Inter,system-ui,sans-serif;font-size:18px;font-weight:600;color:#f0f0f5;letter-spacing:-0.005em}',
      '.hfx-smg-section-h .count{font-family:JetBrains Mono,ui-monospace,monospace;font-size:10px;font-weight:700;color:#c5bedd;background:#181818;border:1px solid #2a2a2a;border-radius:999px;padding:2px 9px;letter-spacing:0.04em}',
      '.hfx-smg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}',
      '.hfx-smg-tile{position:relative;background:#141414;border:1px solid #1f1f1f;border-radius:10px;padding:14px 14px 12px;cursor:pointer;transition:border-color .12s,background .12s,transform .12s;text-align:left;display:flex;flex-direction:column;gap:10px;min-height:148px}',
      '.hfx-smg-tile:hover{border-color:#3a3a3a;background:#181818;transform:translateY(-1px)}',
      '.hfx-smg-tile.active{border-color:#f5c518;background:rgba(245,197,24,0.04);box-shadow:0 0 0 1px rgba(245,197,24,0.4) inset}',
      '.hfx-smg-tile-head{display:flex;justify-content:space-between;align-items:center;gap:8px}',
      '.hfx-smg-tile-pill{font-family:JetBrains Mono,ui-monospace,monospace;font-size:9px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;padding:3px 8px;border-radius:999px;border:1px solid;line-height:1}',
      '.hfx-smg-tile.cat-winner    .hfx-smg-tile-pill{color:#ff7a8a;background:rgba(255,77,106,0.10);border-color:rgba(255,77,106,0.35)}',
      '.hfx-smg-tile.cat-method    .hfx-smg-tile-pill{color:#7fb6ff;background:rgba(77,159,255,0.10);border-color:rgba(77,159,255,0.35)}',
      '.hfx-smg-tile.cat-threshold .hfx-smg-tile-pill{color:#f5c518;background:rgba(245,197,24,0.08);border-color:rgba(245,197,24,0.35)}',
      '.hfx-smg-tile.cat-prop      .hfx-smg-tile-pill{color:#a8a4be;background:rgba(160,160,180,0.06);border-color:#2a2a2a}',
      '.hfx-smg-tile-vol{font-family:JetBrains Mono,ui-monospace,monospace;font-size:9px;letter-spacing:0.10em;text-transform:uppercase;color:#6e6790;font-weight:700;white-space:nowrap}',
      '.hfx-smg-tile-q{font-family:Inter,system-ui,sans-serif;font-size:14px;font-weight:600;color:#f0f0f5;line-height:1.32;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;letter-spacing:-0.005em}',
      '.hfx-smg-tile-prices{display:flex;gap:8px;margin-top:auto}',
      '.hfx-smg-px{flex:1;background:#0a0a0a;border:1px solid #1f1f1f;border-radius:6px;padding:8px 10px;display:flex;flex-direction:column;gap:2px;font-family:JetBrains Mono,ui-monospace,monospace}',
      '.hfx-smg-px-side{font-size:9px;letter-spacing:0.12em;color:#6e6790;text-transform:uppercase;font-weight:700}',
      '.hfx-smg-px-val{font-size:30px;font-weight:800;color:#f0f0f5;letter-spacing:-0.025em;line-height:1;font-variant-numeric:tabular-nums}',
      '.hfx-smg-px-ref{font-size:10px;color:#4a4570;font-weight:600;letter-spacing:0.02em;margin-top:2px}',
      '.hfx-smg-px.yes .hfx-smg-px-val{color:#3db468}',
      '.hfx-smg-px.no  .hfx-smg-px-val{color:#cb3131}',
      '.hfx-smg-px.locked .hfx-smg-px-val{color:#6e6790;font-size:18px}',
      '.hfx-smg-tile-cta{display:block;width:100%;padding:11px 12px;font-family:JetBrains Mono,ui-monospace,monospace;font-size:11px;font-weight:800;letter-spacing:0.10em;text-transform:uppercase;color:#0a0a0a;background:#f5c518;border:none;border-radius:8px;text-align:center;min-height:44px;line-height:1.2;cursor:pointer;transition:filter .12s}',
      '.hfx-smg-tile:hover .hfx-smg-tile-cta{filter:brightness(1.08)}',
      '.hfx-smg-tile.active .hfx-smg-tile-cta{background:#fff;color:#0a0a0a}',
      '.hfx-smg-empty{font-family:JetBrains Mono,ui-monospace,monospace;font-size:11px;color:#6e6790;text-align:center;padding:14px;letter-spacing:0.06em}',
      '@media(max-width:560px){.hfx-smg-grid{grid-template-columns:1fr;gap:12px}.hfx-smg{padding:18px}.hfx-smg-px-val{font-size:26px}.hfx-smg-section-h .lbl{font-size:16px}}',
    ].join('');
    document.head.appendChild(s);
  }

  function fmtCents(p) {
    if (!isFinite(p) || p <= 0 || p >= 1) return '—';
    return '$' + p.toFixed(2);
  }
  function fmtVol(v) {
    if (!isFinite(v) || v <= 0) return '—';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
    return '$' + Math.round(v);
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }

  // Pretty section labels per category — aligned with the server-side
  // _catRank ordering so sections appear in the same logical sequence.
  var SECTION_LABELS = {
    winner:    'Main market',
    method:    'How does it end?',
    threshold: 'How long does it last?',
    prop:      'Other markets',
  };

  function renderTile(m, isActive) {
    var catLabel = (m.label || m.category || '').toString();
    if (m.category === 'winner') catLabel = 'Winner';
    else if (m.category === 'method') catLabel = m.label || 'Method';
    else if (m.category === 'threshold') catLabel = (m.label || 'Threshold');
    else catLabel = catLabel || 'Prop';
    var hasPrices = isFinite(m.yesPrice) && m.yesPrice > 0 && m.yesPrice < 1;
    var yesPct = hasPrices ? Math.round(m.yesPrice * 100) + '%' : '—';
    var noPct  = hasPrices ? Math.round(m.noPrice  * 100) + '%' : '—';
    var classes = ['hfx-smg-tile', 'cat-' + (m.category || 'prop')];
    if (isActive) classes.push('active');
    return [
      '<button class="' + classes.join(' ') + '" type="button" data-slug="' + escapeHtml(m.slug || m.conditionId || '') + '">',
        '<div class="hfx-smg-tile-head">',
          '<span class="hfx-smg-tile-pill">' + escapeHtml(catLabel.toUpperCase()) + '</span>',
          '<span class="hfx-smg-tile-vol">' + fmtVol(m.volume24hr || m.volume) + ' 24H</span>',
        '</div>',
        '<div class="hfx-smg-tile-q">' + escapeHtml(m.question || '') + '</div>',
        '<div class="hfx-smg-tile-prices">',
          '<div class="hfx-smg-px ' + (hasPrices ? 'yes' : 'locked') + '">',
            '<span class="hfx-smg-px-side">Yes</span>',
            '<span class="hfx-smg-px-val">' + yesPct + '</span>',
            '<span class="hfx-smg-px-ref">' + (hasPrices ? fmtCents(m.yesPrice) : 'no book') + '</span>',
          '</div>',
          '<div class="hfx-smg-px ' + (hasPrices ? 'no' : 'locked') + '">',
            '<span class="hfx-smg-px-side">No</span>',
            '<span class="hfx-smg-px-val">' + noPct + '</span>',
            '<span class="hfx-smg-px-ref">' + (hasPrices ? fmtCents(m.noPrice) : 'no book') + '</span>',
          '</div>',
        '</div>',
        '<span class="hfx-smg-tile-cta">' + (isActive ? 'Active ●' : 'Trade this market →') + '</span>',
      '</button>',
    ].join('');
  }

  function mount(targetEl, opts) {
    if (!targetEl) throw new Error('HFXSubMarketGrid.mount: targetEl required');
    opts = opts || {};
    injectStyles();

    var root = document.createElement('div');
    root.className = 'hfx-smg';
    targetEl.innerHTML = '';
    targetEl.appendChild(root);

    function paint(markets, activeSlug) {
      markets = markets || [];
      // Group by category. Server already sorts by category + volume,
      // but client groups again for stable section rendering even if
      // an upstream change re-orders the array.
      var grouped = { winner: [], method: [], threshold: [], prop: [] };
      for (var i = 0; i < markets.length; i++) {
        var c = markets[i].category || 'prop';
        if (!grouped[c]) grouped[c] = [];
        grouped[c].push(markets[i]);
      }

      var totalCount = markets.length;
      if (!totalCount) {
        root.innerHTML = [
          '<div class="hfx-smg-head">',
            '<div class="hfx-smg-h">All markets</div>',
            '<span class="hfx-smg-meta">No live sub-markets</span>',
          '</div>',
          '<div class="hfx-smg-empty">Sub-markets will appear here as Polymarket lists them.</div>',
        ].join('');
        return;
      }

      var sections = [];
      ['winner', 'method', 'threshold', 'prop'].forEach(function(cat) {
        var rows = grouped[cat];
        if (!rows || !rows.length) return;
        var label = SECTION_LABELS[cat] || cat.toUpperCase();
        sections.push(
          '<div class="hfx-smg-section">' +
            '<div class="hfx-smg-section-h"><span class="lbl">' + escapeHtml(label) + '</span><span class="count">' + rows.length + '</span></div>' +
            '<div class="hfx-smg-grid">' +
              rows.map(function(m) { return renderTile(m, m.slug && m.slug === activeSlug); }).join('') +
            '</div>' +
          '</div>'
        );
      });

      root.innerHTML = [
        '<div class="hfx-smg-head">',
          '<div class="hfx-smg-h">All markets</div>',
          '<span class="hfx-smg-meta">' + totalCount + ' live · click to trade</span>',
        '</div>',
        sections.join(''),
      ].join('');

      // Wire tile clicks. Use root delegate so we don't have to re-bind
      // on every paint.
    }

    function onClick(e) {
      var tile = e.target.closest && e.target.closest('.hfx-smg-tile');
      if (!tile) return;
      var slug = tile.dataset.slug;
      if (!slug || typeof opts.onPick !== 'function') return;
      var marketArr = (lastMarkets || []);
      var picked = null;
      for (var i = 0; i < marketArr.length; i++) {
        if (marketArr[i].slug === slug || marketArr[i].conditionId === slug) {
          picked = marketArr[i];
          break;
        }
      }
      if (picked) opts.onPick(picked);
    }
    root.addEventListener('click', onClick);

    var lastMarkets = opts.markets || [];
    paint(lastMarkets, opts.activeSlug);

    return {
      update: function(next) {
        next = next || {};
        if (Array.isArray(next.markets)) lastMarkets = next.markets;
        paint(lastMarkets, next.activeSlug);
      },
      destroy: function() {
        root.removeEventListener('click', onClick);
        if (root.parentNode) root.parentNode.removeChild(root);
      },
    };
  }

  window.HFXSubMarketGrid = { mount: mount };
})();
