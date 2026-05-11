/* Rolling Hero Banner — replaces the static UFC 328 banner.
   Fetches /api/hero-banner on load and injects above the fold (after
   #nav-root, matching the prior banner's placement). Two render modes
   per server-side selection:
     - imminent (≤7 days): countdown to seconds, "PLACE YOUR BET" framing
     - anchor   (>7 days): days counter + volume stat, "THE BIGGEST MARKET"
   Server returns null when nothing qualifies → slot collapses entirely
   (no empty placeholder). Single source of truth — included in feed.html
   and explore.html. */
(function () {
  'use strict';

  if (document.getElementById('hero-banner')) return;

  // Honor dismiss across the session — same UX as the prior banner.
  try { if (localStorage.getItem('hero_banner_dismissed') === '1') return; } catch (_) {}

  // ── Styles ──────────────────────────────────────────────────────────
  var css = ''
    + '#hero-banner{position:relative;width:100%;background:'
    +   'radial-gradient(110% 80% at 0% 50%,rgba(201,146,13,.18),transparent 60%),'
    +   'linear-gradient(90deg,#0a0a0f 0%,#181208 60%,#1a1605 100%);'
    +   'border-bottom:1px solid rgba(201,146,13,.28);'
    +   'box-shadow:0 1px 0 rgba(255,255,255,.04) inset,0 8px 24px -16px rgba(201,146,13,.4);'
    +   'overflow:hidden;color:#f1f0f5;font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;'
    +   'z-index:50}'
    + '#hero-banner.hb-anchor{background:'
    +   'radial-gradient(110% 80% at 0% 50%,rgba(77,159,255,.14),transparent 60%),'
    +   'linear-gradient(90deg,#0a0a0f 0%,#0a1018 60%,#0a1422 100%);'
    +   'border-bottom-color:rgba(77,159,255,.22);'
    +   'box-shadow:0 1px 0 rgba(255,255,255,.04) inset,0 8px 24px -16px rgba(77,159,255,.35)}'
    + '#hero-banner::before{content:"";position:absolute;inset:0;pointer-events:none;'
    +   'background:linear-gradient(135deg,transparent 30%,rgba(201,146,13,.05) 50%,transparent 70%);'
    +   'background-size:200% 200%;animation:hb-sheen 9s ease-in-out infinite}'
    + '#hero-banner.hb-anchor::before{background:linear-gradient(135deg,transparent 30%,rgba(77,159,255,.04) 50%,transparent 70%);'
    +   'background-size:200% 200%;animation:hb-sheen 11s ease-in-out infinite}'
    + '@keyframes hb-sheen{0%,100%{background-position:100% 100%}50%{background-position:0 0}}'
    + '@keyframes hb-pulse{0%,100%{opacity:1}50%{opacity:.55}}'
    + '@keyframes hb-livepulse{0%,100%{box-shadow:0 0 0 0 rgba(201,146,13,.7)}50%{box-shadow:0 0 0 6px rgba(201,146,13,0)}}'
    + '#hero-banner .hb-wrap{max-width:1600px;margin:0 auto;padding:18px 32px 18px 28px;'
    +   'display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center;min-height:140px}'
    + '#hero-banner .hb-left{display:flex;flex-direction:column;gap:6px;min-width:0}'
    + '#hero-banner .hb-eyebrow{display:inline-flex;align-items:center;gap:8px;'
    +   'font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;font-weight:800;'
    +   'letter-spacing:.18em;text-transform:uppercase;color:#c9920d}'
    + '#hero-banner.hb-anchor .hb-eyebrow{color:#4d9fff}'
    + '#hero-banner .hb-livedot{width:7px;height:7px;border-radius:50%;background:#c9920d;'
    +   'animation:hb-livepulse 1.6s infinite}'
    + '#hero-banner.hb-anchor .hb-livedot{background:#4d9fff;animation:none;opacity:.7}'
    + '#hero-banner .hb-headline{font-family:Anton,Inter,sans-serif;font-weight:400;'
    +   'font-size:clamp(28px,4.2vw,52px);line-height:1;letter-spacing:.01em;color:#fff;'
    +   'text-transform:uppercase;margin:2px 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '#hero-banner .hb-sub{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;'
    +   'letter-spacing:.16em;text-transform:uppercase;color:#a0a0b4}'
    + '#hero-banner .hb-right{display:flex;flex-direction:column;align-items:flex-end;gap:10px}'
    + '#hero-banner .hb-clock{display:flex;gap:6px;font-family:"JetBrains Mono",ui-monospace,monospace}'
    + '#hero-banner .hb-cell{display:flex;flex-direction:column;align-items:center;gap:2px;'
    +   'background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.06);'
    +   'border-radius:8px;padding:6px 10px;min-width:54px}'
    + '#hero-banner .hb-num{font-size:22px;font-weight:800;color:#fff;line-height:1;font-variant-numeric:tabular-nums}'
    + '#hero-banner .hb-cell.sec .hb-num{color:#c9920d;animation:hb-pulse 1s ease-in-out infinite}'
    + '#hero-banner .hb-lbl{font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:#6b6880}'
    + '#hero-banner .hb-bigday{font-family:"JetBrains Mono",ui-monospace,monospace;'
    +   'font-size:34px;font-weight:800;color:#fff;line-height:1;font-variant-numeric:tabular-nums;'
    +   'text-align:right}'
    + '#hero-banner .hb-bigday small{font-size:11px;letter-spacing:.14em;color:#6b6880;'
    +   'font-weight:700;display:block;margin-top:4px;text-transform:uppercase}'
    + '#hero-banner .hb-stat{display:flex;align-items:center;gap:10px;'
    +   'font-family:"JetBrains Mono",ui-monospace,monospace;'
    +   'font-size:12px;letter-spacing:.06em;color:#e8e6f0}'
    + '#hero-banner .hb-stat strong{color:#fff;font-weight:800}'
    + '#hero-banner .hb-cta{display:inline-flex;align-items:center;gap:8px;'
    +   'background:linear-gradient(180deg,#f5a623,#c9920d);color:#0a0a0f;'
    +   'font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;font-weight:800;'
    +   'letter-spacing:.14em;text-transform:uppercase;text-decoration:none;'
    +   'padding:10px 18px;border-radius:8px;border:1px solid rgba(0,0,0,.2);'
    +   'box-shadow:0 4px 14px -4px rgba(245,166,35,.5);transition:transform .15s,box-shadow .15s}'
    + '#hero-banner.hb-anchor .hb-cta{background:linear-gradient(180deg,#5fb0ff,#3b82f6);'
    +   'box-shadow:0 4px 14px -4px rgba(77,159,255,.45)}'
    + '#hero-banner .hb-cta:hover{transform:translateY(-1px);box-shadow:0 6px 18px -4px rgba(245,166,35,.7)}'
    + '#hero-banner.hb-anchor .hb-cta:hover{box-shadow:0 6px 18px -4px rgba(77,159,255,.65)}'
    + '#hero-banner .hb-close{position:absolute;top:8px;right:10px;background:transparent;'
    +   'border:none;color:#6b6880;font-size:18px;line-height:1;cursor:pointer;padding:4px 8px;'
    +   'border-radius:6px;transition:color .15s,background .15s;font-family:inherit}'
    + '#hero-banner .hb-close:hover{color:#fff;background:rgba(255,255,255,.06)}'
    + '@media (max-width:720px){'
    +   '#hero-banner .hb-wrap{grid-template-columns:1fr;gap:14px;padding:16px 16px 18px;min-height:0}'
    +   '#hero-banner .hb-headline{font-size:clamp(22px,8vw,32px);white-space:normal}'
    +   '#hero-banner .hb-sub{display:none}'
    +   '#hero-banner .hb-right{align-items:stretch}'
    +   '#hero-banner .hb-clock{justify-content:space-between}'
    +   '#hero-banner .hb-cell{flex:1;min-width:0}'
    +   '#hero-banner .hb-bigday{text-align:left}'
    +   '#hero-banner .hb-cta{justify-content:center;width:100%}'
    + '}';

  function pad(n) { n = Math.max(0, n | 0); return n < 10 ? '0' + n : '' + n; }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderImminent(banner) {
    return ''
      + '<div class="hb-wrap">'
      +   '<div class="hb-left">'
      +     '<div class="hb-eyebrow"><span class="hb-livedot"></span>Place Your Bet'
      +       (banner.category ? ' · ' + escapeHtml(banner.category) : '')
      +     '</div>'
      +     '<div class="hb-headline">' + escapeHtml(banner.event_title) + '</div>'
      +     '<div class="hb-sub">' + escapeHtml(banner.headline_stat) + '</div>'
      +   '</div>'
      +   '<div class="hb-right">'
      +     '<div class="hb-clock" id="hb-clock">'
      +       '<div class="hb-cell"><span class="hb-num" id="hb-d">--</span><span class="hb-lbl">days</span></div>'
      +       '<div class="hb-cell"><span class="hb-num" id="hb-h">--</span><span class="hb-lbl">hrs</span></div>'
      +       '<div class="hb-cell"><span class="hb-num" id="hb-m">--</span><span class="hb-lbl">min</span></div>'
      +       '<div class="hb-cell sec"><span class="hb-num" id="hb-s">--</span><span class="hb-lbl">sec</span></div>'
      +     '</div>'
      +     '<a class="hb-cta" href="' + escapeHtml(banner.cta_href) + '">' + escapeHtml(banner.cta_label) + ' →</a>'
      +   '</div>'
      + '</div>';
  }

  function renderAnchor(banner) {
    return ''
      + '<div class="hb-wrap">'
      +   '<div class="hb-left">'
      +     '<div class="hb-eyebrow"><span class="hb-livedot"></span>The Biggest Market'
      +       (banner.category ? ' · ' + escapeHtml(banner.category) : '')
      +     '</div>'
      +     '<div class="hb-headline">' + escapeHtml(banner.event_title) + '</div>'
      +     '<div class="hb-stat">' + escapeHtml(banner.headline_stat) + '</div>'
      +   '</div>'
      +   '<div class="hb-right">'
      +     '<div class="hb-bigday">' + banner.days_until_end + '<small>days to resolution</small></div>'
      +     '<a class="hb-cta" href="' + escapeHtml(banner.cta_href) + '">' + escapeHtml(banner.cta_label) + ' →</a>'
      +   '</div>'
      + '</div>';
  }

  function inject(banner) {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    var wrapper = document.createElement('div');
    wrapper.id = 'hero-banner';
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', escapeHtml(banner.event_title));
    if (banner.mode === 'anchor') wrapper.classList.add('hb-anchor');

    var html = ''
      + '<button class="hb-close" type="button" aria-label="Dismiss banner" '
      +   'onclick="(function(){try{localStorage.setItem(\'hero_banner_dismissed\',\'1\')}catch(_){}var b=document.getElementById(\'hero-banner\');if(b)b.remove();})()">×</button>';
    html += banner.mode === 'imminent' ? renderImminent(banner) : renderAnchor(banner);
    wrapper.innerHTML = html;

    var nav = document.getElementById('nav-root');
    if (nav && nav.parentNode) {
      var anchor = nav.nextSibling;
      while (anchor && anchor.nodeType === 1 && (anchor.tagName === 'SCRIPT' || anchor.tagName === 'STYLE')) {
        anchor = anchor.nextSibling;
      }
      nav.parentNode.insertBefore(wrapper, anchor);
    } else {
      document.body.insertBefore(wrapper, document.body.firstChild);
    }

    if (banner.mode === 'imminent' && banner.end_date) {
      startCountdown(banner.end_date);
    }
  }

  function startCountdown(endDateIso) {
    var endTs = Date.parse(endDateIso);
    if (!Number.isFinite(endTs)) return;
    var dEl = document.getElementById('hb-d');
    var hEl = document.getElementById('hb-h');
    var mEl = document.getElementById('hb-m');
    var sEl = document.getElementById('hb-s');
    function tick() {
      var ms = endTs - Date.now();
      if (ms <= 0) {
        var clock = document.getElementById('hb-clock');
        if (clock) clock.innerHTML = '<div class="hb-cell" style="min-width:0;padding:8px 14px"><span class="hb-num" style="color:#c9920d">LIVE</span><span class="hb-lbl">now</span></div>';
        return;
      }
      var s = Math.floor(ms / 1000);
      var d = Math.floor(s / 86400); s -= d * 86400;
      var h = Math.floor(s / 3600);  s -= h * 3600;
      var m = Math.floor(s / 60);    s -= m * 60;
      if (dEl) dEl.textContent = pad(d);
      if (hEl) hEl.textContent = pad(h);
      if (mEl) mEl.textContent = pad(m);
      if (sEl) sEl.textContent = pad(s);
      setTimeout(tick, 1000);
    }
    tick();
  }

  function start() {
    fetch('/api/hero-banner')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.event_slug) return;  // null payload → collapse slot
        if (document.getElementById('hero-banner')) return;
        inject(data);
      })
      .catch(function (e) { console.warn('[hero-banner] fetch failed:', e && e.message); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
