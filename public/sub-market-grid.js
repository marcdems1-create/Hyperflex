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
      '.hfx-smg{background:#0d0d0d;border:1px solid #1f1f1f;border-radius:14px;padding:20px;font-family:Inter,system-ui,sans-serif;color:#f0f0f5;margin-bottom:18px}',
      '.hfx-smg-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px}',
      '.hfx-smg-h{font-family:JetBrains Mono,ui-monospace,monospace;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#f0f0f5;font-weight:700}',
      '.hfx-smg-meta{font-family:JetBrains Mono,ui-monospace,monospace;font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:#6e6790;padding:3px 8px;border:1px solid #1f1f1f;background:#141414}',
      '.hfx-smg-section{margin-bottom:14px}',
      '.hfx-smg-section:last-child{margin-bottom:0}',
      '.hfx-smg-section-h{font-family:JetBrains Mono,ui-monospace,monospace;font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:#6e6790;margin-bottom:8px;display:flex;align-items:center;gap:8px}',
      '.hfx-smg-section-h::after{content:"";flex:1;height:1px;background:rgba(255,255,255,0.04)}',
      '.hfx-smg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}',
      '.hfx-smg-tile{position:relative;background:#141414;border:1px solid #1f1f1f;border-radius:8px;padding:12px 14px;cursor:pointer;transition:border-color .12s,background .12s,transform .12s;text-align:left;display:flex;flex-direction:column;gap:8px;min-height:96px}',
      '.hfx-smg-tile:hover{border-color:#3a3a3a;background:#181818;transform:translateY(-1px)}',
      '.hfx-smg-tile.active{border-color:#f5c518;background:rgba(245,197,24,0.04)}',
      '.hfx-smg-tile.cat-winner{border-color:rgba(214,56,72,0.30)}',
      '.hfx-smg-tile.cat-winner:hover{border-color:#d63848}',
      '.hfx-smg-tile-cat{font-family:JetBrains Mono,ui-monospace,monospace;font-size:8px;letter-spacing:0.16em;text-transform:uppercase;color:#6e6790;display:flex;justify-content:space-between;align-items:center}',
      '.hfx-smg-tile-cat .vol{color:#4a4570;font-weight:700}',
      '.hfx-smg-tile-q{font-family:Inter,system-ui,sans-serif;font-size:13px;font-weight:600;color:#f0f0f5;line-height:1.32;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.hfx-smg-tile-prices{display:flex;gap:6px;margin-top:auto}',
      '.hfx-smg-px{flex:1;background:#0a0a0a;border:1px solid #1f1f1f;border-radius:5px;padding:5px 8px;display:flex;justify-content:space-between;align-items:center;font-family:JetBrains Mono,ui-monospace,monospace}',
      '.hfx-smg-px-side{font-size:9px;letter-spacing:0.10em;color:#6e6790;text-transform:uppercase;font-weight:700}',
      '.hfx-smg-px-val{font-size:13px;font-weight:800;color:#f0f0f5;letter-spacing:-0.01em}',
      '.hfx-smg-px.yes .hfx-smg-px-val{color:#3db468}',
      '.hfx-smg-px.no .hfx-smg-px-val{color:#cb3131}',
      '.hfx-smg-px.locked .hfx-smg-px-val{color:#6e6790}',
      '.hfx-smg-tile-foot{font-family:JetBrains Mono,ui-monospace,monospace;font-size:9px;letter-spacing:0.10em;color:#6e6790;display:flex;justify-content:space-between;text-transform:uppercase;padding-top:6px;border-top:1px solid rgba(255,255,255,0.04)}',
      '.hfx-smg-tile-foot .trade{color:#f5c518;font-weight:700}',
      '.hfx-smg-tile:hover .trade{color:#fff}',
      '.hfx-smg-empty{font-family:JetBrains Mono,ui-monospace,monospace;font-size:11px;color:#6e6790;text-align:center;padding:14px;letter-spacing:0.06em}',
      '@media(max-width:560px){.hfx-smg-grid{grid-template-columns:1fr}.hfx-smg{padding:16px}}',
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
        '<div class="hfx-smg-tile-cat">',
          '<span>' + escapeHtml(catLabel.toUpperCase()) + '</span>',
          '<span class="vol">' + fmtVol(m.volume24hr || m.volume) + ' 24H</span>',
        '</div>',
        '<div class="hfx-smg-tile-q">' + escapeHtml(m.question || '') + '</div>',
        '<div class="hfx-smg-tile-prices">',
          '<div class="hfx-smg-px ' + (hasPrices ? 'yes' : 'locked') + '">',
            '<span class="hfx-smg-px-side">Yes</span>',
            '<span class="hfx-smg-px-val">' + yesPct + '</span>',
          '</div>',
          '<div class="hfx-smg-px ' + (hasPrices ? 'no' : 'locked') + '">',
            '<span class="hfx-smg-px-side">No</span>',
            '<span class="hfx-smg-px-val">' + noPct + '</span>',
          '</div>',
        '</div>',
        '<div class="hfx-smg-tile-foot">',
          '<span>' + (hasPrices ? ('@ ' + fmtCents(m.yesPrice) + ' / ' + fmtCents(m.noPrice)) : 'Awaiting book') + '</span>',
          '<span class="trade">' + (isActive ? 'Active ●' : 'Trade →') + '</span>',
        '</div>',
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
            '<div class="hfx-smg-section-h"><span>' + escapeHtml(label) + '</span><span style="color:#4a4570">' + rows.length + '</span></div>' +
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
