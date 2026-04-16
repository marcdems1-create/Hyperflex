// HYPERFLEX shared navbar — include via <script src="/nav.js"></script>
// Injects navbar + scoped CSS into #nav-root, highlights active page, shows Dashboard if logged in
// Also auto-loads /copy-bot.js so every page can receive real-time copy-trade opportunities.
(function() {
  // ── Global wallet + copy-bot loading ──
  // Auto-load ethers + HFXWallet on every page so copy-bot can sign orders
  // regardless of which page the user is on. Only load if MetaMask exists —
  // no point on mobile browsers without injected wallet.
  function loadScript(src, id, cb) {
    if (document.querySelector('script[data-hfx-id="' + id + '"]')) return cb && cb();
    var s = document.createElement('script');
    s.src = src;
    s.async = false; // preserve load order
    s.setAttribute('data-hfx-id', id);
    s.onload = function() { cb && cb(); };
    document.head.appendChild(s);
  }

  function loadCopyBot() {
    if (document.querySelector('script[data-hfx-id="copy-bot"]')) return;
    var cb = document.createElement('script');
    cb.src = '/copy-bot.js?v=2';
    cb.async = true;
    cb.setAttribute('data-hfx-id', 'copy-bot');
    document.head.appendChild(cb);
  }

  function loadDeposit() {
    if (document.querySelector('script[data-hfx-id="deposit"]')) return;
    var d = document.createElement('script');
    d.src = '/deposit.js?v=27';
    d.async = true;
    d.setAttribute('data-hfx-id', 'deposit');
    d.onerror = function() { console.warn('[nav.js] deposit.js failed to load'); };
    document.head.appendChild(d);
  }

  // ── Load deposit.js IMMEDIATELY (not chained behind wallet.js) ──
  // deposit.js is self-contained enough to load in parallel. It only
  // needs window.ethers + window.HFXWallet when the user actually clicks
  // Deposit, not at script-evaluation time. Loading it up-front prevents
  // the "module still loading" race condition.
  loadDeposit();

  function loadAllDependents() {
    loadCopyBot();
    // deposit.js already loaded above — no-op if called again
    loadDeposit();
  }

  // Only load ethers/wallet if the browser has a wallet injected
  var hasWallet = (typeof window.ethereum !== 'undefined');
  if (hasWallet && typeof window.ethers === 'undefined') {
    loadScript('https://cdn.jsdelivr.net/npm/ethers@6.13.2/dist/ethers.umd.min.js', 'ethers', function() {
      loadScript('/wallet.js', 'wallet', function() {
        loadAllDependents();
      });
    });
  } else if (hasWallet && typeof window.HFXWallet === 'undefined') {
    // ethers already loaded (e.g. market.html) but wallet.js isn't
    loadScript('/wallet.js', 'wallet', loadAllDependents);
  } else {
    // No wallet or already fully loaded — still load dependents for notifications
    loadAllDependents();
  }

  // ── Bug reporter — floating button + modal on every page ──
  // Captures: page URL, user agent, last console errors, user message
  // Sends to /api/bug-reports → Claude Haiku triage + admin email
  var _consoleErrors = [];
  var _origConsoleError = console.error;
  console.error = function() {
    try {
      var args = [].slice.call(arguments).map(function(a) {
        if (a instanceof Error) return { message: a.message, stack: (a.stack || '').slice(0, 500) };
        if (typeof a === 'object') { try { return JSON.stringify(a).slice(0, 300); } catch (e) { return String(a); } }
        return String(a).slice(0, 300);
      });
      _consoleErrors.push({ ts: Date.now(), args: args });
      if (_consoleErrors.length > 20) _consoleErrors.shift();
    } catch (e) {}
    return _origConsoleError.apply(console, arguments);
  };
  // Also catch unhandled errors
  window.addEventListener('error', function(e) {
    try {
      _consoleErrors.push({ ts: Date.now(), args: [{ message: e.message, file: e.filename, line: e.lineno, col: e.colno, stack: (e.error && e.error.stack || '').slice(0, 500) }] });
      if (_consoleErrors.length > 20) _consoleErrors.shift();
    } catch (err) {}
  });

  function injectBugReporter() {
    if (document.getElementById('hfxBugBtn')) return;
    var btn = document.createElement('button');
    btn.id = 'hfxBugBtn';
    btn.title = 'Report a bug';
    btn.innerHTML = '🐛';
    btn.style.cssText = 'position:fixed;bottom:20px;left:20px;width:40px;height:40px;border-radius:50%;background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.4);color:#a855f7;font-size:18px;cursor:pointer;z-index:9998;display:flex;align-items:center;justify-content:center;transition:all .15s;backdrop-filter:blur(8px)';
    btn.onmouseenter = function() { btn.style.background = 'rgba(168,85,247,0.3)'; btn.style.transform = 'scale(1.1)'; };
    btn.onmouseleave = function() { btn.style.background = 'rgba(168,85,247,0.15)'; btn.style.transform = 'scale(1)'; };
    btn.onclick = openBugModal;
    document.body.appendChild(btn);
  }

  function openBugModal() {
    if (document.getElementById('hfxBugModal')) return;
    var overlay = document.createElement('div');
    overlay.id = 'hfxBugModal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:10003;display:flex;align-items:center;justify-content:center;padding:16px';
    overlay.onclick = function(e) { if (e.target === overlay) closeBugModal(); };
    overlay.innerHTML =
      '<div style="background:#0e0e0c;border:1px solid #a855f7;border-radius:14px;padding:24px;max-width:480px;width:100%;font-family:Inter,system-ui,sans-serif;color:#e8e4d9">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">' +
          '<span style="font-size:20px">🐛</span>' +
          '<h3 style="margin:0;font-size:16px;font-weight:800;color:#a855f7">Report a Bug</h3>' +
          '<button onclick="HFXBug.close()" style="margin-left:auto;background:none;border:none;color:#888;font-size:20px;cursor:pointer;padding:0 4px">✕</button>' +
        '</div>' +
        '<div style="font-family:monospace;font-size:11px;color:#7a7870;margin-bottom:10px;line-height:1.5">' +
          'Auto-captured: <span style="color:#c0c0d0">page URL · console errors · wallet state</span><br>' +
          'Our AI triages instantly and routes critical bugs to the team.' +
        '</div>' +
        '<textarea id="hfxBugMsg" placeholder="What went wrong? Be specific — what did you click, what did you expect, what happened instead?" rows="6" style="width:100%;background:#1a1917;border:1px solid #2a2a25;border-radius:8px;padding:12px;font-family:monospace;font-size:13px;color:#e8e4d9;outline:none;resize:vertical;box-sizing:border-box"></textarea>' +
        '<div id="hfxBugResponse" style="display:none;margin-top:12px;padding:10px 14px;border-radius:8px;font-family:monospace;font-size:12px;line-height:1.5"></div>' +
        '<div style="display:flex;gap:8px;margin-top:14px">' +
          '<button id="hfxBugSubmit" onclick="HFXBug.submit()" style="flex:1;background:#a855f7;color:#fff;border:none;padding:10px 14px;border-radius:8px;font-family:monospace;font-size:12px;font-weight:700;cursor:pointer">Send to team →</button>' +
          '<button onclick="HFXBug.close()" style="background:rgba(255,255,255,0.08);color:#888;border:none;padding:10px 14px;border-radius:8px;font-family:monospace;font-size:12px;cursor:pointer">Cancel</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    setTimeout(function() { var t = document.getElementById('hfxBugMsg'); if (t) t.focus(); }, 50);
  }

  function closeBugModal() {
    var m = document.getElementById('hfxBugModal');
    if (m) m.remove();
  }

  async function submitBug() {
    var msg = (document.getElementById('hfxBugMsg') || {}).value || '';
    if (msg.trim().length < 5) { alert('Please describe the bug (at least 5 characters)'); return; }
    var btn = document.getElementById('hfxBugSubmit');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

    // Capture context
    var context = {
      url: window.location.href,
      referrer: document.referrer,
      viewport: window.innerWidth + 'x' + window.innerHeight,
      has_wallet: !!window.ethereum,
      has_hf_token: !!localStorage.getItem('hf_token'),
      has_poly_proxy: !!localStorage.getItem('hf_poly_wallet'),
      has_clob_keys: !!localStorage.getItem('poly_api_key')
    };
    var token = localStorage.getItem('hf_token') || localStorage.getItem('hf_creator_token') || '';

    try {
      var r = await fetch('/api/bug-reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? ('Bearer ' + token) : ''
        },
        body: JSON.stringify({
          message: msg,
          page_url: window.location.href,
          user_agent: navigator.userAgent,
          context: context,
          console_errors: _consoleErrors.slice(-10)
        })
      });
      var d = await r.json();
      var resp = document.getElementById('hfxBugResponse');
      if (r.ok) {
        if (resp) {
          resp.style.display = 'block';
          resp.style.background = 'rgba(0,230,138,0.08)';
          resp.style.border = '1px solid rgba(0,230,138,0.25)';
          resp.style.color = '#00e68a';
          var aiMsg = (d.ai_response && d.ai_response.message) || 'Thanks! Report received.';
          var sevBadge = d.ai_response && d.ai_response.severity ? ' · <span style="color:#f59e0b">' + d.ai_response.severity.toUpperCase() + '</span>' : '';
          resp.innerHTML = '✓ ' + aiMsg + sevBadge;
        }
        if (btn) { btn.textContent = 'Sent ✓'; btn.style.background = '#00e68a'; }
        setTimeout(closeBugModal, 3500);
      } else {
        if (resp) {
          resp.style.display = 'block';
          resp.style.background = 'rgba(255,77,106,0.08)';
          resp.style.border = '1px solid rgba(255,77,106,0.25)';
          resp.style.color = '#ff4d6a';
          resp.innerHTML = '✗ ' + (d.error || 'Failed to submit. Try again.');
        }
        if (btn) { btn.disabled = false; btn.textContent = 'Retry →'; }
      }
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Retry →'; }
      alert('Network error: ' + e.message);
    }
  }

  window.HFXBug = { open: openBugModal, close: closeBugModal, submit: submitBug };

  // Inject button once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectBugReporter);
  } else {
    injectBugReporter();
  }
})();
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
      '.nav-more-btn{display:flex;align-items:center;justify-content:center;padding:6px 8px;border-radius:8px;cursor:pointer;color:#8888a0;background:none;border:none;transition:all .15s}' +
      '.nav-more-btn:hover,.nav-more-btn.open{color:#f0f0f5;background:rgba(255,255,255,0.05)}' +
      '.nav-more-btn svg{stroke:currentColor;stroke-width:2;fill:none}' +
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
      /* Connect Wallet button */
      '.nav-wallet-btn{display:flex;align-items:center;gap:6px;padding:5px 12px;border:1px solid rgba(168,85,247,0.3);border-radius:8px;background:rgba(168,85,247,0.08);cursor:pointer;transition:all .15s;white-space:nowrap}' +
      '.nav-wallet-btn:hover{border-color:rgba(168,85,247,0.5);background:rgba(168,85,247,0.14)}' +
      '.nav-wallet-btn svg{width:14px;height:14px;stroke:#a855f7;stroke-width:2;fill:none;flex-shrink:0}' +
      '.nav-wallet-btn span{font-family:"Inter",-apple-system,sans-serif;font-size:11px;font-weight:600;color:#a855f7}' +
      '.nav-wallet-btn.connected{border-color:rgba(0,230,138,0.3);background:rgba(0,230,138,0.08)}' +
      '.nav-wallet-btn.connected:hover{border-color:rgba(0,230,138,0.5);background:rgba(0,230,138,0.14)}' +
      '.nav-wallet-btn.connected svg{stroke:#00e68a}' +
      '.nav-wallet-btn.connected span{color:#00e68a}' +
      /* Mobile menu base styles (hidden on all screens by default) */
      '.nav-hamburger{display:none}' +
      '.nav-mobile-menu{display:none;position:fixed;inset:0;z-index:9998;background:rgba(10,10,15,0.98);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);flex-direction:column;overflow-y:auto;padding:0}' +
      '.nav-mobile-menu.open{display:flex}' +
      '.nav-mobile-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.06)}' +
      '.nav-mobile-close{display:flex;align-items:center;justify-content:center;width:44px;height:44px;border:none;background:none;cursor:pointer}' +
      '.nav-mobile-close svg{width:24px;height:24px;stroke:#f0f0f5;stroke-width:2;fill:none}' +
      '.nav-mobile-links{padding:8px 0;flex:1}' +
      '.nav-mobile-sep{height:1px;background:rgba(255,255,255,0.06);margin:8px 16px}' +
      '.nav-mobile-link{display:flex;align-items:center;gap:10px;padding:14px 20px;font-family:"Inter",-apple-system,sans-serif;font-size:15px;font-weight:500;color:#c0c0d0;text-decoration:none;min-height:48px;transition:background .1s}' +
      '.nav-mobile-link:hover,.nav-mobile-link:active{background:rgba(255,255,255,0.05)}' +
      '.nav-mobile-link.active{color:#f0f0f5;font-weight:600}' +
      '.nav-mobile-link.gold{color:#00e68a}' +
      '.nav-mobile-auth{padding:16px 20px;border-top:1px solid rgba(255,255,255,0.06)}' +
      '.nav-mobile-auth a{display:block;text-align:center;padding:12px;border-radius:10px;font-family:"Inter",-apple-system,sans-serif;font-size:14px;font-weight:600;text-decoration:none;min-height:48px;line-height:24px}' +
      '.nav-mobile-auth .mob-signin{color:#f0f0f5;border:1px solid rgba(255,255,255,0.12);margin-bottom:10px}' +
      '.nav-mobile-auth .mob-dash{color:#0a0a0f;background:linear-gradient(135deg,#00e68a,#4d9fff)}' +
      /* Mobile breakpoint — show hamburger, hide desktop nav */
      '@media(max-width:768px){.topbar{padding:12px 16px}.nav-links{display:none}.nav-auth{display:none}' +
      '.nav-hamburger{display:flex;align-items:center;justify-content:center;width:44px;height:44px;border:none;background:none;cursor:pointer;padding:0;margin-left:auto;flex-shrink:0}' +
      '.nav-hamburger svg{width:24px;height:24px;stroke:#f0f0f5;stroke-width:2;fill:none}' +
      '}' +
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
      '.hfx-search-item-icon{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08)}' +
      '.hfx-search-item-icon.page{background:rgba(77,159,255,0.12);border-color:rgba(77,159,255,0.2)}' +
      '.hfx-search-item-icon.market{background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.1)}' +
      '.hfx-search-item-body{flex:1;min-width:0}' +
      '.hfx-search-item-title{font-family:"Inter",-apple-system,sans-serif;font-size:13px;color:#f0f0f5;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}' +
      '.hfx-search-item-meta{font-family:"Inter",-apple-system,sans-serif;font-size:11px;color:#8888a0;margin-top:1px}' +
      '.hfx-search-item-odds{display:flex;flex-direction:column;align-items:flex-end;flex-shrink:0;gap:1px}' +
      '.hfx-search-item-odds .pct{font-family:"JetBrains Mono",monospace;font-size:14px;font-weight:700;color:#f0f0f5}' +
      '.hfx-search-item-odds .vol{font-family:"Inter",-apple-system,sans-serif;font-size:10px;color:#8888a0}' +
      /* Browse pills */
      '.hfx-search-browse{padding:12px 18px 8px}' +
      '.hfx-search-browse-label{font-family:"Inter",-apple-system,sans-serif;font-size:10px;font-weight:600;color:#55556a;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:10px}' +
      '.hfx-search-browse-pills{display:flex;flex-wrap:wrap;gap:6px}' +
      '.hfx-search-pill{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:20px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);cursor:pointer;transition:all .15s;text-decoration:none;font-family:"Inter",-apple-system,sans-serif;font-size:12px;color:#c0c0d0;font-weight:500}' +
      '.hfx-search-pill:hover{background:rgba(255,255,255,0.1);border-color:rgba(255,255,255,0.15);color:#f0f0f5}' +
      '.hfx-search-pill svg{width:14px;height:14px;flex-shrink:0}' +
      /* Footer */
      '.hfx-search-footer{display:flex;align-items:center;gap:12px;padding:8px 18px;border-top:1px solid rgba(255,255,255,0.06);font-family:"Inter",-apple-system,sans-serif;font-size:10px;color:#55556a}' +
      '.hfx-search-footer kbd{font-size:10px;color:#666680;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);border-radius:3px;padding:1px 4px}' +
      '@media(max-width:768px){.hfx-search-overlay{padding:8px;align-items:flex-start}.hfx-search-modal{max-height:85vh;max-width:100%;border-radius:12px}.hfx-search-footer{display:none}}';
    document.head.appendChild(style);
  }

  // Primary links shown in desktop nav bar — alpha-source order
  var primaryLinks = [
    { href: '/terminal', label: '🖥 Terminal', gold: true },
    { href: '/alpha', label: '⚡ Alpha', gold: true },
    { href: '/signals', label: 'Signals' },
    { href: '/screener', label: 'Screener' },
    { href: '/whales', label: 'Market Intel' },
    { href: '/arbitrage', label: 'Arbitrage', gold: true },
    { href: '/crystal-ball', label: 'Crystal Ball' },
    { href: '/predictors', label: 'Predictors' },
    { href: '/feed', label: '💬 Feed', gold: true },
    { href: _navUserId ? '/m/' + _navUserId : '/creator/login', label: '👤 Profile', show: isLoggedIn }
  ];
  // Secondary links in "More" dropdown — reordered: actionable first, meta last
  var moreLinks = [
    { href: '/rewards', label: '💰 Rewards', gold: true },
    { href: '/brief', label: '🧠 AI Brief', gold: true },
    { href: '/high-prob', label: '🎯 99% Bets', gold: true },
    { href: '/odds', label: '🎲 Odds' },
    { sep: true },
    { href: '/data', label: '📈 Data' },
    { href: '/ecosystem', label: '🌐 Ecosystem' },
    { href: '/features', label: '✨ Features' },
    { href: '/api-docs', label: '⚙️ API' }
  ];
  // Combined for search index
  var links = primaryLinks.concat(moreLinks.filter(function(l){return !l.sep}));

  var path = window.location.pathname.replace(/\/$/, '') || '/';

  var isLoggedIn = !!(localStorage.getItem('hf_token') || localStorage.getItem('hf_creator_token'));

  // Decode user ID from JWT for profile link
  var _navUserId = null;
  try {
    var _tok = localStorage.getItem('hf_token') || localStorage.getItem('hf_creator_token');
    if (_tok) {
      var _p = JSON.parse(atob(_tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      _navUserId = _p.userId || _p.sub || _p.id || null;
    }
  } catch (e) {}

  // Check if any "More" link is active (to highlight More button)
  var moreActive = moreLinks.some(function(l) { return !l.sep && path === l.href; });

  var nav = document.createElement('nav');
  nav.className = 'topbar';
  nav.innerHTML =
    '<a href="/" class="topbar-logo">HYPER<span>FLEX</span></a>' +
    '<div class="nav-links">' +
      primaryLinks.filter(function(l) { return l.show !== false; }).map(function(l) {
        var isActive = path === l.href || (l.href.indexOf('/m/') === 0 && path.indexOf('/m/') === 0);
        var cls = 'nav-link' + (isActive ? ' active' : '');
        var style = l.gold && !isActive ? ' style="color:#00e68a"' : '';
        return '<a href="' + l.href + '" class="' + cls + '"' + style + '>' + l.label + '</a>';
      }).join('') +
      '<div class="nav-more-wrap">' +
        '<button class="nav-more-btn' + (moreActive ? ' active' : '') + '" id="navMoreBtn" title="More">' +
          '<svg viewBox="0 0 24 24" style="width:18px;height:18px"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>' +
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
      '<button class="nav-wallet-btn" id="navWalletBtn" title="Connect Wallet">' +
        '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M16 14a2 2 0 100-4 2 2 0 000 4z"/><path d="M2 10h20"/></svg>' +
        '<span id="navWalletLabel">Connect</span>' +
      '</button>' +
      (isLoggedIn
        ? ''
        : '<a href="/creator/login" class="nav-signin">Sign in</a>') +
    '</div>' +
    '<button class="nav-hamburger" id="navHamburger">' +
      '<svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>' +
    '</button>';

  var root = document.getElementById('nav-root');
  if (root) {
    root.appendChild(nav);
  } else {
    document.body.insertBefore(nav, document.body.firstChild);
  }

  // ── Mobile hamburger menu ──
  // Order matches the priority tiers: Your Stuff → Find Alpha → Discover → Research → Meta
  (function() {
    var allLinks = [];
    // Tier 1 — Your Stuff (logged-in only)
    allLinks.push({ href: '#', label: '🔗 Connect Wallet', id: 'navMobileWalletLink', gold: true });
    if (isLoggedIn) {
      allLinks.push({ href: _navUserId ? '/m/' + _navUserId : '/creator/login', label: '👤 My Profile', gold: true });
      allLinks.push({ href: _navUserId ? '/passport/' + _navUserId : '#', label: '🛂 Prediction Passport', gold: true });
      allLinks.push({ href: '/rewards', label: '💰 Rewards', gold: true });
    }
    allLinks.push({ sep: true });
    // Tier 2 — Find Alpha (the primary alpha sources)
    allLinks = allLinks.concat(primaryLinks);
    allLinks.push({ sep: true });
    // Tier 3+ — More dropdown items, but skip Rewards if already shown in Tier 1
    var dropdownLinks = isLoggedIn
      ? moreLinks.filter(function(l) { return l.href !== '/rewards'; })
      : moreLinks;
    allLinks = allLinks.concat(dropdownLinks);

    var mobileMenu = document.createElement('div');
    mobileMenu.className = 'nav-mobile-menu';
    mobileMenu.id = 'navMobileMenu';
    var mLinksHtml = allLinks.map(function(l) {
      if (l.sep) return '<div class="nav-mobile-sep"></div>';
      var isActive = path === l.href;
      var cls = 'nav-mobile-link' + (isActive ? ' active' : '') + (l.gold && !isActive ? ' gold' : '');
      var idAttr = l.id ? ' id="' + l.id + '"' : '';
      return '<a href="' + l.href + '" class="' + cls + '"' + idAttr + '>' + l.label + '</a>';
    }).join('');
    mobileMenu.innerHTML =
      '<div class="nav-mobile-header">' +
        '<a href="/" class="topbar-logo" style="font-family:Inter,-apple-system,sans-serif;font-weight:800;font-size:18px;letter-spacing:-0.5px;color:#f0f0f5;text-decoration:none">HYPER<span style="background:linear-gradient(135deg,#00e68a,#4d9fff,#a855f7);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">FLEX</span></a>' +
        '<button class="nav-mobile-close" id="navMobileClose">' +
          '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="nav-mobile-links">' + mLinksHtml + '</div>' +
      '<div class="nav-mobile-auth">' +
        (isLoggedIn
          ? ''
          : '<a href="/creator/login" class="mob-signin">Sign in</a>') +
      '</div>';
    document.body.appendChild(mobileMenu);

    var hamburger = document.getElementById('navHamburger');
    var closeBtn = document.getElementById('navMobileClose');
    if (hamburger) {
      hamburger.addEventListener('click', function() {
        mobileMenu.classList.add('open');
        document.body.style.overflow = 'hidden';
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        mobileMenu.classList.remove('open');
        document.body.style.overflow = '';
      });
    }
    // Close on link click
    mobileMenu.querySelectorAll('.nav-mobile-link').forEach(function(a) {
      a.addEventListener('click', function() {
        mobileMenu.classList.remove('open');
        document.body.style.overflow = '';
      });
    });
  })();

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
      if (!dd.contains(e.target) && !btn.contains(e.target)) {
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

  // ── Connect Wallet ──
  (function() {
    var walletBtn = document.getElementById('navWalletBtn');
    var walletLabel = document.getElementById('navWalletLabel');
    var mobileWalletLink = document.getElementById('navMobileWalletLink');
    var STORAGE_KEY = 'hfx_wallet_address';

    function shortAddr(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : ''; }

    function setConnected(addr) {
      if (walletBtn && walletLabel) {
        walletBtn.classList.add('connected');
        walletBtn.title = addr;
        walletLabel.textContent = shortAddr(addr);
      }
      if (mobileWalletLink) {
        mobileWalletLink.innerHTML = '🔗 ' + shortAddr(addr);
        mobileWalletLink.href = '/creator/dashboard';
      }
    }

    function setDisconnected() {
      if (walletBtn && walletLabel) {
        walletBtn.classList.remove('connected');
        walletBtn.title = 'Connect Wallet';
        walletLabel.textContent = 'Connect';
      }
      if (mobileWalletLink) {
        mobileWalletLink.innerHTML = '🔗 Connect Wallet';
        mobileWalletLink.href = '#';
      }
    }

    // Restore from localStorage on load
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setConnected(saved);

    // Hide wallet button if no ethereum provider
    if (!window.ethereum) {
      if (walletBtn) walletBtn.style.display = 'none';
      if (mobileWalletLink) mobileWalletLink.style.display = 'none';
      return;
    }

    // Check if already connected (without prompting)
    if (!saved) {
      window.ethereum.request({ method: 'eth_accounts' }).then(function(accounts) {
        if (accounts && accounts.length > 0) {
          localStorage.setItem(STORAGE_KEY, accounts[0]);
          setConnected(accounts[0]);
        }
      }).catch(function() {});
    }

    async function connectWallet() {
      try {
        var accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (accounts && accounts.length > 0) {
          localStorage.setItem(STORAGE_KEY, accounts[0]);
          setConnected(accounts[0]);
        }
      } catch (e) {
        // User rejected or error — ignore
        console.warn('Wallet connect failed:', e.message || e);
      }
    }

    if (walletBtn) {
      walletBtn.addEventListener('click', function() {
        var current = localStorage.getItem(STORAGE_KEY);
        if (current) {
          // Already connected — go to dashboard portfolio
          window.location.href = '/creator/dashboard#portfolio';
        } else {
          connectWallet();
        }
      });
    }
    if (mobileWalletLink) {
      mobileWalletLink.addEventListener('click', function(e) {
        var current = localStorage.getItem(STORAGE_KEY);
        if (current) {
          // Already connected — let the href navigate to dashboard
          var mm = document.getElementById('navMobileMenu');
          if (mm) { mm.classList.remove('open'); document.body.style.overflow = ''; }
        } else {
          e.preventDefault();
          connectWallet();
        }
      });
    }

    // Listen for account changes
    if (window.ethereum.on) {
      window.ethereum.on('accountsChanged', function(accounts) {
        if (accounts && accounts.length > 0) {
          localStorage.setItem(STORAGE_KEY, accounts[0]);
          setConnected(accounts[0]);
        } else {
          localStorage.removeItem(STORAGE_KEY);
          setDisconnected();
        }
      });
    }
  })();

  // ── Global Search Modal (Cmd+K / Ctrl+K) ──
  (function() {
    // Page definitions for static search
    var pages = [
      { name: 'Signals', desc: 'Live trading signals', href: '/signals', icon: '📡' },
      { name: 'Crystal Ball', desc: 'Market analysis & scoring', href: '/crystal-ball', icon: '🔮' },
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
      { name: 'Arbitrage', desc: 'Cross-platform price spreads', href: '/arbitrage', icon: '⚖️' },
      { name: 'Home', desc: 'Live market activity & intelligence', href: '/', icon: '🏠' },
      { name: 'Rewards', desc: 'Earn from referrals', href: '/rewards', icon: '💰' },
      { name: 'Data', desc: 'Market data & analytics', href: '/data', icon: '📈' },
      { name: 'API', desc: 'Developer API docs', href: '/api-docs', icon: '⚙️' },
      { name: '99% Bets', desc: 'High probability markets', href: '/high-prob', icon: '🎯' },
      { name: 'Dashboard', desc: 'Your creator dashboard', href: '/creator/dashboard', icon: '🛠' },
      { name: 'Compare', desc: 'HYPERFLEX vs competitors', href: '/compare', icon: '⚖️' },
      { name: 'Copy Bot', desc: 'Auto-mirror whale trades', href: '/whales#copy', icon: '🤖' }
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
          '<div class="hfx-search-hint" id="hfxSearchHint"></div>' +
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

    var browseHtml =
      '<div class="hfx-search-browse">' +
        '<div class="hfx-search-browse-label">Browse</div>' +
        '<div class="hfx-search-browse-pills">' +
          '<a class="hfx-search-pill" href="/alpha"><svg viewBox="0 0 24 24" fill="none" stroke="#00e68a" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke-linejoin="round" stroke-linecap="round"/></svg> Top Edges</a>' +
          '<a class="hfx-search-pill" href="/signals"><svg viewBox="0 0 24 24" fill="none" stroke="#4d9fff" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2" stroke-linejoin="round" stroke-linecap="round"/></svg> Signals</a>' +
          '<a class="hfx-search-pill" href="/whales"><svg viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12a4 4 0 008 0" stroke-linecap="round"/></svg> Whale Intel</a>' +
          '<a class="hfx-search-pill" href="/screener"><svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> Screener</a>' +
          '<a class="hfx-search-pill" href="/predictors"><svg viewBox="0 0 24 24" fill="none" stroke="#c9920d" stroke-width="2"><path d="M12 2L15 8.5 22 9.5 17 14.5 18 21.5 12 18 6 21.5 7 14.5 2 9.5 9 8.5z" stroke-linejoin="round"/></svg> Predictors</a>' +
        '</div>' +
      '</div>';

    function openSearch() {
      overlay.classList.add('active');
      input.value = '';
      activeIndex = -1;
      lastQuery = '';
      results.innerHTML = browseHtml;
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
      var isKalshi = m.platform === 'kalshi' || (m.url && m.url.indexOf('kalshi.com') !== -1);
      var isSportsbook = m.platform === 'sportsbook' || (m.url && m.url.indexOf('odds-api') !== -1);
      var href;
      if (isKalshi || isSportsbook) {
        href = m.url || '#';
      } else if (m.slug) {
        href = '/market/' + m.slug;
      } else if (m.url && typeof window.hfxMarketUrl === 'function') {
        href = window.hfxMarketUrl(m.url);
      } else if (m.url && typeof window.polyRef === 'function') {
        href = window.polyRef(m.url);
      } else {
        href = m.url || '#';
      }
      // Volume formatting
      var volStr = '';
      if (m.volume_24h || m.volume) {
        var v = m.volume_24h || m.volume || 0;
        volStr = v >= 1e6 ? '$' + (v/1e6).toFixed(0) + 'M' : v >= 1e3 ? '$' + (v/1e3).toFixed(0) + 'K' : '$' + v;
      }
      // Icon — simple SVG chart for markets
      var iconSvg = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 12L6 7L9 9.5L14 4" stroke="#8888a0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      return '<a href="' + escHtml(href) + '" class="hfx-search-item" data-idx="' + idx + '"' + (isKalshi || isSportsbook ? ' target="_blank" rel="noopener"' : '') + '>' +
        '<div class="hfx-search-item-icon market">' + iconSvg + '</div>' +
        '<div class="hfx-search-item-body">' +
          '<div class="hfx-search-item-title">' + escHtml(m.question) + '</div>' +
        '</div>' +
        '<div class="hfx-search-item-odds">' +
          '<span class="pct">' + yesStr + '</span>' +
          (volStr ? '<span class="vol">' + volStr + '</span>' : '') +
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
        results.innerHTML = browseHtml;
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

// Global helper: convert Polymarket URL to our market page URL.
// Routing order of preference (most → least valuable revenue):
//   1. Internal /market/:slug — earns BUILDER FEES on every order
//   2. polymarket.com + ?r=REF — earns REFERRAL fees via click interceptor
//   3. Raw polymarket.com — last resort
// Usage: hfxMarketUrl('https://polymarket.com/event/us-x-iran-ceasefire-by-march-31')
// Returns: '/market/us-x-iran-ceasefire-by-march-31'
window.hfxMarketUrl = function(polyUrl) {
  if (!polyUrl || typeof polyUrl !== 'string') return '/screener';
  // Already our URL
  if (polyUrl.startsWith('/market/')) return polyUrl;
  // Extract slug from polymarket.com/event/SLUG — preferred (builder fees)
  var match = polyUrl.match(/polymarket\.com\/event\/([a-z0-9\-]+)/i);
  if (match) return '/market/' + match[1].toLowerCase();
  // Try extracting from any URL-like slug
  var parts = polyUrl.split('/').filter(function(p) { return p && p !== 'https:' && p !== 'http:' && !p.includes('.'); });
  if (parts.length) return '/market/' + parts[parts.length - 1].toLowerCase();
  // Last resort: external polymarket.com with our referral code
  if (polyUrl.indexOf('polymarket.com') !== -1 && typeof window.polyRef === 'function') {
    return window.polyRef(polyUrl);
  }
  return polyUrl;
};

// ── hfxOpenDeposit — race-safe deposit opener ──
// Call from anywhere. If HFXDeposit is ready, opens it. If not, polls
// every 200ms for up to 3 seconds waiting for it to load before giving up.
// This is what every Deposit button on the site should use instead of
// calling HFXDeposit.open() directly — avoids the "module still loading"
// race condition when users click before the script finishes loading.
window.hfxOpenDeposit = function() {
  var attempts = 0;
  var maxAttempts = 15; // 15 × 200ms = 3 seconds
  function tryOpen() {
    if (window.HFXDeposit && typeof window.HFXDeposit.open === 'function') {
      try { window.HFXDeposit.open(); } catch (e) { console.error('[hfxOpenDeposit] error:', e); }
      return;
    }
    attempts++;
    if (attempts >= maxAttempts) {
      console.warn('[hfxOpenDeposit] HFXDeposit did not load after ' + (maxAttempts * 200) + 'ms');
      alert('Could not load the deposit module. Please refresh the page and try again.');
      return;
    }
    setTimeout(tryOpen, 200);
  }
  tryOpen();
};
