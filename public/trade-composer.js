// HYPERFLEX <TradeComposer> — shared trade-composition primitive.
//
// Mounts on fight.html (replacing the legacy "Live Market" panel) and on
// market.html (slide-up sheet on outcome-card click). One renderer, one
// math engine, two entry points. Outcome-agnostic — every multi-outcome
// market is just a series of binary trades, the page is the orchestrator.
//
// USAGE
//   HFXTradeComposer.mount(targetEl, {
//     left:  { name: 'Chimaev',    price: 0.83, tokenId: '...', tag: 'FAV' },
//     right: { name: 'Strickland', price: 0.18, tokenId: '...', tag: 'DOG' },
//     defaultSide: 'left',
//     eventSlug: 'ufc-sea2-kha7-2026-05-09',
//     marketSlug: '...',          // optional — for /market/:slug deep link
//     vol24h: 1234567,
//     liquidity: 200000,
//     question: 'Will Chimaev defeat Strickland?',
//     onPlaceTrade: function(state) { ... }   // optional override
//   });
//
// The default onPlaceTrade redirects to /market/<eventSlug or marketSlug>
// with side + amount + take pre-filled in the URL hash. market.html's
// existing trade modal can wire those up in a follow-up commit; until
// then the user lands on the proven trade flow with their intent
// captured in the URL (no data loss).
//
// V1 SCOPE — this is the presentation + math layer. Wallet signing
// stays on market.html where the full Polymarket EIP-712 + Safe
// execTransaction stack lives. Composer never touches MetaMask
// directly. APPROVAL_CAP / Blockaid concerns are inherited from the
// downstream trade flow; this module never writes approvals.

(function() {
  'use strict';
  if (window.HFXTradeComposer) return; // singleton

  // ── Math primitives ─────────────────────────────────────────────────
  // CLOB pricing: shares = stake / price, payout = shares * 1.0,
  // profit = payout - stake, return-multiple = payout / stake.
  // Symmetric for both sides — the wow comes from clicking the dog
  // and watching return-multiple jump (e.g. $0.18 → 5.56×).
  function calcMath(stake, price) {
    if (!isFinite(stake) || stake <= 0 || !isFinite(price) || price <= 0 || price >= 1) {
      return { shares: 0, payout: 0, profit: 0, multiple: 0 };
    }
    var shares = stake / price;
    var payout = shares;            // each share pays $1 if YES wins
    var profit = payout - stake;
    var multiple = payout / stake;
    return { shares: shares, payout: payout, profit: profit, multiple: multiple };
  }

  // FLEX impact preview — placeholder linear function per the brief.
  // Swap for Brier-derived delta in a follow-up. v1 numbers visible in
  // the "FLEX 1,247 → win 1,289 / loss 1,205" line.
  function flexImpact(currentScore, stake, profit) {
    var win  = Math.round(currentScore + profit * 0.1);
    var loss = Math.round(currentScore - stake * 0.05);
    return { win: win, loss: loss };
  }

  // ── Formatters ───────────────────────────────────────────────────────
  function fmtCents(p) {
    if (!isFinite(p) || p <= 0) return '—';
    return '$' + p.toFixed(2);
  }
  function fmtPct(p) {
    if (!isFinite(p) || p <= 0) return '—';
    return Math.round(p * 100) + '%';
  }
  function fmtNum(n, d) {
    if (!isFinite(n) || n === 0) return '0';
    if (d == null) d = 2;
    return n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 });
  }
  function fmtUsd(n, d) {
    if (!isFinite(n) || n === 0) return '$0';
    if (d == null) d = 2;
    return '$' + n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 });
  }
  function fmtMultiple(m) {
    if (!isFinite(m) || m <= 0) return '—';
    return m.toFixed(2) + '×';
  }

  // ── Style injection — runs once per page ────────────────────────────
  // Inline-injected so the module is single-file droppable and doesn't
  // need a separate CSS load. Uses CSS custom properties when available
  // (market.html / fight.html / mentions.html all have their own
  // palettes) but falls back to hardcoded coral/yellow values.
  var STYLE_INJECTED = false;
  function injectStyles() {
    if (STYLE_INJECTED) return;
    STYLE_INJECTED = true;
    var s = document.createElement('style');
    s.id = 'hfx-trade-composer-styles';
    s.textContent = [
      '.hfx-tc{background:#0d0d0d;border:1px solid #1f1f1f;border-radius:14px;padding:20px;font-family:Inter,system-ui,sans-serif;color:#f0f0f5}',
      '.hfx-tc-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}',
      '.hfx-tc-h{font-family:JetBrains Mono,ui-monospace,monospace;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#6e6790}',
      '.hfx-tc-tag{font-family:JetBrains Mono,ui-monospace,monospace;font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:#d63848;padding:3px 7px;border:1px solid rgba(214,56,72,0.4);background:rgba(214,56,72,0.06)}',
      '.hfx-tc-side-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}',
      '.hfx-tc-side{position:relative;background:#141414;border:1.5px solid #1f1f1f;border-radius:10px;padding:16px 14px 14px;cursor:pointer;transition:border-color .12s,background .12s,box-shadow .12s,transform .12s;text-align:left}',
      '.hfx-tc-side:hover{border-color:#3a3a3a;background:#181818}',
      '.hfx-tc-side.selected{border-color:#f5c518;background:rgba(245,197,24,0.05);box-shadow:0 0 0 1px rgba(245,197,24,0.55) inset, 0 6px 18px rgba(245,197,24,0.10)}',
      '.hfx-tc-side-tag{position:absolute;top:10px;right:10px;font-family:JetBrains Mono,ui-monospace,monospace;font-size:8px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:#6e6790}',
      '.hfx-tc-side.selected .hfx-tc-side-tag{color:#f5c518}',
      '.hfx-tc-side-name{font-family:Inter,system-ui,sans-serif;font-size:13px;font-weight:600;color:#a8a4be;margin-bottom:8px;letter-spacing:0.02em;text-transform:uppercase}',
      '.hfx-tc-side-price{font-family:JetBrains Mono,ui-monospace,monospace;font-size:30px;font-weight:800;letter-spacing:-0.025em;color:#f0f0f5;line-height:1;font-variant-numeric:tabular-nums}',
      '.hfx-tc-side-pct{font-family:JetBrains Mono,ui-monospace,monospace;font-size:10px;color:#6e6790;margin-top:6px;letter-spacing:0.06em;text-transform:uppercase}',
      '.hfx-tc-stake-wrap{margin-bottom:14px}',
      '.hfx-tc-stake-label{font-family:JetBrains Mono,ui-monospace,monospace;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#6e6790;margin-bottom:6px}',
      '.hfx-tc-stake-input-wrap{position:relative}',
      '.hfx-tc-stake-prefix{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-family:JetBrains Mono,ui-monospace,monospace;font-size:18px;font-weight:700;color:#6e6790;pointer-events:none}',
      '.hfx-tc-stake-input{width:100%;padding:14px 14px 14px 30px;font-family:JetBrains Mono,ui-monospace,monospace;font-size:18px;font-weight:700;color:#f0f0f5;background:#141414;border:1.5px solid #1f1f1f;border-radius:8px;outline:none;transition:border-color .12s}',
      '.hfx-tc-stake-input:focus{border-color:#d63848}',
      '.hfx-tc-chips{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}',
      '.hfx-tc-chip{padding:6px 12px;font-family:JetBrains Mono,ui-monospace,monospace;font-size:11px;font-weight:700;letter-spacing:0.04em;color:#c5bedd;background:transparent;border:1px solid #2a2a2a;border-radius:6px;cursor:pointer;transition:border-color .12s,color .12s}',
      '.hfx-tc-chip:hover{border-color:#d63848;color:#f0f0f5}',
      '.hfx-tc-chip.selected{border-color:#d63848;color:#d63848;background:rgba(214,56,72,0.06)}',
      '.hfx-tc-math{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}',
      '.hfx-tc-math-tile{background:#141414;border:1px solid #1f1f1f;border-radius:8px;padding:10px 12px}',
      '.hfx-tc-math-tile.accent{background:rgba(245,197,24,0.06);border-color:rgba(245,197,24,0.32)}',
      '.hfx-tc-math-lbl{font-family:JetBrains Mono,ui-monospace,monospace;font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:#6e6790;margin-bottom:4px}',
      '.hfx-tc-math-val{font-family:JetBrains Mono,ui-monospace,monospace;font-size:15px;font-weight:800;color:#f0f0f5;letter-spacing:-0.01em}',
      '.hfx-tc-math-tile.accent .hfx-tc-math-val{color:#f5c518}',
      '.hfx-tc-take-btn{display:block;width:100%;padding:11px 14px;font-family:JetBrains Mono,ui-monospace,monospace;font-size:11px;font-weight:700;letter-spacing:0.10em;text-transform:uppercase;color:#c5bedd;background:transparent;border:1px dashed #2a2a2a;border-radius:8px;cursor:pointer;text-align:center;transition:border-color .12s,color .12s}',
      '.hfx-tc-take-btn:hover{border-color:#3db468;color:#3db468}',
      '.hfx-tc-take-area{display:none;margin-top:8px}',
      '.hfx-tc-take-area.open{display:block}',
      '.hfx-tc-take-input{width:100%;min-height:64px;padding:10px 12px;font-family:Inter,system-ui,sans-serif;font-size:13px;color:#f0f0f5;background:#141414;border:1.5px solid #1f1f1f;border-radius:8px;outline:none;resize:vertical;transition:border-color .12s}',
      '.hfx-tc-take-input:focus{border-color:#3db468}',
      '.hfx-tc-take-hint{font-family:JetBrains Mono,ui-monospace,monospace;font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:#6e6790;margin-top:6px}',
      '.hfx-tc-flex{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#0a0a0a;border:1px solid #1a1a1a;border-radius:8px;margin:14px 0;font-family:JetBrains Mono,ui-monospace,monospace;font-size:11px}',
      '.hfx-tc-flex-lbl{color:#6e6790;letter-spacing:0.10em;text-transform:uppercase;font-size:9px}',
      '.hfx-tc-flex-val{color:#c5bedd;font-weight:700}',
      '.hfx-tc-flex-win{color:#3db468;margin-left:6px}',
      '.hfx-tc-flex-loss{color:#cb3131;margin-left:6px}',
      '.hfx-tc-cta{display:block;width:100%;padding:16px 20px;font-family:JetBrains Mono,ui-monospace,monospace;font-size:13px;font-weight:800;letter-spacing:0.10em;text-transform:uppercase;color:#0a0a0a;background:#f5c518;border:none;border-radius:10px;cursor:pointer;text-align:center;transition:filter .12s,transform .12s,box-shadow .12s;text-decoration:none}',
      '.hfx-tc-cta:hover{filter:brightness(1.08);transform:translateY(-1px);box-shadow:0 8px 24px rgba(245,197,24,0.30)}',
      '.hfx-tc-cta:disabled,.hfx-tc-cta.disabled{filter:grayscale(1) brightness(0.6);cursor:not-allowed;transform:none;box-shadow:none}',
      '.hfx-tc-fineprint{font-family:JetBrains Mono,ui-monospace,monospace;font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:#4a4570;text-align:center;margin-top:10px}',
      '.hfx-tc-volliq{display:flex;justify-content:space-between;font-family:JetBrains Mono,ui-monospace,monospace;font-size:10px;color:#6e6790;margin-top:14px;padding-top:12px;border-top:1px solid #1a1a1a}',
      '.hfx-tc-volliq-stat{display:flex;gap:6px}',
      '.hfx-tc-volliq-lbl{color:#4a4570;letter-spacing:0.10em;text-transform:uppercase}',
      '.hfx-tc-volliq-val{color:#c5bedd;font-weight:700}',
      '@media(max-width:560px){',
        '.hfx-tc-math{grid-template-columns:repeat(2,1fr)}',
        '.hfx-tc-side-price{font-size:20px}',
      '}',
    ].join('');
    document.head.appendChild(s);
  }

  // ── Default trade dispatch ──────────────────────────────────────────
  // V1: redirect to /market/<slug> with hash-encoded intent so the
  // existing market.html flow picks up where the composer left off.
  // hash format: #side=YES&amount=100&take=...&from=fight
  // The hash form (vs query string) survives nav.js's SPA-ish routing
  // and doesn't pollute Polymarket-style canonical URLs.
  function defaultPlaceTrade(opts, state) {
    var slug = opts.eventSlug || opts.marketSlug;
    if (!slug) {
      alert('Trade target unavailable. Try refreshing.');
      return;
    }
    var sideName = state.side === 'left' ? opts.left.name : opts.right.name;
    var sideTag = state.side === 'left' ? 'YES' : 'NO'; // for binary fight markets, left=YES on the binary winner
    var hash = [
      'side=' + encodeURIComponent(sideTag),
      'pick=' + encodeURIComponent(sideName),
      'amount=' + encodeURIComponent(state.stake),
      'from=fight',
    ];
    if (state.take) hash.push('take=' + encodeURIComponent(state.take));
    window.location.href = '/market/' + slug + '#' + hash.join('&');
  }

  // ── Main mount entry point ─────────────────────────────────────────
  function mount(targetEl, opts) {
    if (!targetEl) throw new Error('HFXTradeComposer.mount: targetEl required');
    if (!opts || !opts.left || !opts.right) {
      throw new Error('HFXTradeComposer.mount: opts.left and opts.right required');
    }
    injectStyles();

    var state = {
      side: opts.defaultSide || 'left',  // 'left' | 'right'
      stake: 100,
      take: '',
      flexCurrent: opts.flexCurrent || 1247,  // placeholder until wired to user record
      takeOpen: false,
    };

    // Build the panel skeleton once; updates patch only the dynamic
    // numbers (math grid, FLEX preview, CTA label) on each input.
    var root = document.createElement('div');
    root.className = 'hfx-tc';
    root.innerHTML = [
      '<div class="hfx-tc-head">',
        '<div class="hfx-tc-h">Place Trade</div>',
        '<span class="hfx-tc-tag">' + (opts.headerTag || 'Live · Polymarket CLOB') + '</span>',
      '</div>',

      '<div class="hfx-tc-side-row" id="hfxTcSideRow">',
        renderSide(opts.left,  'left'),
        renderSide(opts.right, 'right'),
      '</div>',

      '<div class="hfx-tc-stake-wrap">',
        '<div class="hfx-tc-stake-label">Stake</div>',
        '<div class="hfx-tc-stake-input-wrap">',
          '<span class="hfx-tc-stake-prefix">$</span>',
          '<input id="hfxTcStake" class="hfx-tc-stake-input" type="number" inputmode="decimal" min="1" step="1" value="100" />',
        '</div>',
        '<div class="hfx-tc-chips" id="hfxTcChips">',
          '<button class="hfx-tc-chip" data-amt="25">$25</button>',
          '<button class="hfx-tc-chip selected" data-amt="100">$100</button>',
          '<button class="hfx-tc-chip" data-amt="500">$500</button>',
          '<button class="hfx-tc-chip" data-amt="1000">$1K</button>',
          '<button class="hfx-tc-chip" data-amt="MAX">MAX</button>',
        '</div>',
      '</div>',

      '<div class="hfx-tc-math" id="hfxTcMath">',
        '<div class="hfx-tc-math-tile"><div class="hfx-tc-math-lbl">Shares</div><div class="hfx-tc-math-val" id="hfxTcShares">—</div></div>',
        '<div class="hfx-tc-math-tile"><div class="hfx-tc-math-lbl">If Win</div><div class="hfx-tc-math-val" id="hfxTcPayout">—</div></div>',
        '<div class="hfx-tc-math-tile"><div class="hfx-tc-math-lbl">Profit</div><div class="hfx-tc-math-val" id="hfxTcProfit">—</div></div>',
        '<div class="hfx-tc-math-tile accent"><div class="hfx-tc-math-lbl">Return</div><div class="hfx-tc-math-val" id="hfxTcReturn">—</div></div>',
      '</div>',

      '<button id="hfxTcTakeBtn" class="hfx-tc-take-btn">+ Attach your take — posts to your profile when filled</button>',
      '<div id="hfxTcTakeArea" class="hfx-tc-take-area">',
        '<textarea id="hfxTcTakeInput" class="hfx-tc-take-input" placeholder="Why this side? Your take posts to your profile if the trade fills."></textarea>',
        '<div class="hfx-tc-take-hint">Locks to your record on fill — sharps build followings on receipts</div>',
      '</div>',

      '<div class="hfx-tc-flex">',
        '<div><span class="hfx-tc-flex-lbl">Flex Score Impact</span></div>',
        '<div>',
          '<span class="hfx-tc-flex-val" id="hfxTcFlexCurrent">' + state.flexCurrent.toLocaleString() + '</span>',
          '<span class="hfx-tc-flex-win" id="hfxTcFlexWin">→ —</span>',
          '<span class="hfx-tc-flex-loss" id="hfxTcFlexLoss">/ —</span>',
        '</div>',
      '</div>',

      '<button id="hfxTcCta" class="hfx-tc-cta">Place trade →</button>',
      '<div class="hfx-tc-fineprint">Settles on Polymarket · USDC on Polygon · Gas covered</div>',

      (opts.vol24h != null || opts.liquidity != null) ?
        '<div class="hfx-tc-volliq">' +
          '<div class="hfx-tc-volliq-stat"><span class="hfx-tc-volliq-lbl">Vol 24h</span><span class="hfx-tc-volliq-val">' + (opts.vol24h != null ? fmtUsd(opts.vol24h, 0) : '—') + '</span></div>' +
          '<div class="hfx-tc-volliq-stat"><span class="hfx-tc-volliq-lbl">Liquidity</span><span class="hfx-tc-volliq-val">' + (opts.liquidity != null ? fmtUsd(opts.liquidity, 0) : '—') + '</span></div>' +
        '</div>' : '',
    ].join('');

    targetEl.innerHTML = '';
    targetEl.appendChild(root);

    // Wire side toggle
    root.querySelectorAll('.hfx-tc-side').forEach(function(el) {
      el.onclick = function() { setSide(el.dataset.side); };
    });
    // Wire stake input
    var stakeInput = root.querySelector('#hfxTcStake');
    stakeInput.addEventListener('input', function() {
      var v = parseFloat(stakeInput.value) || 0;
      state.stake = v;
      // Clear chip selection unless an exact match
      root.querySelectorAll('.hfx-tc-chip').forEach(function(c) {
        c.classList.toggle('selected', c.dataset.amt !== 'MAX' && parseFloat(c.dataset.amt) === v);
      });
      paintMath();
    });
    // Wire chips
    root.querySelectorAll('.hfx-tc-chip').forEach(function(chip) {
      chip.onclick = function() {
        var amt = chip.dataset.amt;
        if (amt === 'MAX') {
          var max = (typeof opts.maxStakeFn === 'function') ? Number(opts.maxStakeFn()) : (opts.maxStake || 0);
          if (!isFinite(max) || max <= 0) {
            // No cached balance — point user at the deposit flow but
            // don't block the input; they can type a manual amount.
            chip.textContent = 'Connect →';
            setTimeout(function() { chip.textContent = 'MAX'; }, 1500);
            return;
          }
          stakeInput.value = max.toFixed(2);
          state.stake = max;
        } else {
          stakeInput.value = amt;
          state.stake = parseFloat(amt);
        }
        root.querySelectorAll('.hfx-tc-chip').forEach(function(c) { c.classList.remove('selected'); });
        chip.classList.add('selected');
        paintMath();
      };
    });
    // Wire take area
    var takeBtn = root.querySelector('#hfxTcTakeBtn');
    var takeArea = root.querySelector('#hfxTcTakeArea');
    var takeInput = root.querySelector('#hfxTcTakeInput');
    takeBtn.onclick = function() {
      state.takeOpen = !state.takeOpen;
      takeArea.classList.toggle('open', state.takeOpen);
      takeBtn.textContent = state.takeOpen
        ? '− Close take'
        : '+ Attach your take — posts to your profile when filled';
      if (state.takeOpen) takeInput.focus();
    };
    takeInput.addEventListener('input', function() { state.take = takeInput.value.trim(); });
    // Wire CTA
    root.querySelector('#hfxTcCta').onclick = function() {
      if (state.stake <= 0) return;
      var fn = (typeof opts.onPlaceTrade === 'function') ? opts.onPlaceTrade : defaultPlaceTrade;
      fn(opts, state);
    };

    // Paint state for the first time
    paintMath();

    // ── Internal helpers (closed over `state` + `opts` + `root`) ────
    function setSide(side) {
      state.side = side;
      root.querySelectorAll('.hfx-tc-side').forEach(function(el) {
        el.classList.toggle('selected', el.dataset.side === side);
      });
      paintMath();
    }
    function paintMath() {
      var sel = state.side === 'left' ? opts.left : opts.right;
      var m = calcMath(state.stake, sel.price);
      root.querySelector('#hfxTcShares').textContent  = fmtNum(m.shares, 2);
      root.querySelector('#hfxTcPayout').textContent  = fmtUsd(m.payout, 2);
      root.querySelector('#hfxTcProfit').textContent  = (m.profit > 0 ? '+' : '') + fmtUsd(m.profit, 2);
      root.querySelector('#hfxTcReturn').textContent  = fmtMultiple(m.multiple);
      var fx = flexImpact(state.flexCurrent, state.stake, m.profit);
      root.querySelector('#hfxTcFlexWin').textContent  = '→ ' + fx.win.toLocaleString();
      root.querySelector('#hfxTcFlexLoss').textContent = '/ ' + fx.loss.toLocaleString();
      var cta = root.querySelector('#hfxTcCta');
      var sideLabel = (sel.name || 'Outcome').toUpperCase();
      if (m.shares > 0) {
        cta.textContent = 'Place trade — ' + fmtNum(m.shares, 2) + ' ' + sideLabel + ' @ ' + fmtCents(sel.price) + ' →';
        cta.classList.remove('disabled');
      } else {
        cta.textContent = 'Place trade →';
        cta.classList.add('disabled');
      }
    }

    function renderSide(side, key) {
      // Initial selected-state matches state.side; runtime swaps
      // selected class via setSide.
      var isSelected = (key === state.side);
      var isDog = (key === (opts.left.price < opts.right.price ? 'left' : 'right'));
      var cls = 'hfx-tc-side' + (isSelected ? ' selected' : '') + (isDog ? ' dog' : '');
      var tag = side.tag || (isDog ? 'DOG' : 'FAV');
      return [
        '<div class="' + cls + '" data-side="' + key + '">',
          '<div class="hfx-tc-side-tag">' + tag + '</div>',
          '<div class="hfx-tc-side-name">' + escapeHtml(side.name || 'Outcome') + '</div>',
          '<div class="hfx-tc-side-price">' + fmtCents(side.price) + '</div>',
          '<div class="hfx-tc-side-pct">' + fmtPct(side.price) + ' implied</div>',
        '</div>',
      ].join('');
    }

    function escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
        return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
      });
    }

    // Public handle for the caller: lets fight.html / market.html
    // re-paint when live odds tick without re-mounting the whole panel.
    return {
      updatePrices: function(leftPrice, rightPrice) {
        if (isFinite(leftPrice))  opts.left.price  = leftPrice;
        if (isFinite(rightPrice)) opts.right.price = rightPrice;
        var leftEl  = root.querySelector('.hfx-tc-side[data-side="left"] .hfx-tc-side-price');
        var leftPct = root.querySelector('.hfx-tc-side[data-side="left"] .hfx-tc-side-pct');
        var rightEl  = root.querySelector('.hfx-tc-side[data-side="right"] .hfx-tc-side-price');
        var rightPct = root.querySelector('.hfx-tc-side[data-side="right"] .hfx-tc-side-pct');
        if (leftEl)   leftEl.textContent   = fmtCents(opts.left.price);
        if (leftPct)  leftPct.textContent  = fmtPct(opts.left.price) + ' implied';
        if (rightEl)  rightEl.textContent  = fmtCents(opts.right.price);
        if (rightPct) rightPct.textContent = fmtPct(opts.right.price) + ' implied';
        paintMath();
      },
      setSide: setSide,
      getState: function() { return Object.assign({}, state); },
      destroy: function() { if (root.parentNode) root.parentNode.removeChild(root); },
    };
  }

  window.HFXTradeComposer = { mount: mount, calcMath: calcMath };
})();
