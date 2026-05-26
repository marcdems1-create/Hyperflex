/**
 * hfx-engage.js — HYPERFLEX global engagement engine
 * Inject on every page. Handles:
 *   - Toast notification stack (bottom-right)
 *   - Whale FOMO alerts (poll every 45s)
 *   - Win/loss celebration (confetti on correct take)
 *   - Live market countdown timers
 *   - Daily challenge streak warning
 *   - Market pulse badge injection
 *   - Price ticker live refresh
 */
(function () {
  'use strict';

  /* ─────────────────────── TOAST ENGINE ─────────────────────── */
  var _toastContainer = null;
  var _toastCount = 0;

  function _ensureContainer() {
    if (_toastContainer) return;
    _toastContainer = document.createElement('div');
    _toastContainer.id = 'hfx-toast-wrap';
    _toastContainer.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px', 'z-index:99999',
      'display:flex', 'flex-direction:column-reverse', 'gap:10px',
      'max-width:340px', 'pointer-events:none',
    ].join(';');
    document.body.appendChild(_toastContainer);
  }

  var _ACCENT = {
    whale:   { border: '#c9920d', icon: '◆', bg: 'rgba(201,146,13,.1)'  },
    win:     { border: '#00e68a', icon: '✓',  bg: 'rgba(0,230,138,.1)'  },
    loss:    { border: '#ff4d6a', icon: '×',  bg: 'rgba(255,77,106,.08)' },
    streak:  { border: '#4d9fff', icon: '↑',  bg: 'rgba(77,159,255,.1)'  },
    warning: { border: '#f59e0b', icon: '!',  bg: 'rgba(245,158,11,.1)'  },
    agree:   { border: '#a855f7', icon: '↑',  bg: 'rgba(168,85,247,.1)'  },
    info:    { border: 'rgba(255,255,255,.2)', icon: '·', bg: 'rgba(255,255,255,.04)' },
  };

  window.HFX = window.HFX || {};

  window.HFX.toast = function (opts) {
    /* opts: { type, title, body, href, duration } */
    _ensureContainer();
    var type = opts.type || 'info';
    var ac = _ACCENT[type] || _ACCENT.info;
    var id = 'hfxt-' + (++_toastCount);
    var dur = opts.duration != null ? opts.duration : (type === 'whale' ? 9000 : 6000);

    var el = document.createElement('div');
    el.id = id;
    el.style.cssText = [
      'pointer-events:auto',
      'background:#111118',
      'border:1px solid ' + ac.border,
      'border-left:3px solid ' + ac.border,
      'border-radius:8px',
      'padding:12px 14px',
      'display:flex', 'align-items:flex-start', 'gap:10px',
      'box-shadow:0 8px 32px rgba(0,0,0,.6)',
      'cursor:' + (opts.href ? 'pointer' : 'default'),
      'transition:opacity .3s,transform .3s',
      'opacity:0', 'transform:translateX(20px)',
      'font-family:"JetBrains Mono",monospace',
      'background:' + ac.bg,
    ].join(';');

    el.innerHTML =
      '<div style="font-size:14px;color:' + ac.border + ';flex-shrink:0;line-height:1;margin-top:2px;">' + ac.icon + '</div>' +
      '<div style="flex:1;min-width:0;">' +
        (opts.title ? '<div style="font-size:11px;font-weight:700;color:#f0f0f5;letter-spacing:.04em;margin-bottom:3px;">' + _esc(opts.title) + '</div>' : '') +
        (opts.body  ? '<div style="font-size:10px;color:rgba(240,240,245,.55);line-height:1.4;">' + _esc(opts.body)  + '</div>' : '') +
      '</div>' +
      '<button style="background:none;border:none;color:rgba(240,240,245,.3);cursor:pointer;font-size:14px;padding:0;flex-shrink:0;line-height:1;" aria-label="Dismiss">×</button>';

    el.querySelector('button').onclick = function (e) { e.stopPropagation(); _dismiss(el); };
    if (opts.href) el.onclick = function () { window.location.href = opts.href; };

    _toastContainer.appendChild(el);
    requestAnimationFrame(function () {
      el.style.opacity = '1';
      el.style.transform = 'translateX(0)';
    });

    if (dur > 0) setTimeout(function () { _dismiss(el); }, dur);
    return el;
  };

  function _dismiss(el) {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
  }

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ─────────────────────── WHALE FOMO TOASTS ─────────────────────── */
  var _lastWhaleId = null;
  var _whaleSeenIds = new Set();
  var _whaleShownCount = 0;
  var _WHALE_POLL_MS = 45000;
  var _WHALE_MAX_PER_LOAD = 2; // don't spam on first load

  function _fetchWhaleAlerts() {
    var url = '/api/whale-stream/recent?limit=5' + (_lastWhaleId ? '&since=' + encodeURIComponent(_lastWhaleId) : '');
    fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !Array.isArray(d.new_since)) return;
      var fresh = d.new_since.filter(function (e) { return !_whaleSeenIds.has(e.id); });
      if (fresh.length && d.events && d.events[0]) _lastWhaleId = d.events[0].id;
      fresh.forEach(function (e) { _whaleSeenIds.add(e.id); });

      // On cold load, skip the backlog — just seed the seen set
      if (_whaleShownCount === 0 && fresh.length > 0) {
        _whaleShownCount = -1; // mark as seeded
        return;
      }
      if (_whaleShownCount === -1) _whaleShownCount = 0;

      fresh.slice(0, _WHALE_MAX_PER_LOAD).forEach(function (e, i) {
        setTimeout(function () {
          var action = e.action === 'opened' ? 'entered' : e.action === 'increased' ? 'added to' : e.action;
          var size = e.size_display || '';
          var q = (e.question || '').slice(0, 60) + ((e.question || '').length > 60 ? '…' : '');
          var side = e.side ? ' ' + e.side : '';
          window.HFX.toast({
            type: 'whale',
            title: (e.trader_name || 'Whale') + ' ' + action + ' ' + size + side,
            body: q,
            href: e.slug ? '/market/' + e.slug : null,
            duration: 10000,
          });
          _whaleShownCount++;
        }, i * 1800);
      });
    }).catch(function () {});
  }

  // Start polling after a 4s delay (let page paint first)
  setTimeout(function () {
    _fetchWhaleAlerts();
    setInterval(_fetchWhaleAlerts, _WHALE_POLL_MS);
  }, 4000);

  /* ─────────────────────── WIN CELEBRATION (CONFETTI) ─────────────────────── */
  var _confettiLoaded = false;
  var _confettiQueue = [];

  function _loadConfetti(cb) {
    if (_confettiLoaded) { cb(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js';
    s.onload = function () { _confettiLoaded = true; cb(); _confettiQueue.forEach(function (f) { f(); }); _confettiQueue = []; };
    s.onerror = function () {};
    document.head.appendChild(s);
  }

  window.HFX.celebrate = function (opts) {
    /* opts: { question, units, side, entry_price, winRate, streak } — call on correct resolution */
    opts = opts || {};
    _loadConfetti(function () {
      if (typeof confetti !== 'function') return;
      confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 }, colors: ['#00e68a','#4d9fff','#c9920d','#fff'] });
      setTimeout(function () { confetti({ particleCount: 60, spread: 100, origin: { y: 0.5 } }); }, 400);
    });
    var units = opts.units ? (opts.units > 0 ? '+' + opts.units.toFixed(2) + 'u' : opts.units.toFixed(2) + 'u') : null;
    window.HFX.toast({
      type: 'win',
      title: 'Pick landed.' + (units ? ' ' + units + '.' : ''),
      body: opts.question ? opts.question.slice(0, 72) : null,
      duration: 8000,
    });
    // Win card overlay — shareable DraftKings-style receipt
    setTimeout(function () { _showWinCard(opts); }, 1200);
  };

  function _showWinCard(opts) {
    var existing = document.getElementById('hfx-win-card-overlay');
    if (existing) existing.remove();

    var q = (opts.question || '').slice(0, 90);
    var side = (opts.side || 'YES').toUpperCase();
    var entry = opts.entry_price ? Math.round(opts.entry_price * 100) + '¢' : '';
    var wr = opts.winRate ? Math.round(opts.winRate * 100) + '%' : null;
    var streak = opts.streak || null;
    var tweetText = 'Called it on HYPERFLEX' +
      (q ? ': ' + q : '') +
      (entry ? ' at ' + entry : '') +
      '. Track record: hyperflex.network';

    var overlay = document.createElement('div');
    overlay.id = 'hfx-win-card-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;';

    overlay.innerHTML = [
      '<div style="background:linear-gradient(145deg,#0a1a12 0%,#0d2018 100%);border:1px solid rgba(0,230,138,.25);border-radius:16px;padding:32px 28px;width:90%;max-width:400px;position:relative;box-shadow:0 0 60px rgba(0,230,138,.12);">',
        '<button onclick="document.getElementById(\'hfx-win-card-overlay\').remove()" style="position:absolute;top:14px;right:16px;background:none;border:none;color:rgba(240,240,245,.3);font-size:18px;cursor:pointer;line-height:1;">×</button>',
        '<div style="font-family:monospace;font-size:9px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:rgba(0,230,138,.6);margin-bottom:14px;">CORRECT</div>',
        '<div style="font-size:18px;font-weight:800;color:#f0f0f5;line-height:1.4;margin-bottom:20px;">' + (q || 'Market resolved.') + '</div>',
        '<div style="display:flex;gap:10px;margin-bottom:20px;">',
          '<div style="flex:1;background:rgba(0,230,138,.08);border:1px solid rgba(0,230,138,.15);border-radius:8px;padding:14px;text-align:center;">',
            '<div style="font-family:monospace;font-size:20px;font-weight:900;color:#00e68a;">' + side + '</div>',
            '<div style="font-size:10px;letter-spacing:.1em;color:rgba(240,240,245,.35);text-transform:uppercase;margin-top:4px;">Side</div>',
          '</div>',
          (entry ? '<div style="flex:1;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:14px;text-align:center;"><div style="font-family:monospace;font-size:20px;font-weight:900;color:#f0f0f5;">' + entry + '</div><div style="font-size:10px;letter-spacing:.1em;color:rgba(240,240,245,.35);text-transform:uppercase;margin-top:4px;">Entry</div></div>' : ''),
          (wr ? '<div style="flex:1;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:14px;text-align:center;"><div style="font-family:monospace;font-size:20px;font-weight:900;color:#c9920d;">' + wr + '</div><div style="font-size:10px;letter-spacing:.1em;color:rgba(240,240,245,.35);text-transform:uppercase;margin-top:4px;">Win rate</div></div>' : ''),
        '</div>',
        (streak && streak >= 3 ? '<div style="font-size:12px;color:rgba(245,158,11,.8);font-family:monospace;font-weight:700;margin-bottom:16px;">' + streak + '-pick win streak.</div>' : ''),
        '<div style="display:flex;gap:10px;">',
          '<button onclick="window.open(\'https://twitter.com/intent/tweet?text=\'+encodeURIComponent(\'' + tweetText.replace(/'/g, "\\'") + '\'),\'_blank\',\'width=600,height=400\')" style="flex:1;background:#1da1f2;color:#fff;border:none;border-radius:8px;padding:13px;font-weight:700;font-size:13px;cursor:pointer;letter-spacing:.04em;">Post on X</button>',
          '<button onclick="navigator.clipboard&&navigator.clipboard.writeText(\'' + tweetText.replace(/'/g, "\\'") + '\').then(function(){window.HFX&&window.HFX.toast({type:\'info\',title:\'Copied.\',duration:2500})})" style="background:none;border:1px solid rgba(255,255,255,.1);color:rgba(240,240,245,.6);border-radius:8px;padding:13px 18px;font-size:13px;cursor:pointer;">Copy</button>',
        '</div>',
        '<div style="margin-top:14px;font-size:10px;font-family:monospace;color:rgba(240,240,245,.2);letter-spacing:.06em;">HYPERFLEX · hyperflex.network</div>',
      '</div>',
    ].join('');

    document.body.appendChild(overlay);
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
  }

  window.HFX.showLoss = function (opts) {
    opts = opts || {};
    var units = opts.units ? opts.units.toFixed(2) + 'u' : null;
    window.HFX.toast({
      type: 'loss',
      title: 'Resolved a loss.' + (units ? ' ' + units + '.' : ''),
      body: opts.closeness != null && opts.closeness <= 12
        ? 'Called it right directionally. ' + opts.closeness + '¢ off.'
        : (opts.question ? opts.question.slice(0, 60) : null),
      duration: 7000,
    });
  };

  /* ─────────────────────── STREAK WARNING ─────────────────────── */
  function _checkStreakWarning() {
    // Only fire once per session
    if (sessionStorage.getItem('hfx_streak_warned')) return;
    fetch('/api/daily-pick').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return;
      var streak = d.streak || 0;
      var voted = d.user_vote;
      if (streak >= 2 && !voted) {
        // Has a streak but hasn't voted today — risk of losing it
        var today = new Date();
        var midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
        var hoursLeft = Math.round((midnight - today) / 3600000);
        if (hoursLeft <= 6) {
          sessionStorage.setItem('hfx_streak_warned', '1');
          window.HFX.toast({
            type: 'warning',
            title: streak + '-day streak at risk.',
            body: 'Vote on today\'s pick before midnight to keep it alive.',
            href: '/',
            duration: 12000,
          });
        }
      }
    }).catch(function () {});
  }

  setTimeout(_checkStreakWarning, 8000);

  /* ─────────────────────── COUNTDOWN TIMERS ─────────────────────── */
  function _fmtCountdown(ms) {
    if (ms <= 0) return 'Resolving';
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60); s %= 60;
    var h = Math.floor(m / 60); m %= 60;
    var d = Math.floor(h / 24); h %= 24;
    if (d > 7)  return null; // don't show countdown for far-future
    if (d > 0)  return d + 'd ' + h + 'h';
    if (h > 0)  return h + 'h ' + m + 'm';
    return m + 'm ' + s + 's';
  }

  function _urgencyColor(ms) {
    var h = ms / 3600000;
    if (h <= 1) return '#ff4d6a';
    if (h <= 6) return '#f59e0b';
    if (h <= 24) return '#c9920d';
    return null;
  }

  var _cdElements = []; // [{el, endMs}]
  var _cdTimer = null;

  window.HFX.watchCountdown = function (el, endDateStr) {
    var endMs = new Date(endDateStr).getTime();
    if (isNaN(endMs)) return;
    _cdElements.push({ el: el, endMs: endMs });
    if (!_cdTimer) {
      _cdTimer = setInterval(function () {
        var now = Date.now();
        _cdElements = _cdElements.filter(function (item) {
          if (!document.contains(item.el)) return false;
          var left = item.endMs - now;
          var label = _fmtCountdown(left);
          if (!label) { item.el.style.display = 'none'; return false; }
          item.el.textContent = label;
          var col = _urgencyColor(left);
          if (col) {
            item.el.style.color = col;
            if (left <= 3600000) item.el.style.fontWeight = '700';
          }
          return left > 0;
        });
      }, 1000);
    }
  };

  /* ─────────────────────── MARKET PULSE BADGES ─────────────────────── */
  window.HFX.injectPulseBadges = function () {
    fetch('/api/market-pulse').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !Array.isArray(d.movers)) return;
      d.movers.forEach(function (m) {
        if (!m.slug) return;
        var cards = document.querySelectorAll('[data-slug="' + m.slug + '"], [href*="/market/' + m.slug + '"]');
        cards.forEach(function (card) {
          if (card.querySelector('.hfx-pulse-badge')) return;
          var chg = m.price_change;
          if (!chg || Math.abs(chg) < 3) return;
          var badge = document.createElement('span');
          badge.className = 'hfx-pulse-badge';
          var dir = chg > 0 ? '↑' : '↓';
          badge.textContent = dir + Math.abs(chg).toFixed(0) + '¢';
          badge.style.cssText = [
            'font-family:"JetBrains Mono",monospace',
            'font-size:9px', 'font-weight:700',
            'padding:2px 6px', 'border-radius:3px',
            'color:' + (chg > 0 ? '#00e68a' : '#ff4d6a'),
            'background:' + (chg > 0 ? 'rgba(0,230,138,.12)' : 'rgba(255,77,106,.1)'),
            'border:1px solid ' + (chg > 0 ? 'rgba(0,230,138,.25)' : 'rgba(255,77,106,.2)'),
            'margin-left:6px', 'vertical-align:middle',
          ].join(';');
          // Append to any text element inside the card
          var target = card.querySelector('h2,h3,.card-q,.mcard-q,.r-q') || card;
          target.appendChild(badge);
        });
      });
    }).catch(function () {});
  };

  setTimeout(window.HFX.injectPulseBadges, 3000);

  /* ─────────────────────── NOTIFICATION BELL PULSE ─────────────────────── */
  function _pulseNotifBell() {
    var bell = document.querySelector('#notifBell, .notif-bell, [data-notif-bell]');
    if (!bell) return;
    fetch('/api/notifications?limit=1&unread=true').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var count = (d && (d.unread_count || (Array.isArray(d) ? d.filter(function (n) { return !n.read; }).length : 0))) || 0;
      if (!count) return;
      var badge = bell.querySelector('.notif-count') || document.createElement('span');
      badge.className = 'notif-count';
      badge.textContent = count > 9 ? '9+' : count;
      badge.style.cssText = [
        'position:absolute', 'top:-4px', 'right:-4px',
        'background:#ff4d6a', 'color:#fff',
        'font-family:"JetBrains Mono",monospace', 'font-size:8px', 'font-weight:700',
        'width:16px', 'height:16px', 'border-radius:50%',
        'display:flex', 'align-items:center', 'justify-content:center',
      ].join(';');
      bell.style.position = 'relative';
      if (!bell.contains(badge)) bell.appendChild(badge);
    }).catch(function () {});
  }

  setTimeout(_pulseNotifBell, 2000);

  /* ─────────────────────── REACTION NOTIFICATION POLLER ─────────────────────── */
  // Every 90s, check for new reaction notifications and surface as toast.
  // Tracks last-seen notification ID in localStorage to avoid re-firing.
  var _rxLastSeenKey = 'hfx_rx_last_notif_id';
  function _pollReactionNotifs() {
    var tok = localStorage.getItem('hf_token') || localStorage.getItem('hf_creator_token') || localStorage.getItem('hf_member_token');
    if (!tok) return;
    fetch('/api/notifications?limit=5&unread=true', { headers: { 'Authorization': 'Bearer ' + tok } })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){
        var notifs = d && (d.notifications || (Array.isArray(d) ? d : []));
        if (!notifs || !notifs.length) return;
        var lastSeenId = localStorage.getItem(_rxLastSeenKey);
        // Find notifications newer than last seen
        var fresh = notifs.filter(function(n){ return !n.read && n.id !== lastSeenId; });
        if (!fresh.length) return;
        // Update last seen to newest
        localStorage.setItem(_rxLastSeenKey, fresh[0].id);
        // Surface first fresh reaction/agree notification as a toast
        // Check for market resolving soon (time-pressure, highest urgency)
        var resolvingNotif = fresh.find(function(n){ return n.type === 'market_resolving'; });
        if (resolvingNotif) {
          window.HFX.toast({
            type: 'warning',
            title: resolvingNotif.title || 'Market resolving soon.',
            body: (resolvingNotif.body || '').slice(0, 80),
            href: '/feed',
            duration: 10000
          });
          return;
        }
        // Check for challenge notification (second priority — loss aversion)
        var challengeNotif = fresh.find(function(n){ return n.type === 'take_challenged'; });
        if (challengeNotif) {
          window.HFX.toast({
            type: 'warning',
            title: challengeNotif.title || 'Someone took the other side.',
            body: (challengeNotif.body || '').slice(0, 80),
            href: '/feed',
            duration: 9000
          });
          return;
        }
        // Check for viral milestone next
        var viralNotif = fresh.find(function(n){ return n.type === 'take_viral'; });
        if (viralNotif) {
          window.HFX.toast({
            type: 'win',
            title: viralNotif.title || 'Take gaining traction.',
            body: (viralNotif.body || '').slice(0, 80),
            duration: 8000
          });
          return;
        }
        var rxNotif = fresh.find(function(n){ return n.type === 'take_reaction' || n.type === 'agree' || n.type === 'reaction'; });
        if (!rxNotif) return;
        var body = rxNotif.body || rxNotif.title || '';
        window.HFX.toast({
          type: 'agree',
          title: rxNotif.title || 'Someone reacted to your take.',
          body: body.slice(0, 80),
          duration: 6000
        });
      }).catch(function(){});
  }
  // Initial check after 8s (let page settle), then every 90s
  setTimeout(_pollReactionNotifs, 8000);
  setInterval(_pollReactionNotifs, 90000);

  /* ─────────────────────── RESOLVE TAKES CHECK ─────────────────────── */
  // On feed/profile load, check for freshly-resolved correct/incorrect takes
  // and fire the appropriate celebration or loss toast.
  window.HFX.checkResolvedTakes = function () {
    var tok = localStorage.getItem('hf_token') || localStorage.getItem('hf_creator_token') || localStorage.getItem('hf_member_token');
    if (!tok) return;
    var lastCheck = localStorage.getItem('hfx_last_resolve_check') || new Date(Date.now() - 86400e3).toISOString();
    fetch('/api/takes/mine/resolved?since=' + encodeURIComponent(lastCheck), {
      headers: { 'Authorization': 'Bearer ' + tok }
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var takes = (d && d.takes) || [];
      if (!takes.length) return;
      var newLastCheck = lastCheck;
      var wins = [], losses = [];
      takes.forEach(function (t) {
        if (!t.resolved_at || t.resolved_at <= lastCheck) return;
        if (t.resolved_at > newLastCheck) newLastCheck = t.resolved_at;
        if (t.is_correct === true) wins.push(t);
        else if (t.is_correct === false) losses.push(t);
      });
      if (newLastCheck > lastCheck) localStorage.setItem('hfx_last_resolve_check', newLastCheck);
      // Surface most recent win first, then most recent loss
      if (wins.length) {
        var w = wins[0];
        // Recovery framing: if user had prior losses this session, acknowledge the comeback
        var priorLossKey = 'hfx_recent_loss_count';
        var priorLosses = parseInt(localStorage.getItem(priorLossKey) || '0');
        if (priorLosses >= 3) {
          localStorage.setItem(priorLossKey, '0');
          window.HFX.toast({
            type: 'win',
            title: 'Pick landed after ' + priorLosses + ' losses.',
            body: (w.question || '').slice(0, 70),
            duration: 8000
          });
        } else {
          window.HFX.celebrate({ question: w.question || w.market_slug, units: w.roi_pct != null ? parseFloat(w.roi_pct).toFixed(1) : null });
        }
      }
      if (losses.length) {
        var l = losses[0];
        var lossCount = parseInt(localStorage.getItem('hfx_recent_loss_count') || '0') + 1;
        localStorage.setItem('hfx_recent_loss_count', String(lossCount));
        window.HFX.showLoss({ question: l.question || l.market_slug, units: null, closeness: null });
      }
    }).catch(function () {});
  };

  /* ─────────────────────── SOCIAL PROOF INJECTOR ─────────────────────── */
  window.HFX.injectSocialProof = function () {
    // Inject "X watching" or "X agree" counts on cards that have data-slug
    var cards = document.querySelectorAll('[data-slug]:not([data-sp-done])');
    if (!cards.length) return;
    var slugs = Array.from(cards).map(function (c) { return c.getAttribute('data-slug'); }).filter(Boolean);
    if (!slugs.length) return;
    fetch('/api/screener?slugs=' + encodeURIComponent(slugs.slice(0, 10).join(','))).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var markets = (d && (d.markets || d)) || [];
      var bySlug = {};
      markets.forEach(function (m) { if (m.slug) bySlug[m.slug] = m; });
      cards.forEach(function (card) {
        var slug = card.getAttribute('data-slug');
        var m = bySlug[slug];
        if (!m) return;
        card.setAttribute('data-sp-done', '1');
        if (!m.whale_count && !m.volume24hr) return;
        var proof = document.createElement('div');
        proof.style.cssText = 'font-family:"JetBrains Mono",monospace;font-size:9px;color:rgba(240,240,245,.4);letter-spacing:.04em;margin-top:4px;';
        var parts = [];
        if (m.whale_count > 0) parts.push(m.whale_count + ' whale' + (m.whale_count > 1 ? 's' : '') + ' positioned');
        if (m.volume24hr > 50000) parts.push('$' + (m.volume24hr >= 1e6 ? (m.volume24hr/1e6).toFixed(1)+'M' : Math.round(m.volume24hr/1e3)+'K') + ' today');
        proof.textContent = parts.join(' · ');
        if (parts.length) {
          var target = card.querySelector('.card-body,.mcard-content,.card-meta') || card;
          target.appendChild(proof);
        }
      });
    }).catch(function () {});
  };

  setTimeout(window.HFX.injectSocialProof, 2500);

  /* ─────────────────────── AUTO-INJECT NAV STREAK ─────────────────────── */
  // If user is logged in, append streak chip to nav
  function _injectNavStreak() {
    var nav = document.querySelector('nav');
    if (!nav || nav.querySelector('.hfx-streak-chip')) return;
    fetch('/api/daily-pick').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.streak || d.streak < 2) return;
      var chip = document.createElement('a');
      chip.href = '/';
      chip.className = 'hfx-streak-chip';
      chip.style.cssText = [
        'font-family:"JetBrains Mono",monospace', 'font-size:9px', 'font-weight:700',
        'letter-spacing:.1em', 'text-transform:uppercase',
        'color:#f59e0b', 'background:rgba(245,158,11,.1)',
        'border:1px solid rgba(245,158,11,.25)', 'border-radius:4px',
        'padding:4px 9px', 'text-decoration:none',
        'display:inline-flex', 'align-items:center', 'gap:5px',
      ].join(';');
      chip.innerHTML = '<span style="font-size:11px;">◆</span>' + d.streak + '-day streak';
      var right = nav.querySelector('.nav-right');
      if (right) right.insertBefore(chip, right.firstChild);
      else nav.appendChild(chip);
    }).catch(function () {});
  }

  setTimeout(_injectNavStreak, 1500);

  /* ─────────────────────── WEB PUSH OPT-IN ─────────────────────── */
  // Show a subtle opt-in prompt after user is engaged (not on first load, not
  // if already subscribed, not more than once per week).
  var _pushPromptKey = 'hfx_push_prompted';
  var _pushSubKey    = 'hfx_push_subscribed';

  function _base64UrlToUint8Array(base64UrlData) {
    var padding = '='.repeat((4 - (base64UrlData.length % 4)) % 4);
    var base64 = (base64UrlData + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = atob(base64);
    var out = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i);
    return out;
  }

  function _doSubscribePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      return fetch('/api/push/vapid-key').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (!d || !d.publicKey) return;
        return reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: _base64UrlToUint8Array(d.publicKey),
        }).then(function (sub) {
          var j = sub.toJSON();
          return fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }),
          });
        }).then(function () {
          localStorage.setItem(_pushSubKey, '1');
          window.HFX.toast({ type: 'info', title: 'Alerts enabled.', body: 'Push when your takes resolve.', duration: 4000 });
        });
      });
    }).catch(function () {});
  }

  function _showPushPrompt() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'denied') return;
    if (localStorage.getItem(_pushSubKey)) return;
    var now = Date.now();
    var last = parseInt(localStorage.getItem(_pushPromptKey) || '0');
    if (now - last < 7 * 86400000) return; // once per week
    localStorage.setItem(_pushPromptKey, String(now));

    // Build inline prompt (not a browser native dialog yet — user clicks to trigger)
    var wrap = document.createElement('div');
    wrap.id = 'hfx-push-prompt';
    wrap.style.cssText = [
      'position:fixed', 'bottom:80px', 'right:24px', 'z-index:99998',
      'background:#111118', 'border:1px solid rgba(77,159,255,.25)',
      'border-radius:10px', 'padding:16px 18px', 'max-width:300px',
      'box-shadow:0 4px 24px rgba(0,0,0,.5)', 'font-family:"Inter",sans-serif',
    ].join(';');
    wrap.innerHTML = [
      '<div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgba(77,159,255,.8);margin-bottom:8px;">Stay in the loop</div>',
      '<div style="font-size:13px;color:#f0f0f5;line-height:1.45;margin-bottom:14px;">Get a push when your takes resolve or a challenge drops.</div>',
      '<div style="display:flex;gap:8px;">',
        '<button id="hfx-push-yes" style="flex:1;background:#4d9fff;color:#000;border:none;border-radius:6px;padding:9px;font-weight:700;font-size:12px;cursor:pointer;">Enable</button>',
        '<button id="hfx-push-no" style="background:none;border:1px solid rgba(255,255,255,.12);color:rgba(240,240,245,.5);border-radius:6px;padding:9px 12px;font-size:12px;cursor:pointer;">Not now</button>',
      '</div>',
    ].join('');
    document.body.appendChild(wrap);

    document.getElementById('hfx-push-yes').onclick = function () {
      wrap.remove();
      if (Notification.permission === 'granted') {
        _doSubscribePush();
      } else {
        Notification.requestPermission().then(function (perm) {
          if (perm === 'granted') _doSubscribePush();
        });
      }
    };
    document.getElementById('hfx-push-no').onclick = function () { wrap.remove(); };
  }

  // Show push prompt 45s after page load — user is engaged by then
  setTimeout(_showPushPrompt, 45000);

  /* ─────────────────────── REFERRAL SYSTEM ─────────────────────── */
  var _refCode = null;

  function _buildInviteModal(code, count, total) {
    var existing = document.getElementById('hfx-invite-modal');
    if (existing) { existing.style.display = 'flex'; return; }

    var link = 'https://hyperflex.network/creator/signup?ref_code=' + code;
    var tweetText = 'Building a track record on @hyperflexnet — the prediction market social layer. Join with my link and post your first take: ' + link;

    var modal = document.createElement('div');
    modal.id = 'hfx-invite-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = [
      '<div style="background:#111118;border:1px solid rgba(168,85,247,.2);border-radius:12px;padding:28px;width:90%;max-width:420px;position:relative;">',
        '<div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(168,85,247,.8);margin-bottom:10px;">Invite traders</div>',
        '<div style="font-size:15px;font-weight:700;color:#f0f0f5;line-height:1.4;margin-bottom:6px;">Your track record does the selling.</div>',
        '<div style="font-size:13px;color:rgba(240,240,245,.5);margin-bottom:20px;">Share your invite link. Every person who joins and posts a take is credited to you.',
          count > 0 ? ' <strong style="color:#a855f7;">' + count + ' joined so far.</strong>' : '',
        '</div>',
        '<div style="background:#0e0e15;border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:10px 14px;font-family:monospace;font-size:11px;color:#f0f0f5;word-break:break-all;margin-bottom:14px;">' + link + '</div>',
        '<div style="display:flex;gap:10px;margin-bottom:16px;">',
          '<button id="hfx-ref-copy" style="flex:1;background:#a855f7;color:#fff;border:none;border-radius:6px;padding:11px;font-weight:700;font-size:12px;cursor:pointer;letter-spacing:.05em;">Copy link</button>',
          '<button onclick="window.open(\'https://twitter.com/intent/tweet?text=\'+encodeURIComponent(\'' + tweetText.replace(/'/g, "\\'") + '\'),\'_blank\',\'width=600,height=400\')" style="flex:1;background:#1da1f2;color:#fff;border:none;border-radius:6px;padding:11px;font-weight:700;font-size:12px;cursor:pointer;">Post on X</button>',
        '</div>',
        '<button onclick="document.getElementById(\'hfx-invite-modal\').style.display=\'none\'" style="width:100%;background:none;border:1px solid rgba(255,255,255,.1);color:rgba(240,240,245,.5);border-radius:6px;padding:9px;font-size:12px;cursor:pointer;">Close</button>',
      '</div>',
    ].join('');
    document.body.appendChild(modal);

    modal.onclick = function (e) { if (e.target === modal) modal.style.display = 'none'; };
    document.getElementById('hfx-ref-copy').onclick = function () {
      navigator.clipboard.writeText(link).then(function () {
        document.getElementById('hfx-ref-copy').textContent = 'Copied ✓';
        setTimeout(function () { document.getElementById('hfx-ref-copy').textContent = 'Copy link'; }, 2000);
      }).catch(function () {});
    };
  }

  window.HFX.openInvite = function () {
    if (_refCode) { _buildInviteModal(_refCode, 0, 0); return; }
    fetch('/api/referral/code', { headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('hfx_token') || '') } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.referral_code) return;
        _refCode = d.referral_code;
        _buildInviteModal(d.referral_code, (d.referrals || []).length, d.total_fp || 0);
      }).catch(function () {});
  };

  // Injects "Invite" chip in the nav once user is logged in
  window.HFX.showReferralChip = function () {
    var nav = document.querySelector('nav');
    if (!nav || nav.querySelector('.hfx-ref-chip')) return;
    var chip = document.createElement('button');
    chip.className = 'hfx-ref-chip';
    chip.title = 'Invite friends to HYPERFLEX';
    chip.style.cssText = [
      'font-family:"JetBrains Mono",monospace', 'font-size:9px', 'font-weight:700',
      'letter-spacing:.1em', 'text-transform:uppercase',
      'color:#a855f7', 'background:rgba(168,85,247,.08)',
      'border:1px solid rgba(168,85,247,.2)', 'border-radius:4px',
      'padding:4px 9px', 'cursor:pointer',
      'display:inline-flex', 'align-items:center', 'gap:5px',
    ].join(';');
    chip.textContent = '+ Invite';
    chip.onclick = function () { window.HFX.openInvite(); };
    var right = nav.querySelector('.nav-right');
    if (right) right.insertBefore(chip, right.firstChild);
    else nav.appendChild(chip);
  };

  // Check session and show invite chip for logged-in users
  setTimeout(function () {
    var tok = localStorage.getItem('hfx_token') || sessionStorage.getItem('hfx_token');
    if (!tok) return;
    try {
      var payload = JSON.parse(atob(tok.split('.')[1]));
      if (payload && (payload.sub || payload.id)) window.HFX.showReferralChip();
    } catch (e) {}
  }, 2500);

  // ── Archetype nav chip — shows saved archetype in nav for identity reinforcement
  setTimeout(function () {
    var saved = localStorage.getItem('hfx_archetype');
    if (!saved) return;
    var nav = document.querySelector('nav, .nav, #nav, header');
    if (!nav || nav.querySelector('.hfx-arch-chip')) return;
    try {
      var arc = JSON.parse(saved);
      if (!arc || !arc.tag) return;
      var chip = document.createElement('a');
      chip.href = '/quiz';
      chip.className = 'hfx-arch-chip';
      chip.title = 'Your prediction archetype — ' + arc.tag;
      chip.style.cssText = [
        'font-family:var(--mono,"JetBrains Mono",monospace)',
        'font-size:10px', 'font-weight:700', 'letter-spacing:.12em',
        'text-transform:uppercase',
        'background:' + (arc.color || '#c9920d') + '14',
        'border:1px solid ' + (arc.color || '#c9920d') + '44',
        'color:' + (arc.color || '#c9920d'),
        'border-radius:100px', 'padding:4px 10px',
        'text-decoration:none', 'cursor:pointer',
        'display:inline-flex', 'align-items:center', 'gap:5px',
      ].join(';');
      chip.innerHTML = '◆ ' + arc.tag.toUpperCase().slice(0, 16);
      var right = nav.querySelector('.nav-right');
      if (right) right.insertBefore(chip, right.firstChild);
      else nav.appendChild(chip);
    } catch(e) {}
  }, 3200);

  // ── Archetype market alert — if user has saved archetype and screener
  //    has 3+ matching whale markets, fire a toast nudging them to the feed.
  setTimeout(function () {
    var saved = localStorage.getItem('hfx_archetype');
    var alerted = sessionStorage.getItem('hfx_arch_alerted');
    if (!saved || alerted) return;
    try {
      var arc = JSON.parse(saved);
      if (!arc || !arc.tag) return;
      fetch('/api/screener?limit=60').then(function(r){ return r.json(); }).then(function(data) {
        var mkts = Array.isArray(data) ? data : (data.markets || data.data || []);
        var matches = mkts.filter(function(m) {
          if (!m.whale_count || m.whale_count < 2) return false;
          var q = (m.question || '').toLowerCase();
          var c = (m.category || '').toLowerCase();
          var kws = (arc.tag || '').toLowerCase().split(/\s+/);
          // rough match by category or keywords embedded in archetype name
          var catMap = {
            'contrarian': ['politics','economics','crypto'],
            'sharp': ['crypto','finance','economics'],
            'oracle': ['politics','economics'],
            'catalyst': ['crypto','ai','tech'],
            'handicapper': ['sports','esports'],
            'wonk': ['politics','policy'],
            'strategist': ['economics','finance','macro'],
            'native': ['crypto','defi','nft'],
            'macro': ['economics','fed','rates','macro'],
          };
          var arcKey = arc.tag.toLowerCase().split(' ')[0];
          var relevantCats = catMap[arcKey] || [];
          return relevantCats.some(function(rc) { return c.indexOf(rc) !== -1 || q.indexOf(rc) !== -1; });
        });
        if (matches.length >= 2) {
          sessionStorage.setItem('hfx_arch_alerted', '1');
          setTimeout(function() {
            window.HFX && window.HFX.toast && window.HFX.toast({
              type: 'info',
              title: matches.length + ' ' + arc.tag + ' markets moving.',
              body: 'Whales active in your archetype. Check the feed →',
              duration: 7000,
              href: '/feed',
            });
          }, 1500);
        }
      }).catch(function(){});
    } catch(e) {}
  }, 8000);

})();
