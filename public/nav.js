// HYPERFLEX shared navbar — include via <script src="/nav.js"></script>
// Injects navbar + scoped CSS into #nav-root, highlights active page, shows Dashboard if logged in
(function() {
  // Inject CSS if .topbar not already styled
  if (!document.querySelector('style[data-hfx-nav]')) {
    var style = document.createElement('style');
    style.setAttribute('data-hfx-nav', '1');
    style.textContent =
      '.topbar{display:flex;align-items:center;justify-content:space-between;padding:16px 32px;border-bottom:1px solid rgba(255,255,255,0.06);background:rgba(10,10,15,0.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);position:sticky;top:0;z-index:100}' +
      '.topbar-logo{font-family:"Inter",-apple-system,sans-serif;font-weight:800;font-size:18px;letter-spacing:-0.5px;color:#f0f0f5;text-decoration:none}' +
      '.topbar-logo span{background:linear-gradient(135deg,#00e68a,#4d9fff,#a855f7);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}' +
      '.nav-links{display:flex;align-items:center;gap:6px;margin-left:auto}' +
      '.nav-link{font-family:"Inter",-apple-system,sans-serif;font-size:12px;font-weight:500;color:#8888a0;text-decoration:none;transition:all .15s;padding:6px 10px;border-radius:8px}' +
      '.nav-link:hover{color:#f0f0f5;background:rgba(255,255,255,0.05)}' +
      '.nav-link.active{color:#f0f0f5;background:rgba(255,255,255,0.08);font-weight:600}' +
      /* Hamburger More menu */
      '.nav-more-wrap{position:relative;flex-shrink:0}' +
      '.nav-more-btn{display:flex;align-items:center;gap:5px;padding:6px 10px;border-radius:8px;cursor:pointer;font-family:"Inter",-apple-system,sans-serif;font-size:12px;font-weight:500;color:#8888a0;background:none;border:none;transition:all .15s}' +
      '.nav-more-btn:hover,.nav-more-btn.open{color:#f0f0f5;background:rgba(255,255,255,0.05)}' +
      '.nav-more-btn svg{width:16px;height:16px;stroke:currentColor;stroke-width:2;fill:none;transition:transform .2s}' +
      '.nav-more-btn.open svg{transform:rotate(180deg)}' +
      '.nav-more-dd{display:none;position:absolute;top:calc(100% + 8px);right:0;min-width:220px;background:rgba(18,18,24,0.95);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.08);border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,0.5);padding:6px;z-index:200}' +
      '.nav-more-dd.open{display:block}' +
      '.nav-more-dd a{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;font-family:"Inter",-apple-system,sans-serif;font-size:13px;font-weight:500;color:#8888a0;text-decoration:none;transition:all .12s}' +
      '.nav-more-dd a:hover{color:#f0f0f5;background:rgba(255,255,255,0.06)}' +
      '.nav-more-dd a.active{color:#f0f0f5;background:rgba(255,255,255,0.08);font-weight:600}' +
      '.nav-more-dd .dd-sep{height:1px;background:rgba(255,255,255,0.06);margin:4px 8px}' +
      '.nav-auth{display:flex;align-items:center;gap:8px;margin-left:12px;flex-shrink:0}' +
      '.nav-signin{font-family:"Inter",-apple-system,sans-serif;font-size:11px;font-weight:500;color:#8888a0;text-decoration:none;padding:6px 12px;border:1px solid rgba(255,255,255,0.08);border-radius:8px;transition:all .15s;white-space:nowrap}' +
      '.nav-signin:hover{color:#f0f0f5;border-color:rgba(255,255,255,0.2);background:rgba(255,255,255,0.04)}' +
      '.nav-cta{font-family:"Inter",-apple-system,sans-serif;font-size:11px;font-weight:700;color:#0a0a0f;background:linear-gradient(135deg,#00e68a,#4d9fff);text-decoration:none;padding:6px 14px;border-radius:8px;transition:all .15s;white-space:nowrap}' +
      '.nav-cta:hover{filter:brightness(1.1);transform:translateY(-1px)}' +
      '@media(max-width:768px){.topbar{padding:12px 16px}.nav-links{gap:4px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}.nav-links::-webkit-scrollbar{display:none}.nav-link{font-size:11px;white-space:nowrap;min-height:44px;display:inline-flex;align-items:center;padding:6px 8px}.nav-link.desktop-only{display:none}.nav-auth{gap:6px;margin-left:8px}.nav-signin{font-size:10px;padding:5px 8px;min-height:44px;display:inline-flex;align-items:center}.nav-cta{font-size:10px;padding:5px 10px;min-height:44px;display:inline-flex;align-items:center}.nav-more-dd{right:-16px;min-width:200px}}' +
      /* ── Global Search (Cmd+K) styles ── */
      '.nav-search-btn{display:flex;align-items:center;gap:6px;padding:5px 12px;border:1px solid rgba(255,255,255,0.08);border-radius:8px;background:rgba(255,255,255,0.03);cursor:pointer;margin-left:8px;transition:all .15s;flex-shrink:0}' +
      '.nav-search-btn:hover{border-color:rgba(255,255,255,0.16);background:rgba(255,255,255,0.06)}' +
      '.nav-search-btn svg{width:14px;height:14px;stroke:#8888a0;stroke-width:2;fill:none}' +
      '.nav-search-btn span{font-family:"Inter",-apple-system,sans-serif;font-size:11px;color:#8888a0;white-space:nowrap}' +
      '.nav-search-btn kbd{font-family:"Inter",-apple-system,sans-serif;font-size:10px;color:#666680;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);border-radius:4px;padding:1px 5px;margin-left:4px}' +
      '@media(max-width:768px){.nav-search-btn kbd{display:none}.nav-search-btn span{display:none}}' +
      /* Overlay */
      '.hfx-search-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.6);display:none;align-items:flex-start;justify-content:center;padding:min(12vh,120px) 16px 16px}' +
      '.hfx-search-overlay.active{display:flex}' +
      /* Modal */
      '.hfx-search-modal{width:100%;max-width:640px;background:rgba(18,18,24,0.92);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.08);border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,0.5);overflow:hidden;display:flex;flex-direction:column;max-height:min(520px,70vh)}' +
      /* Input row */
      '.hfx-search-input-row{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.06)}' +
      '.hfx-search-input-row svg{width:18px;height:18px;stroke:#8888a0;stroke-width:2;fill:none;flex-shrink:0}' +
      '.hfx-search-input{flex:1;background:none;border:none;outline:none;font-family:"Inter",-apple-system,sans-serif;font-size:15px;color:#f0f0f5;caret-color:#4d9fff}' +
      '.hfx-search-input::placeholder{color:#55556a}' +
      '.hfx-search-esc{font-family:"Inter",-apple-system,sans-serif;font-size:10px;color:#666680;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);border-radius:4px;padding:2px 6px;cursor:pointer;flex-shrink:0}' +
      /* Results area */
      '.hfx-search-results{overflow-y:auto;padding:6px 0;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.1) transparent}' +
      '.hfx-search-results::-webkit-scrollbar{width:4px}' +
      '.hfx-search-results::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}' +
      '.hfx-search-empty{padding:32px 18px;text-align:center;font-family:"Inter",-apple-system,sans-serif;font-size:13px;color:#55556a}' +
      '.hfx-search-hint{padding:24px 18px;text-align:center;font-family:"Inter",-apple-system,sans-serif;font-size:12px;color:#55556a;line-height:1.6}' +
      /* Section headers */
      '.hfx-search-section{padding:8px 18px 4px;font-family:"Inter",-apple-system,sans-serif;font-size:10px;font-weight:600;color:#55556a;text-transform:uppercase;letter-spacing:0.8px}' +
      /* Result items */
      '.hfx-search-item{display:flex;align-items:center;gap:10px;padding:8px 18px;cursor:pointer;transition:background .1s;text-decoration:none}' +
      '.hfx-search-item:hover,.hfx-search-item.active{background:rgba(77,159,255,0.08)}' +
      '.hfx-search-item-icon{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}' +
      '.hfx-search-item-icon.page{background:rgba(77,159,255,0.12)}' +
      '.hfx-search-item-icon.market{background:rgba(0,230,138,0.12)}' +
      '.hfx-search-item-body{flex:1;min-width:0}' +
      '.hfx-search-item-title{font-family:"Inter",-apple-system,sans-serif;font-size:13px;color:#f0f0f5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.hfx-search-item-meta{font-family:"Inter",-apple-system,sans-serif;font-size:11px;color:#8888a0;margin-top:1px}' +
      '.hfx-search-item-odds{display:flex;gap:6px;flex-shrink:0;align-items:center}' +
      '.hfx-search-item-odds .yes{font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:600;color:#00e68a}' +
      '.hfx-search-item-odds .no{font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:600;color:#ff6b6b}' +
      '.hfx-search-badge{font-family:"Inter",-apple-system,sans-serif;font-size:9px;font-weight:600;padding:2px 6px;border-radius:4px;text-transform:uppercase;flex-shrink:0}' +
      '.hfx-search-badge.poly{background:rgba(102,51,204,0.2);color:#a78bfa}' +
      '.hfx-search-badge.kalshi{background:rgba(255,165,0,0.15);color:#ffa500}' +
      /* Footer */
      '.hfx-search-footer{display:flex;align-items:center;gap:12px;padding:8px 18px;border-top:1px solid rgba(255,255,255,0.06);font-family:"Inter",-apple-system,sans-serif;font-size:10px;color:#55556a}' +
      '.hfx-search-footer kbd{font-size:10px;color:#666680;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);border-radius:3px;padding:1px 4px}' +
      '@media(max-width:768px){.hfx-search-overlay{padding:8px;align-items:flex-start}.hfx-search-modal{max-height:85vh;max-width:100%;border-radius:12px}.hfx-search-footer{display:none}}';
    document.head.appendChild(style);
  }

  // Primary links shown in nav bar
  var primaryLinks = [
    { href: '/alpha', label: '⚡ Alpha', gold: true },
    { href: '/signals', label: 'Signals' },
    { href: '/screener', label: 'Screener' },
    { href: '/whales', label: 'Market Intel' },
    { href: '/crystal-ball', label: 'Crystal Ball' },
    { href: '/predictors', label: 'Predictors' },
    { href: '/explore', label: 'Explore' }
  ];
  // Secondary links in "More" dropdown
  var moreLinks = [
    { href: '/brief', label: '🧠 AI Brief', gold: true },
    { href: '/odds', label: '🎲 Odds' },
    { href: '/high-prob', label: '🎯 99% Bets', gold: true },
    { href: '/rewards', label: '💰 Rewards', gold: true },
    { sep: true },
    { href: '/ecosystem', label: '🌐 Ecosystem' },
    { href: '/features', label: '✨ Features' },
    { href: '/data', label: '📈 Data' },
    { href: '/api-docs', label: '⚙️ API' },
    { sep: true },
    { href: '/nominate', label: '➕ Nominate a Creator', gold: true }
  ];
  // Combined for search index
  var links = primaryLinks.concat(moreLinks.filter(function(l){return !l.sep}));

  var path = window.location.pathname.replace(/\/$/, '') || '/';

  var isLoggedIn = !!(localStorage.getItem('hf_token') || localStorage.getItem('hf_creator_token'));

  // Check if any "More" link is active (to highlight More button)
  var moreActive = moreLinks.some(function(l) { return !l.sep && path === l.href; });

  var nav = document.createElement('nav');
  nav.className = 'topbar';
  nav.innerHTML =
    '<a href="/explore" class="topbar-logo">HYPER<span>FLEX</span></a>' +
    '<div class="nav-links">' +
      primaryLinks.map(function(l) {
        var isActive = path === l.href;
        var cls = 'nav-link' + (isActive ? ' active' : '');
        var style = l.gold && !isActive ? ' style="color:#00e68a"' : '';
        return '<a href="' + l.href + '" class="' + cls + '"' + style + '>' + l.label + '</a>';
      }).join('') +
      '<a id="navDashLink" href="/creator/dashboard" class="nav-link" style="' + (isLoggedIn ? '' : 'display:none;') + 'color:#00e68a;font-weight:600">Dashboard</a>' +
      '<div class="nav-more-wrap">' +
        '<button class="nav-more-btn' + (moreActive ? ' active' : '') + '" id="navMoreBtn">' +
          'More <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>' +
        '</button>' +
        '<div class="nav-more-dd" id="navMoreDd">' +
          moreLinks.map(function(l) {
            if (l.sep) return '<div class="dd-sep"></div>';
            var isActive = path === l.href;
            var cls = isActive ? ' class="active"' : '';
            var style = l.gold && !isActive ? ' style="color:#00e68a"' : '';
            return '<a href="' + l.href + '"' + cls + style + '>' + l.label + '</a>';
          }).join('') +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="nav-search-btn" id="hfxSearchBtn" title="Search (⌘K)">' +
      '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>' +
      '<span>Search</span>' +
      '<kbd>' + (navigator.platform.indexOf('Mac') > -1 ? '⌘' : 'Ctrl') + 'K</kbd>' +
    '</div>' +
    '<div class="nav-auth">' +
      (isLoggedIn
        ? ''
        : '<a href="/creator/login" class="nav-signin">Sign in</a>') +
    '</div>';

  var root = document.getElementById('nav-root');
  if (root) {
    root.appendChild(nav);
  } else {
    document.body.insertBefore(nav, document.body.firstChild);
  }

  // Dashboard link visibility already handled by isLoggedIn above

  // ── More dropdown toggle ──
  (function() {
    var btn = document.getElementById('navMoreBtn');
    var dd = document.getElementById('navMoreDd');
    if (!btn || !dd) return;
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var open = dd.classList.toggle('open');
      btn.classList.toggle('open', open);
    });
    document.addEventListener('click', function(e) {
      if (!dd.contains(e.target) && e.target !== btn) {
        dd.classList.remove('open');
        btn.classList.remove('open');
      }
    });
    // Close on Escape
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && dd.classList.contains('open')) {
        dd.classList.remove('open');
        btn.classList.remove('open');
      }
    });
  })();

  // ── Global Search Modal (Cmd+K / Ctrl+K) ──
  (function() {
    // Page definitions for static search
    var pages = [
      { name: 'Signals', desc: 'AI-powered trading signals', href: '/signals', icon: '📡' },
      { name: 'Crystal Ball', desc: 'AI market predictions', href: '/crystal-ball', icon: '🔮' },
      { name: 'Screener', desc: 'Market screener & filters', href: '/screener', icon: '📊' },
      { name: 'Whale Intel', desc: 'Whale activity tracker', href: '/whales', icon: '🐋' },
      { name: 'Market Intel', desc: 'Whale activity tracker', href: '/whales', icon: '🐋' },
      { name: 'Predictors', desc: 'Top predictor leaderboard', href: '/predictors', icon: '🏆' },
      { name: 'Odds', desc: 'Cross-platform odds comparison', href: '/odds', icon: '🎲' },
      { name: 'AI Brief', desc: 'Daily AI market briefing', href: '/brief', icon: '🧠' },
      { name: 'Daily Brief', desc: 'Daily AI market briefing', href: '/brief', icon: '🧠' },
      { name: 'Ecosystem', desc: 'Prediction market ecosystem', href: '/ecosystem', icon: '🌐' },
      { name: 'Features', desc: 'All HYPERFLEX features & tools', href: '/features', icon: '✨' },
      { name: 'Alpha Terminal', desc: 'Live edges ranked by Edge Score', href: '/alpha', icon: '⚡' },
      { name: 'Explore', desc: 'Discover communities & activity', href: '/explore', icon: '🔍' },
      { name: 'Rewards', desc: 'Earn from referrals', href: '/rewards', icon: '💰' },
      { name: 'Data', desc: 'Market data & analytics', href: '/data', icon: '📈' },
      { name: 'API', desc: 'Developer API docs', href: '/api-docs', icon: '⚙️' },
      { name: '99% Bets', desc: 'High probability markets', href: '/high-prob', icon: '🎯' },
      { name: 'Dashboard', desc: 'Your creator dashboard', href: '/creator/dashboard', icon: '🛠' },
      { name: 'Templates', desc: 'Market template gallery', href: '/templates', icon: '📋' },
      { name: 'Nominate', desc: 'Nominate a creator', href: '/nominate', icon: '✨' }
    ];

    // Build overlay + modal DOM
    var overlay = document.createElement('div');
    overlay.className = 'hfx-search-overlay';
    overlay.innerHTML =
      '<div class="hfx-search-modal" id="hfxSearchModal">' +
        '<div class="hfx-search-input-row">' +
          '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>' +
          '<input class="hfx-search-input" id="hfxSearchInput" type="text" placeholder="Search pages, markets..." autocomplete="off" />' +
          '<span class="hfx-search-esc" id="hfxSearchEscBtn">ESC</span>' +
        '</div>' +
        '<div class="hfx-search-results" id="hfxSearchResults">' +
          '<div class="hfx-search-hint">Type to search pages and prediction markets<br>across Polymarket and Kalshi</div>' +
        '</div>' +
        '<div class="hfx-search-footer">' +
          '<span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span>' +
          '<span><kbd>↵</kbd> open</span>' +
          '<span><kbd>esc</kbd> close</span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var input = document.getElementById('hfxSearchInput');
    var results = document.getElementById('hfxSearchResults');
    var modal = document.getElementById('hfxSearchModal');
    var activeIndex = -1;
    var debounceTimer = null;
    var abortCtrl = null;
    var lastQuery = '';

    function openSearch() {
      overlay.classList.add('active');
      input.value = '';
      activeIndex = -1;
      lastQuery = '';
      results.innerHTML = '<div class="hfx-search-hint">Type to search pages and prediction markets<br>across Polymarket and Kalshi</div>';
      // Focus after a tick for animation
      setTimeout(function() { input.focus(); }, 50);
    }

    function closeSearch() {
      overlay.classList.remove('active');
      input.blur();
      if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    }

    function isOpen() { return overlay.classList.contains('active'); }

    // Click on search button
    var searchBtn = document.getElementById('hfxSearchBtn');
    if (searchBtn) searchBtn.addEventListener('click', openSearch);

    // Click overlay to close
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeSearch();
    });

    // ESC button
    var escBtn = document.getElementById('hfxSearchEscBtn');
    if (escBtn) escBtn.addEventListener('click', closeSearch);

    // Keyboard shortcut: Cmd+K / Ctrl+K
    document.addEventListener('keydown', function(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen()) closeSearch(); else openSearch();
        return;
      }
      if (!isOpen()) return;
      if (e.key === 'Escape') { closeSearch(); e.preventDefault(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); return; }
      if (e.key === 'Enter') { e.preventDefault(); goToActive(); return; }
    });

    // Stop modal clicks from closing
    modal.addEventListener('click', function(e) { e.stopPropagation(); });

    // ── Render helpers ──
    function renderPageItem(p, idx) {
      return '<a href="' + p.href + '" class="hfx-search-item" data-idx="' + idx + '">' +
        '<div class="hfx-search-item-icon page">' + p.icon + '</div>' +
        '<div class="hfx-search-item-body">' +
          '<div class="hfx-search-item-title">' + escHtml(p.name) + '</div>' +
          '<div class="hfx-search-item-meta">' + escHtml(p.desc) + '</div>' +
        '</div>' +
      '</a>';
    }

    function renderMarketItem(m, idx) {
      var yesStr = m.yes_pct != null ? m.yes_pct + '%' : '--';
      var noStr = m.no_pct != null ? (100 - m.yes_pct) + '%' : '--';
      var isKalshi = m.platform === 'kalshi' || (m.url && m.url.indexOf('kalshi.com') !== -1);
      var isSportsbook = m.platform === 'sportsbook' || (m.url && m.url.indexOf('odds-api') !== -1);
      var badge = isKalshi
        ? '<span class="hfx-search-badge kalshi">Kalshi</span>'
        : isSportsbook ? '<span class="hfx-search-badge kalshi">Sportsbook</span>'
        : '<span class="hfx-search-badge poly">Polymarket</span>';
      var href = isKalshi ? (m.url || '#') : (window.hfxMarketUrl ? window.hfxMarketUrl(m.url || '') : (m.slug ? '/market/' + m.slug : (m.url || '#')));
      return '<a href="' + escHtml(href) + '" class="hfx-search-item" data-idx="' + idx + '"' + (isKalshi || isSportsbook ? ' target="_blank" rel="noopener"' : '') + '>' +
        '<div class="hfx-search-item-icon market">📈</div>' +
        '<div class="hfx-search-item-body">' +
          '<div class="hfx-search-item-title">' + escHtml(m.question) + '</div>' +
        '</div>' +
        '<div class="hfx-search-item-odds">' +
          '<span class="yes">Y ' + yesStr + '</span>' +
          '<span class="no">N ' + noStr + '</span>' +
          (m.yes_pct != null && m.yes_pct > 0 && m.yes_pct < 100 ? '<span style="font-family:var(--mono,monospace);font-size:10px;color:#f59e0b;font-weight:600">+' + Math.round((100 - m.yes_pct) / m.yes_pct * 100) + '%</span>' : '') +
          badge +
        '</div>' +
      '</a>';
    }

    function escHtml(s) {
      var d = document.createElement('div');
      d.textContent = s || '';
      return d.innerHTML;
    }

    function getAllItems() {
      return results.querySelectorAll('.hfx-search-item');
    }

    function moveActive(dir) {
      var items = getAllItems();
      if (!items.length) return;
      // Clear current
      if (activeIndex >= 0 && activeIndex < items.length) items[activeIndex].classList.remove('active');
      activeIndex += dir;
      if (activeIndex < 0) activeIndex = items.length - 1;
      if (activeIndex >= items.length) activeIndex = 0;
      items[activeIndex].classList.add('active');
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    }

    function goToActive() {
      var items = getAllItems();
      if (activeIndex >= 0 && activeIndex < items.length) {
        var href = items[activeIndex].getAttribute('href');
        var target = items[activeIndex].getAttribute('target');
        if (href) {
          if (target === '_blank') window.open(href, '_blank');
          else window.location.href = href;
          closeSearch();
        }
      } else if (items.length > 0) {
        // If nothing selected, go to first item
        var href = items[0].getAttribute('href');
        var target = items[0].getAttribute('target');
        if (href) {
          if (target === '_blank') window.open(href, '_blank');
          else window.location.href = href;
          closeSearch();
        }
      }
    }

    // ── Search logic ──
    function doSearch(q) {
      q = (q || '').trim();
      if (!q) {
        results.innerHTML = '<div class="hfx-search-hint">Type to search pages and prediction markets<br>across Polymarket and Kalshi</div>';
        activeIndex = -1;
        return;
      }
      lastQuery = q;
      var ql = q.toLowerCase();
      var idx = 0;

      // 1. Static page matches
      var matchedPages = pages.filter(function(p) {
        return p.name.toLowerCase().indexOf(ql) !== -1 || p.desc.toLowerCase().indexOf(ql) !== -1;
      });

      // Start building HTML
      var html = '';
      if (matchedPages.length) {
        html += '<div class="hfx-search-section">Pages</div>';
        matchedPages.forEach(function(p) {
          html += renderPageItem(p, idx++);
        });
      }

      // Show pages immediately + loading state for markets
      if (q.length >= 2) {
        html += '<div class="hfx-search-section">Markets</div>';
        html += '<div class="hfx-search-empty" id="hfxMktLoading">Searching markets...</div>';
      }

      if (!html) {
        html = '<div class="hfx-search-empty">No results for "' + escHtml(q) + '"</div>';
      }

      results.innerHTML = html;
      activeIndex = -1;

      // 2. API call for markets (debounced, only if 2+ chars)
      if (q.length >= 2) {
        if (abortCtrl) abortCtrl.abort();
        abortCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var signal = abortCtrl ? abortCtrl.signal : undefined;

        fetch('/api/markets/search?q=' + encodeURIComponent(q), { signal: signal })
          .then(function(r) { return r.ok ? r.json() : []; })
          .then(function(data) {
            if (lastQuery !== q) return; // stale
            var markets = Array.isArray(data) ? data : (data.polymarket || data.kalshi) ? [].concat(data.polymarket || []).concat(data.kalshi || []) : (data.markets || data.results || []);
            var loadingEl = document.getElementById('hfxMktLoading');
            if (!loadingEl) return;

            if (!markets.length) {
              loadingEl.textContent = 'No markets found for "' + q + '"';
              return;
            }

            // Replace loading with market items
            var mktHtml = '';
            var currentItems = getAllItems();
            var startIdx = currentItems.length;
            markets.slice(0, 8).forEach(function(m) {
              mktHtml += renderMarketItem(m, startIdx++);
            });
            loadingEl.outerHTML = mktHtml;
          })
          .catch(function(err) {
            if (err && err.name === 'AbortError') return;
            var loadingEl = document.getElementById('hfxMktLoading');
            if (loadingEl) loadingEl.textContent = 'Could not load markets';
          });
      }
    }

    // Debounced input handler — delegates to doSearch() as single code path
    input.addEventListener('input', function() {
      var q = input.value.trim();
      if (debounceTimer) clearTimeout(debounceTimer);
      if (!q) {
        doSearch('');
        return;
      }
      // Show page results instantly (no API call yet)
      var ql = q.toLowerCase();
      var matchedPages = pages.filter(function(p) {
        return p.name.toLowerCase().indexOf(ql) !== -1 || p.desc.toLowerCase().indexOf(ql) !== -1;
      });
      var quickHtml = '';
      var idx = 0;
      if (matchedPages.length) {
        quickHtml += '<div class="hfx-search-section">Pages</div>';
        matchedPages.forEach(function(p) {
          quickHtml += renderPageItem(p, idx++);
        });
      }
      if (q.length >= 2) {
        quickHtml += '<div class="hfx-search-section">Markets</div>';
        quickHtml += '<div class="hfx-search-empty" id="hfxMktLoading">Searching markets...</div>';
      }
      if (!quickHtml) quickHtml = '<div class="hfx-search-empty">No results for "' + escHtml(q) + '"</div>';
      results.innerHTML = quickHtml;
      activeIndex = -1;

      // Debounce the full doSearch (which handles the API call)
      if (q.length >= 2) {
        debounceTimer = setTimeout(function() {
          doSearch(q);
        }, 250);
      }
    });

    // Click delegation on results
    results.addEventListener('click', function(e) {
      var item = e.target.closest('.hfx-search-item');
      if (!item) return;
      var href = item.getAttribute('href');
      var target = item.getAttribute('target');
      if (href) {
        e.preventDefault();
        if (target === '_blank') window.open(href, '_blank');
        else window.location.href = href;
        closeSearch();
      }
    });

    // Mouse hover sets active index
    results.addEventListener('mousemove', function(e) {
      var item = e.target.closest('.hfx-search-item');
      if (!item) return;
      var items = getAllItems();
      for (var i = 0; i < items.length; i++) {
        if (items[i] === item) {
          if (activeIndex !== i) {
            if (activeIndex >= 0 && activeIndex < items.length) items[activeIndex].classList.remove('active');
            activeIndex = i;
            items[i].classList.add('active');
          }
          break;
        }
      }
    });
  })();
})();

// ── Polymarket referral tag — appends ?via=CODE to all outbound polymarket.com links ──
// Revenue engine: 30% of trading fees from referred users
(function() {
  var REF_CODE = window.__POLY_REF || '';
  // Fetch ref code from server config endpoint (fire-and-forget, cached in sessionStorage)
  if (!REF_CODE) {
    var cached = sessionStorage.getItem('hfx_poly_ref');
    if (cached) {
      REF_CODE = cached;
      window.__POLY_REF = cached;
    } else {
      fetch('/api/config/ref').then(function(r) { return r.json(); }).then(function(d) {
        if (d && d.ref) { REF_CODE = d.ref; window.__POLY_REF = d.ref; sessionStorage.setItem('hfx_poly_ref', d.ref); }
      }).catch(function() {});
    }
  }
  window.polyRef = function(url) {
    if (!REF_CODE || typeof url !== 'string') return url;
    if (!/^https?:\/\/polymarket\.com(\/|$|\?)/.test(url)) return url;
    if (url.indexOf('r=') !== -1 && url.indexOf(REF_CODE) !== -1) return url;
    return url + (url.indexOf('?') !== -1 ? '&' : '?') + 'r=' + REF_CODE;
  };
  // Click interceptor — tag any <a href="polymarket.com/..."> on the page
  document.addEventListener('click', function(e) {
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (/^https?:\/\/polymarket\.com(\/|$|\?)/.test(href) && REF_CODE && !(href.indexOf('r=') !== -1 && href.indexOf(REF_CODE) !== -1)) {
      a.setAttribute('href', href + (href.indexOf('?') !== -1 ? '&' : '?') + 'r=' + REF_CODE);
    }
    // Track click for USDC rewards
    if (/^https?:\/\/polymarket\.com(\/|$|\?)/.test(href)) {
      fetch('/api/rewards/track-click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('hf_token') || '') },
        body: JSON.stringify({ market_slug: href.split('/event/')[1] ? href.split('/event/')[1].split('?')[0] : '', source_page: location.pathname })
      }).catch(function(){});
    }
  }, true);
})();

// Global helper: convert Polymarket URL to our market page URL
// Usage: hfxMarketUrl('https://polymarket.com/event/us-x-iran-ceasefire-by-march-31')
// Returns: '/market/us-x-iran-ceasefire-by-march-31'
window.hfxMarketUrl = function(polyUrl) {
  if (!polyUrl || typeof polyUrl !== 'string') return '/creator/dashboard#find-markets';
  // Already our URL
  if (polyUrl.startsWith('/market/')) return polyUrl;
  // Extract slug from polymarket.com/event/SLUG or polymarket.com/event/SLUG/SUBMARKET
  var match = polyUrl.match(/polymarket\.com\/event\/([a-z0-9\-]+)/i);
  if (match) return '/market/' + match[1].toLowerCase();
  // Try extracting from any URL-like slug
  var parts = polyUrl.split('/').filter(function(p) { return p && p !== 'https:' && p !== 'http:' && !p.includes('.'); });
  if (parts.length) return '/market/' + parts[parts.length - 1].toLowerCase();
  return '/creator/dashboard#find-markets';
};
