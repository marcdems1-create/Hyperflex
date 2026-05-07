/* UFC 328 banner — Chimaev vs Strickland, 2026-05-09 21:00:00Z (5pm ET).
   Self-injects at top of homepage above the fold. Dismissible, auto-hides
   after fight night. Pulls live odds from Polymarket Gamma + CLOB.
   Single source of truth — included in feed.html and explore.html. */
(function () {
  'use strict';

  // Hard kill: don't render after May 9 2026 23:00 ET (03:00 UTC May 10).
  var KILL_AT = Date.parse('2026-05-10T03:00:00Z');
  if (Date.now() > KILL_AT) return;

  // Honor dismiss.
  try { if (localStorage.getItem('ufc328_dismissed') === '1') return; } catch (_) {}

  // Don't double-inject if both pages somehow load it twice.
  if (document.getElementById('ufc328-banner')) return;

  var FIGHT_AT_UTC = Date.parse('2026-05-09T21:00:00Z'); // 5pm ET = 21:00 UTC
  var FIGHT_URL    = '/fight/ufc-328-chimaev-strickland';

  // Best-known slugs to probe; first one with active markets wins.
  // Polymarket slugs vary; we fall back to a search by event keyword.
  var SLUG_CANDIDATES = [
    'ufc-sea2-kha7-2026-05-09',
    'ufc-328-chimaev-vs-strickland',
    'ufc-chimaev-vs-strickland',
    'will-khamzat-chimaev-defeat-sean-strickland'
  ];

  // ── Styles (scoped via #ufc328-banner) ──────────────────────────────
  var css = ''
    + '#ufc328-banner{position:relative;width:100%;background:'
    +   'radial-gradient(110% 80% at 0% 50%,rgba(255,77,106,.18),transparent 60%),'
    +   'linear-gradient(90deg,#0a0a0f 0%,#180609 60%,#1a0505 100%);'
    +   'border-bottom:1px solid rgba(255,77,106,.28);'
    +   'box-shadow:0 1px 0 rgba(255,255,255,.04) inset,0 8px 24px -16px rgba(255,77,106,.45);'
    +   'overflow:hidden;color:#f1f0f5;font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;'
    +   'z-index:50}'
    + '#ufc328-banner::before{content:"";position:absolute;inset:0;pointer-events:none;'
    +   'background:linear-gradient(135deg,transparent 30%,rgba(255,77,106,.06) 50%,transparent 70%);'
    +   'background-size:200% 200%;animation:ufc328-sheen 8s ease-in-out infinite}'
    + '@keyframes ufc328-sheen{0%,100%{background-position:100% 100%}50%{background-position:0 0}}'
    + '@keyframes ufc328-pulse{0%,100%{opacity:1}50%{opacity:.55}}'
    + '@keyframes ufc328-livepulse{0%,100%{box-shadow:0 0 0 0 rgba(255,77,106,.7)}50%{box-shadow:0 0 0 6px rgba(255,77,106,0)}}'
    + '#ufc328-banner .ufc-wrap{max-width:1440px;margin:0 auto;padding:18px 32px 18px 28px;'
    +   'display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center;min-height:140px}'
    + '#ufc328-banner .ufc-left{display:flex;flex-direction:column;gap:6px;min-width:0}'
    + '#ufc328-banner .ufc-eyebrow{display:inline-flex;align-items:center;gap:8px;'
    +   'font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;font-weight:800;'
    +   'letter-spacing:.18em;text-transform:uppercase;color:#ff4d6a}'
    + '#ufc328-banner .ufc-livedot{width:7px;height:7px;border-radius:50%;background:#ff4d6a;'
    +   'animation:ufc328-livepulse 1.6s infinite}'
    + '#ufc328-banner .ufc-headline{font-family:Anton,Inter,sans-serif;font-weight:400;'
    +   'font-size:clamp(28px,4.2vw,52px);line-height:1;letter-spacing:.01em;color:#fff;'
    +   'text-transform:uppercase;margin:2px 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '#ufc328-banner .ufc-headline em{font-family:"Instrument Serif",serif;font-style:italic;'
    +   'font-weight:400;color:#a0a0b4;margin:0 8px;font-size:.7em;letter-spacing:.02em}'
    + '#ufc328-banner .ufc-sub{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;'
    +   'letter-spacing:.16em;text-transform:uppercase;color:#a0a0b4}'
    + '#ufc328-banner .ufc-right{display:flex;flex-direction:column;align-items:flex-end;gap:10px}'
    + '#ufc328-banner .ufc-clock{display:flex;gap:6px;font-family:"JetBrains Mono",ui-monospace,monospace}'
    + '#ufc328-banner .ufc-cell{display:flex;flex-direction:column;align-items:center;gap:2px;'
    +   'background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.06);'
    +   'border-radius:8px;padding:6px 10px;min-width:54px}'
    + '#ufc328-banner .ufc-num{font-size:22px;font-weight:800;color:#fff;line-height:1;font-variant-numeric:tabular-nums}'
    + '#ufc328-banner .ufc-cell.sec .ufc-num{color:#ff4d6a;animation:ufc328-pulse 1s ease-in-out infinite}'
    + '#ufc328-banner .ufc-lbl{font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:#6b6880}'
    + '#ufc328-banner .ufc-odds{display:flex;align-items:center;gap:10px;font-family:"JetBrains Mono",ui-monospace,monospace;'
    +   'font-size:12px;letter-spacing:.06em;color:#e8e6f0}'
    + '#ufc328-banner .ufc-odds .ufc-pct{font-weight:800;color:#fff}'
    + '#ufc328-banner .ufc-odds .ufc-fav{color:#ff4d6a}'
    + '#ufc328-banner .ufc-odds .ufc-divider{color:#3a3a48}'
    + '#ufc328-banner .ufc-cta{display:inline-flex;align-items:center;gap:8px;'
    +   'background:linear-gradient(180deg,#f5a623,#c9920d);color:#0a0a0f;'
    +   'font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;font-weight:800;'
    +   'letter-spacing:.14em;text-transform:uppercase;text-decoration:none;'
    +   'padding:10px 18px;border-radius:8px;border:1px solid rgba(0,0,0,.2);'
    +   'box-shadow:0 4px 14px -4px rgba(245,166,35,.5);transition:transform .15s,box-shadow .15s}'
    + '#ufc328-banner .ufc-cta:hover{transform:translateY(-1px);box-shadow:0 6px 18px -4px rgba(245,166,35,.7)}'
    + '#ufc328-banner .ufc-close{position:absolute;top:8px;right:10px;background:transparent;'
    +   'border:none;color:#6b6880;font-size:18px;line-height:1;cursor:pointer;padding:4px 8px;'
    +   'border-radius:6px;transition:color .15s,background .15s;font-family:inherit}'
    + '#ufc328-banner .ufc-close:hover{color:#fff;background:rgba(255,255,255,.06)}'
    + '@media (max-width:720px){'
    +   '#ufc328-banner .ufc-wrap{grid-template-columns:1fr;gap:14px;padding:16px 16px 18px;min-height:0}'
    +   '#ufc328-banner .ufc-headline{font-size:clamp(22px,8vw,32px);white-space:normal}'
    +   '#ufc328-banner .ufc-sub{display:none}'
    +   '#ufc328-banner .ufc-right{align-items:stretch}'
    +   '#ufc328-banner .ufc-clock{justify-content:space-between}'
    +   '#ufc328-banner .ufc-cell{flex:1;min-width:0}'
    +   '#ufc328-banner .ufc-cta{justify-content:center;width:100%}'
    + '}';

  // ── DOM ─────────────────────────────────────────────────────────────
  function el(tag, props, html) {
    var n = document.createElement(tag);
    if (props) for (var k in props) n.setAttribute(k, props[k]);
    if (html != null) n.innerHTML = html;
    return n;
  }

  function inject() {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    var banner = el('div', { id: 'ufc328-banner', role: 'region', 'aria-label': 'UFC 328 fight banner' });
    banner.innerHTML = ''
      + '<button class="ufc-close" type="button" aria-label="Dismiss banner" onclick="(function(){try{localStorage.setItem(\'ufc328_dismissed\',\'1\')}catch(_){}var b=document.getElementById(\'ufc328-banner\');if(b)b.remove();})()">×</button>'
      + '<div class="ufc-wrap">'
      +   '<div class="ufc-left">'
      +     '<div class="ufc-eyebrow"><span class="ufc-livedot"></span>UFC 328 · Main Event</div>'
      +     '<div class="ufc-headline">Chimaev <em>vs</em> Strickland</div>'
      +     '<div class="ufc-sub">Middleweight Title · May 9 · Newark</div>'
      +   '</div>'
      +   '<div class="ufc-right">'
      +     '<div class="ufc-clock" id="ufc328-clock">'
      +       '<div class="ufc-cell"><span class="ufc-num" id="ufc-d">--</span><span class="ufc-lbl">days</span></div>'
      +       '<div class="ufc-cell"><span class="ufc-num" id="ufc-h">--</span><span class="ufc-lbl">hrs</span></div>'
      +       '<div class="ufc-cell"><span class="ufc-num" id="ufc-m">--</span><span class="ufc-lbl">min</span></div>'
      +       '<div class="ufc-cell sec"><span class="ufc-num" id="ufc-s">--</span><span class="ufc-lbl">sec</span></div>'
      +     '</div>'
      +     '<div class="ufc-odds" id="ufc328-odds" style="opacity:.35"><span>Loading odds…</span></div>'
      +     '<a class="ufc-cta" href="' + FIGHT_URL + '">View Fight →</a>'
      +   '</div>'
      + '</div>';

    // Insert before the first non-script/style sibling under <body>, after #nav-root.
    var nav = document.getElementById('nav-root');
    if (nav && nav.parentNode) {
      // Insert AFTER nav-root and any immediate <script>s that follow it.
      var anchor = nav.nextSibling;
      while (anchor && anchor.nodeType === 1 && (anchor.tagName === 'SCRIPT' || anchor.tagName === 'STYLE')) {
        anchor = anchor.nextSibling;
      }
      nav.parentNode.insertBefore(banner, anchor);
    } else {
      document.body.insertBefore(banner, document.body.firstChild);
    }

    startCountdown();
    fetchOdds();
  }

  // ── Countdown ───────────────────────────────────────────────────────
  function pad(n) { n = Math.max(0, n | 0); return n < 10 ? '0' + n : '' + n; }
  function startCountdown() {
    function tick() {
      var ms = FIGHT_AT_UTC - Date.now();
      if (ms <= 0) {
        var clock = document.getElementById('ufc328-clock');
        if (clock) clock.innerHTML = '<div class="ufc-cell" style="min-width:0;padding:8px 14px"><span class="ufc-num" style="color:#ff4d6a">LIVE</span><span class="ufc-lbl">now</span></div>';
        return; // stop ticking
      }
      var s = Math.floor(ms / 1000);
      var d = Math.floor(s / 86400); s -= d * 86400;
      var h = Math.floor(s / 3600);  s -= h * 3600;
      var m = Math.floor(s / 60);    s -= m * 60;
      var dEl = document.getElementById('ufc-d'); if (dEl) dEl.textContent = pad(d);
      var hEl = document.getElementById('ufc-h'); if (hEl) hEl.textContent = pad(h);
      var mEl = document.getElementById('ufc-m'); if (mEl) mEl.textContent = pad(m);
      var sEl = document.getElementById('ufc-s'); if (sEl) sEl.textContent = pad(s);
      setTimeout(tick, 1000);
    }
    tick();
  }

  // ── Odds (Polymarket Gamma → CLOB best-ask) ─────────────────────────
  // We try a slug list first; if all miss, fall back to a search by name.
  // Cache-bust: 30s window so quick reloads share the same fetch.
  var _oddsCache = null;
  function paintOdds(c, s) {
    var box = document.getElementById('ufc328-odds');
    if (!box) return;
    if (c == null || s == null) {
      box.style.opacity = '.55';
      box.innerHTML = '<span style="font-size:11px;color:#6b6880">Live odds unavailable</span>';
      return;
    }
    var cPct = Math.round(c * 100);
    var sPct = Math.round(s * 100);
    var cFav = cPct >= sPct;
    box.style.opacity = '1';
    box.innerHTML = ''
      + '<span class="' + (cFav ? 'ufc-fav' : '') + '">CHIMAEV <span class="ufc-pct">' + cPct + '%</span></span>'
      + '<span class="ufc-divider">·</span>'
      + '<span class="' + (!cFav ? 'ufc-fav' : '') + '">STRICKLAND <span class="ufc-pct">' + sPct + '%</span></span>';
  }

  function pickProb(market) {
    if (!market) return null;
    // outcomePrices is a JSON string like "[\"0.82\",\"0.18\"]"
    var p = market.outcomePrices;
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch (_) { return null; } }
    if (!Array.isArray(p) || p.length < 2) return null;
    var yes = parseFloat(p[0]);
    if (isNaN(yes)) return null;
    return yes; // YES probability
  }

  // Polymarket UFC fights are EVENTS with multiple sub-markets (winner,
  // method-of-victory, etc.). markets?slug= returns [] for an event slug —
  // we have to hit events?slug= and pull markets from event.markets, then
  // pick the binary winner-market by both fighter names + 24h volume.
  function pickBestMarket(markets) {
    if (!Array.isArray(markets) || !markets.length) return null;
    var withBoth = markets.filter(function (m) {
      if (m.closed === true) return false;
      var q = ((m.question || '') + ' ' + (m.slug || '')).toLowerCase();
      return q.indexOf('chimaev') !== -1 && q.indexOf('strickland') !== -1;
    });
    var pool = withBoth.length ? withBoth : markets.filter(function (m) { return m.closed !== true; });
    if (!pool.length) pool = markets;
    pool.sort(function (a, b) {
      var av = parseFloat(a.volume24hr) || parseFloat(a.volume_24hr) || parseFloat(a.volumeNum) || parseFloat(a.volume) || 0;
      var bv = parseFloat(b.volume24hr) || parseFloat(b.volume_24hr) || parseFloat(b.volumeNum) || parseFloat(b.volume) || 0;
      return bv - av;
    });
    return pool[0] || null;
  }

  function fetchOdds() {
    if (_oddsCache && (Date.now() - _oddsCache.ts < 30000)) {
      paintOdds(_oddsCache.c, _oddsCache.s);
      return;
    }

    function tryEvent(s) {
      return fetch('https://gamma-api.polymarket.com/events?slug=' + encodeURIComponent(s))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (arr) {
          if (!Array.isArray(arr) || !arr.length) return null;
          var picked = pickBestMarket(arr[0].markets || []);
          if (picked) console.log('[ufc328] matched via events?slug=' + s, picked.question || picked.slug);
          return picked;
        })
        .catch(function (e) { console.warn('[ufc328] events?slug=' + s + ' threw', e.message); return null; });
    }
    function tryMarket(s) {
      return fetch('https://gamma-api.polymarket.com/markets?slug=' + encodeURIComponent(s))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (arr) {
          if (!Array.isArray(arr) || !arr.length) return null;
          console.log('[ufc328] matched via markets?slug=' + s, arr[0].question);
          return arr[0];
        })
        .catch(function (e) { console.warn('[ufc328] markets?slug=' + s + ' threw', e.message); return null; });
    }
    function trySearch(q) {
      return fetch('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=20&order=volume24hr&ascending=false&question_search=' + encodeURIComponent(q))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (arr) {
          var picked = pickBestMarket(arr);
          if (picked) console.log('[ufc328] matched via question_search=' + q, picked.question);
          return picked;
        })
        .catch(function (e) { console.warn('[ufc328] question_search=' + q + ' threw', e.message); return null; });
    }

    var chain = Promise.resolve(null);
    SLUG_CANDIDATES.forEach(function (s) { chain = chain.then(function (r) { return r || tryEvent(s); }); });
    SLUG_CANDIDATES.forEach(function (s) { chain = chain.then(function (r) { return r || tryMarket(s); }); });
    ['Chimaev', 'Strickland'].forEach(function (q) { chain = chain.then(function (r) { return r || trySearch(q); }); });

    chain.then(function (market) {
      if (market) return resolveMarket(market);
      console.warn('[ufc328] all strategies exhausted, no Polymarket match');
      paintOdds(null, null);
    });
  }

  function resolveMarket(market) {
    var prob = pickProb(market);
    if (prob == null) { paintOdds(null, null); return; }
    // Map to (chimaev, strickland) — assume YES = "Chimaev wins" if question
    // mentions Chimaev as the subject. If reversed, flip.
    var q = (market.question || '').toLowerCase();
    var c, s;
    if (q.indexOf('chimaev') !== -1 && q.indexOf('strickland') !== -1) {
      // Phrasing typically: "Will Chimaev defeat Strickland?" → YES = Chimaev
      c = prob; s = 1 - prob;
    } else if (q.indexOf('strickland') !== -1) {
      c = 1 - prob; s = prob;
    } else {
      c = prob; s = 1 - prob;
    }
    _oddsCache = { ts: Date.now(), c: c, s: s };
    paintOdds(c, s);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
