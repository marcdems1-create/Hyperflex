/**
 * HYPERFLEX Copy Bot — client runtime
 *
 * Connects to /api/copy-bot/stream (SSE) for any page that includes this file.
 * When a copy opportunity fires:
 *   1. Show a persistent toast/banner with whale context + "Execute" / "Skip"
 *   2. If user has wallet + CLOB keys, attempt auto-execution in background
 *   3. If wallet locked / tab backgrounded / no keys → stay in banner for manual click
 *   4. Report result to server (POST /api/copy-bot/trades/:id/executed or /skipped)
 *
 * Execution reuses the market.html order-signing pattern: fetch tick/neg_risk/fee,
 * build EIP-712 order, sign via HFXWallet, submit to CLOB with builder headers.
 *
 * Usage:
 *   <script src="/nav.js"></script>
 *   <script src="/copy-bot.js"></script>
 *   window.HFXCopyBot.start()  // called automatically on load if auth token exists
 */
(function() {
  'use strict';

  var _sse = null;
  var _reconnectTimer = null;
  var _activeBanners = {}; // trade_id -> banner element
  var _executingTrades = new Set(); // prevent double-execute (in-tab)
  var LOCK_PREFIX = 'hfx_cb_lock_'; // cross-tab lock prefix
  var LOCK_TTL_MS = 60000; // lock expires after 60s

  function _log() { try { console.log.apply(console, ['[copy-bot]'].concat([].slice.call(arguments))); } catch(e){} }
  function _warn() { try { console.warn.apply(console, ['[copy-bot]'].concat([].slice.call(arguments))); } catch(e){} }

  function _getToken() {
    return localStorage.getItem('hf_token') || localStorage.getItem('hf_creator_token') || '';
  }

  function _hasWallet() {
    return !!(localStorage.getItem('poly_api_key') &&
              localStorage.getItem('poly_api_secret') &&
              localStorage.getItem('hf_poly_wallet') &&
              localStorage.getItem('poly_eoa_address') &&
              window.ethereum);
  }

  // Cross-tab execution lock — prevents two tabs from both trying to execute the same trade
  function _acquireLock(tradeId) {
    try {
      var key = LOCK_PREFIX + tradeId;
      var existing = localStorage.getItem(key);
      if (existing) {
        var ts = parseInt(existing, 10) || 0;
        if (Date.now() - ts < LOCK_TTL_MS) return false; // another tab holds it
      }
      localStorage.setItem(key, String(Date.now()));
      return true;
    } catch (e) { return true; } // if localStorage fails, allow execution
  }
  function _releaseLock(tradeId) {
    try { localStorage.removeItem(LOCK_PREFIX + tradeId); } catch (e) {}
  }

  // Fetch USDC balance from proxy wallet (non-blocking best-effort)
  async function _getUsdcBalance() {
    try {
      var proxy = localStorage.getItem('hf_poly_wallet');
      if (!proxy) return null;
      var r = await fetch('https://polygon-bor-rpc.publicnode.com', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          jsonrpc:'2.0', id:1, method:'eth_call',
          params:[{
            to: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
            data: '0x70a08231' + proxy.slice(2).padStart(64, '0')
          }, 'latest']
        })
      });
      var j = await r.json();
      if (!j.result) return null;
      var balWei = BigInt(j.result);
      return Number(balWei) / 1e6; // USDC has 6 decimals
    } catch (e) { return null; }
  }

  // ── SSE Connection ──
  function start() {
    if (_sse) return;
    var token = _getToken();
    if (!token) { _log('no auth token, skipping SSE'); return; }
    try {
      _sse = new EventSource('/api/copy-bot/stream?token=' + encodeURIComponent(token));
      _sse.addEventListener('copy_opportunity', function(e) {
        try {
          var data = JSON.parse(e.data);
          _log('opportunity:', data);
          _handleOpportunity(data);
        } catch (err) { _warn('parse error', err.message); }
      });
      _sse.addEventListener('copy_exit', function(e) {
        try {
          var data = JSON.parse(e.data);
          _log('exit signal:', data);
          _handleExit(data);
        } catch (err) { _warn('parse error', err.message); }
      });
      _sse.onerror = function() {
        if (_sse) { try { _sse.close(); } catch(e){} _sse = null; }
        if (_reconnectTimer) clearTimeout(_reconnectTimer);
        _reconnectTimer = setTimeout(start, 10000);
      };
      _log('connected');
    } catch (e) { _warn('connect failed:', e.message); }
  }

  function stop() {
    if (_sse) { try { _sse.close(); } catch(e){} _sse = null; }
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  }

  // ── Opportunity handler ──
  async function _handleOpportunity(data) {
    if (!data.trade_id) return;
    if (_activeBanners[data.trade_id]) return; // already showing in this tab

    // ── DRY RUN / QA TEST mode ──
    // Server-side QA endpoints set _qa_test: true and _dry_run: true
    // Dry run: show banner + pre-flight UI but NEVER submit a real order
    var isDryRun = !!(data._dry_run || data._qa_test);

    // Pre-flight check: wallet + balance
    var wallet = _hasWallet();
    var balance = wallet ? await _getUsdcBalance() : null;
    var needed = parseFloat(data.alloc_usd || 0);
    var canExecute = wallet && (balance === null || balance >= needed);
    var preflightReason = null;
    if (isDryRun) preflightReason = '🧪 DRY RUN — banner only, no order will be placed';
    else if (!wallet) preflightReason = 'Connect wallet to execute';
    else if (balance !== null && balance < needed) preflightReason = 'Need $' + needed.toFixed(0) + ' USDC (you have $' + balance.toFixed(2) + ')';

    _showBanner(data, { canExecute: canExecute, reason: preflightReason, balance: balance, dryRun: isDryRun });

    // Auto-execute only if NOT a dry run
    if (!isDryRun && canExecute && _acquireLock(data.trade_id)) {
      _executeTrade(data).catch(function(err) {
        _warn('auto-exec failed:', err.message);
        _releaseLock(data.trade_id);
      });
    }
  }

  // ── Exit handler ──
  async function _handleExit(data) {
    if (!data.trade_id) return;
    // Show distinct exit banner (red) — never auto-execute exits, require manual confirm
    _showExitBanner(data);
  }

  // ── Banner UI ──
  function _showBanner(data, preflight) {
    preflight = preflight || { canExecute: true };
    var b = document.createElement('div');
    b.id = 'cbBanner_' + data.trade_id;
    // Dry-run banners get a yellow border to clearly mark them as test events
    var borderColor = preflight.dryRun ? '#f59e0b' : '#a855f7';
    var shadowColor = preflight.dryRun ? 'rgba(245,158,11,0.3)' : 'rgba(168,85,247,0.3)';
    b.style.cssText = 'position:fixed;bottom:20px;right:20px;width:340px;background:linear-gradient(135deg,#0c0c0b,#141412);color:#fff;padding:16px;border-radius:12px;border:1px solid ' + borderColor + ';box-shadow:0 8px 32px ' + shadowColor + ';font-family:Inter,sans-serif;font-size:13px;z-index:10001;animation:cbSlideIn 0.3s ease-out';
    var sideColor = data.side && data.side.toUpperCase() === 'YES' ? '#00e68a' : '#ff4d6a';
    var priceCents = Math.round((data.price || 0.5) * 100);

    // Build CTA based on preflight state
    var ctaHtml;
    if (preflight.canExecute) {
      ctaHtml = '<button id="cbExec_' + data.trade_id + '" onclick="HFXCopyBot.execute(\'' + data.trade_id + '\')" style="flex:1;background:#a855f7;color:#fff;border:none;padding:8px 12px;border-radius:6px;font-family:monospace;font-size:11px;font-weight:700;cursor:pointer">Execute $' + Math.round(data.alloc_usd) + ' →</button>' +
                '<button onclick="HFXCopyBot.skip(\'' + data.trade_id + '\',\'user_skipped\')" style="background:rgba(255,255,255,0.08);color:#888;border:none;padding:8px 12px;border-radius:6px;font-family:monospace;font-size:11px;cursor:pointer">Skip</button>';
    } else if (!_hasWallet()) {
      // No wallet — link to market page for setup flow
      var setupUrl = data.slug ? '/market/' + data.slug : '/whales';
      ctaHtml = '<a href="' + setupUrl + '" style="flex:1;background:#4d9fff;color:#fff;text-align:center;padding:8px 12px;border-radius:6px;font-family:monospace;font-size:11px;font-weight:700;text-decoration:none">Connect wallet →</a>' +
                '<button onclick="HFXCopyBot.skip(\'' + data.trade_id + '\',\'no_wallet\')" style="background:rgba(255,255,255,0.08);color:#888;border:none;padding:8px 12px;border-radius:6px;font-family:monospace;font-size:11px;cursor:pointer">Skip</button>';
    } else {
      // Wallet exists but insufficient balance — show warning
      ctaHtml = '<button disabled style="flex:1;background:rgba(255,77,106,0.1);color:#ff4d6a;border:1px solid rgba(255,77,106,0.3);padding:8px 12px;border-radius:6px;font-family:monospace;font-size:11px;font-weight:700;cursor:not-allowed">Insufficient USDC</button>' +
                '<button onclick="HFXCopyBot.skip(\'' + data.trade_id + '\',\'no_balance\')" style="background:rgba(255,255,255,0.08);color:#888;border:none;padding:8px 12px;border-radius:6px;font-family:monospace;font-size:11px;cursor:pointer">Skip</button>';
    }

    var statusMsg = preflight.reason || '';

    b.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
        '<span style="font-size:18px">' + (preflight.dryRun ? '🧪' : '🤖') + '</span>' +
        '<span style="font-family:monospace;font-size:11px;color:' + (preflight.dryRun ? '#f59e0b' : '#a855f7') + ';font-weight:700;letter-spacing:1px">' + (preflight.dryRun ? 'QA TEST (DRY RUN)' : 'COPY OPPORTUNITY') + '</span>' +
        '<button onclick="HFXCopyBot.skip(\'' + data.trade_id + '\',\'dismissed\')" style="margin-left:auto;background:none;border:none;color:#888;font-size:18px;cursor:pointer;padding:0 4px">✕</button>' +
      '</div>' +
      '<div style="font-weight:700;margin-bottom:4px">' + _esc(data.whale_name || 'A whale') + ' opened position</div>' +
      '<div style="font-size:12px;color:#aaa;line-height:1.4;margin-bottom:8px">' + _esc((data.market || '').substring(0, 80)) + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">' +
        '<span style="font-family:monospace;font-size:12px;font-weight:700;color:' + sideColor + '">' + (data.side || '').toUpperCase() + ' ' + priceCents + '¢</span>' +
        '<span style="font-family:monospace;font-size:11px;color:#888">·</span>' +
        '<span style="font-family:monospace;font-size:11px;color:#888">Whale: $' + (data.whale_size >= 1000 ? Math.round(data.whale_size/1000) + 'K' : Math.round(data.whale_size)) + '</span>' +
        (preflight.balance !== null && preflight.balance !== undefined ? '<span style="font-family:monospace;font-size:11px;color:#888">·</span><span style="font-family:monospace;font-size:11px;color:#888">Bal: $' + preflight.balance.toFixed(0) + '</span>' : '') +
      '</div>' +
      '<div style="display:flex;gap:6px">' + ctaHtml + '</div>' +
      '<div id="cbStatus_' + data.trade_id + '" style="margin-top:8px;font-family:monospace;font-size:10px;color:' + (statusMsg ? '#f59e0b' : '#888') + ';min-height:12px">' + _esc(statusMsg) + '</div>';

    if (!document.getElementById('cbBannerStyle')) {
      var style = document.createElement('style');
      style.id = 'cbBannerStyle';
      style.textContent = '@keyframes cbSlideIn{from{transform:translateX(380px);opacity:0}to{transform:translateX(0);opacity:1}}';
      document.head.appendChild(style);
    }
    document.body.appendChild(b);
    _activeBanners[data.trade_id] = data;

    // Auto-dismiss after 2 min if no action
    setTimeout(function() {
      if (_activeBanners[data.trade_id] && !_executingTrades.has(data.trade_id)) {
        skip(data.trade_id, 'timeout');
      }
    }, 120000);
  }

  // ── Exit banner (red, manual-only) ──
  function _showExitBanner(data) {
    if (_activeBanners['exit_' + data.trade_id]) return;
    var b = document.createElement('div');
    b.id = 'cbExitBanner_' + data.trade_id;
    b.style.cssText = 'position:fixed;bottom:20px;right:20px;width:340px;background:linear-gradient(135deg,#1a0a0a,#2a0f0f);color:#fff;padding:16px;border-radius:12px;border:1px solid #ff4d6a;box-shadow:0 8px 32px rgba(255,77,106,0.3);font-family:Inter,sans-serif;font-size:13px;z-index:10002;animation:cbSlideIn 0.3s ease-out';
    var sideColor = data.side && data.side.toUpperCase() === 'YES' ? '#00e68a' : '#ff4d6a';
    var entryCents = Math.round((data.entry_price || 0) * 100);
    var currentCents = Math.round((data.current_price || data.entry_price || 0) * 100);
    var priceDelta = currentCents - entryCents;
    var marketUrl = data.slug ? '/market/' + data.slug : '#';
    b.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
        '<span style="font-size:18px">🚪</span>' +
        '<span style="font-family:monospace;font-size:11px;color:#ff4d6a;font-weight:700;letter-spacing:1px">WHALE EXITED</span>' +
        '<button onclick="document.getElementById(\'cbExitBanner_' + data.trade_id + '\').remove()" style="margin-left:auto;background:none;border:none;color:#888;font-size:18px;cursor:pointer;padding:0 4px">✕</button>' +
      '</div>' +
      '<div style="font-weight:700;margin-bottom:4px">' + _esc(data.whale_name || 'A whale') + ' closed their position</div>' +
      '<div style="font-size:12px;color:#aaa;line-height:1.4;margin-bottom:8px">' + _esc((data.market || '').substring(0, 80)) + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-family:monospace;font-size:11px;flex-wrap:wrap">' +
        '<span style="color:' + sideColor + '">' + (data.side || '') + '</span>' +
        '<span style="color:#888">·</span>' +
        '<span style="color:#888">Your size: $' + Math.round(data.size || 0) + '</span>' +
        '<span style="color:#888">·</span>' +
        '<span style="color:#aaa">' + entryCents + '¢ → ' + currentCents + '¢ <span style="color:' + (priceDelta >= 0 ? '#00e68a' : '#ff4d6a') + '">(' + (priceDelta >= 0 ? '+' : '') + priceDelta + '¢)</span></span>' +
      '</div>' +
      '<div style="display:flex;gap:6px">' +
        '<a href="' + marketUrl + '?from=copy-exit" style="flex:1;background:#ff4d6a;color:#fff;text-align:center;padding:8px 12px;border-radius:6px;font-family:monospace;font-size:11px;font-weight:700;text-decoration:none">Review & close →</a>' +
        '<button onclick="document.getElementById(\'cbExitBanner_' + data.trade_id + '\').remove()" style="background:rgba(255,255,255,0.08);color:#888;border:none;padding:8px 12px;border-radius:6px;font-family:monospace;font-size:11px;cursor:pointer">Hold</button>' +
      '</div>';
    document.body.appendChild(b);
    _activeBanners['exit_' + data.trade_id] = data;
    // Exit banners persist for 5 min
    setTimeout(function() { b.remove(); delete _activeBanners['exit_' + data.trade_id]; }, 5 * 60000);
  }

  function _setStatus(tradeId, msg, color) {
    var el = document.getElementById('cbStatus_' + tradeId);
    if (el) { el.textContent = msg; if (color) el.style.color = color; }
  }

  function _removeBanner(tradeId) {
    var b = document.getElementById('cbBanner_' + tradeId);
    if (b) b.remove();
    delete _activeBanners[tradeId];
  }

  function _esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // ── Execution ──
  async function execute(tradeId) {
    var data = _activeBanners[tradeId];
    if (!data) return;
    // Dry run: show fake success without hitting CLOB
    if (data._dry_run || data._qa_test) {
      _setStatus(tradeId, '✓ DRY RUN — no real order placed', '#f59e0b');
      var btn = document.getElementById('cbExec_' + tradeId);
      if (btn) { btn.disabled = true; btn.textContent = 'Dry run ✓'; btn.style.background = '#f59e0b'; }
      setTimeout(function() { _removeBanner(tradeId); }, 3000);
      return;
    }
    // Manual click → try to acquire cross-tab lock
    if (!_acquireLock(tradeId)) {
      _setStatus(tradeId, 'Another tab is executing this trade', '#f59e0b');
      return;
    }
    return _executeTrade(data);
  }

  async function _executeTrade(data) {
    if (_executingTrades.has(data.trade_id)) return;
    _executingTrades.add(data.trade_id);

    var execBtn = document.getElementById('cbExec_' + data.trade_id);
    if (execBtn) { execBtn.disabled = true; execBtn.textContent = 'Signing...'; }
    _setStatus(data.trade_id, 'Preparing order...', '#aaa');

    try {
      if (!_hasWallet()) {
        throw new Error('Wallet not connected. Visit a market page and connect MetaMask first.');
      }

      // Final balance check — prevents CLOB 400 errors
      var bal = await _getUsdcBalance();
      var amount = parseFloat(data.alloc_usd);
      if (bal !== null && bal < amount) {
        throw new Error('Insufficient USDC. Have $' + bal.toFixed(2) + ', need $' + amount.toFixed(0));
      }

      // Parse clob token IDs
      var tids = data.clob_token_ids;
      if (typeof tids === 'string') { try { tids = JSON.parse(tids); } catch(e) { tids = []; } }
      if (!tids || !tids.length) throw new Error('No token IDs available for this market');

      // Pick token by side (YES = index 0, NO = index 1)
      var tokenIndex = (data.side || 'YES').toUpperCase() === 'YES' ? 0 : 1;
      var tokenId = tids[tokenIndex] || tids[0];
      if (!tokenId) throw new Error('Could not resolve token ID for ' + data.side);

      var apiKey = localStorage.getItem('poly_api_key');
      var apiSecret = localStorage.getItem('poly_api_secret');
      var apiPassphrase = localStorage.getItem('poly_api_passphrase');
      var proxyAddress = localStorage.getItem('hf_poly_wallet');
      var eoaAddress = localStorage.getItem('poly_eoa_address');

      // Fetch CLOB metadata
      var [tickRes, negRes, feeRes] = await Promise.all([
        fetch('https://clob.polymarket.com/tick-size?token_id=' + encodeURIComponent(tokenId)).then(function(r){return r.ok?r.json():null}).catch(function(){return null}),
        fetch('https://clob.polymarket.com/neg-risk?token_id=' + encodeURIComponent(tokenId)).then(function(r){return r.ok?r.json():null}).catch(function(){return null}),
        fetch('https://clob.polymarket.com/fee-rate?token_id=' + encodeURIComponent(tokenId)).then(function(r){return r.ok?r.json():null}).catch(function(){return null})
      ]);
      var tickSize = (tickRes && tickRes.minimum_tick_size) ? parseFloat(tickRes.minimum_tick_size) : 0.01;
      var isNegRisk = !!(negRes && negRes.neg_risk);
      var feeRateBps = (feeRes && feeRes.base_fee !== undefined) ? String(feeRes.base_fee) : '0';

      // Market-buy order: use current price + small buffer to ensure fill
      // Buy $allocUsd worth of shares at market price (amount already set above for balance check)
      var price = parseFloat(data.price || 0.5);
      // Round price to tick size
      price = Math.round(price / tickSize) * tickSize;
      if (price < tickSize) price = tickSize;
      if (price > 1 - tickSize) price = 1 - tickSize;
      var rawMakerAmt = parseFloat(amount.toFixed(2));  // USDC (2 decimals for market buy)
      var rawTakerAmt = parseFloat((amount / price).toFixed(4)); // shares (4 decimals)

      _setStatus(data.trade_id, 'Signing order...', '#aaa');

      // Sign EIP-712 order via HFXWallet (shared wallet module)
      if (typeof HFXWallet === 'undefined' || !HFXWallet.getSigner) {
        throw new Error('HFXWallet module not loaded on this page. Visit a market page first.');
      }
      var signer = await HFXWallet.getSigner();
      var salt = Math.floor(Math.random() * 9007199254740991);
      var exchange = isNegRisk ? '0xC5d563A36AE78145C45a50134d48A1215220f80a' : '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';

      var signature = await signer.signTypedData(
        { name: 'ClobExchange', version: '1', chainId: 137, verifyingContract: exchange },
        { Order: [
          {name:'salt',type:'uint256'},{name:'maker',type:'address'},{name:'signer',type:'address'},
          {name:'taker',type:'address'},{name:'tokenId',type:'uint256'},{name:'makerAmount',type:'uint256'},
          {name:'takerAmount',type:'uint256'},{name:'expiration',type:'uint256'},{name:'nonce',type:'uint256'},
          {name:'feeRateBps',type:'uint256'},{name:'side',type:'uint8'},{name:'signatureType',type:'uint8'}
        ]},
        {
          salt: salt, maker: proxyAddress, signer: eoaAddress, taker: '0x0000000000000000000000000000000000000000',
          tokenId: tokenId, makerAmount: String(Math.round(rawMakerAmt * 1e6)),
          takerAmount: String(Math.round(rawTakerAmt * 1e6)), expiration: '0', nonce: '0',
          feeRateBps: feeRateBps, side: 0, signatureType: 2
        }
      );

      _setStatus(data.trade_id, 'Submitting to CLOB...', '#aaa');

      // Get builder fee headers
      var builderHeaders = {};
      try {
        var bRes = await fetch('/api/polymarket/builder-sign', { method: 'POST' });
        if (bRes.ok) builderHeaders = await bRes.json();
      } catch (e) {}

      // Submit order
      var body = JSON.stringify({
        order: {
          salt: salt, maker: proxyAddress, signer: eoaAddress, taker: '0x0000000000000000000000000000000000000000',
          tokenId: tokenId, makerAmount: String(Math.round(rawMakerAmt * 1e6)),
          takerAmount: String(Math.round(rawTakerAmt * 1e6)), expiration: '0', nonce: '0',
          feeRateBps: feeRateBps, side: 'BUY', signatureType: 2, signature: signature
        },
        orderType: 'GTC', deferExec: false
      });
      var ts = Math.floor(Date.now() / 1000).toString();
      var hmacMsg = ts + 'POST' + '/order' + body;
      var keyBytes = Uint8Array.from(atob(apiSecret.replace(/-/g,'+').replace(/_/g,'/')), function(c){return c.charCodeAt(0)});
      var cryptoKey = await crypto.subtle.importKey('raw', keyBytes, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
      var sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(hmacMsg));
      var b64Sig = btoa(String.fromCharCode.apply(null, new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

      var headers = {
        'Content-Type': 'application/json',
        'POLY_ADDRESS': proxyAddress, 'POLY_API_KEY': apiKey,
        'POLY_PASSPHRASE': apiPassphrase, 'POLY_TIMESTAMP': ts, 'POLY_SIGNATURE': b64Sig
      };
      Object.assign(headers, builderHeaders);

      var clobRes = await fetch('https://clob.polymarket.com/order', { method: 'POST', headers: headers, body: body });
      var clobData = await clobRes.json();

      if (clobRes.ok && !clobData.error) {
        _setStatus(data.trade_id, '✓ Executed ' + amount.toFixed(0) + ' USDC @ ' + Math.round(price * 100) + '¢', '#00e68a');
        // Report to server
        var token = _getToken();
        fetch('/api/copy-bot/trades/' + data.trade_id + '/executed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ execution_price: price, order_id: clobData.orderID || clobData.orderId || null })
        }).catch(function(){});
        // Release cross-tab lock and remove banner after 4 seconds
        _releaseLock(data.trade_id);
        setTimeout(function() { _removeBanner(data.trade_id); }, 4000);
      } else {
        throw new Error(clobData.error || clobData.message || 'CLOB rejected');
      }
    } catch (err) {
      var msg = err.message || 'Unknown error';
      if (err.code === 'ACTION_REJECTED' || err.code === 4001) msg = 'Signature rejected';
      _setStatus(data.trade_id, '✗ ' + msg, '#ff4d6a');
      if (execBtn) { execBtn.disabled = false; execBtn.textContent = 'Retry →'; }
      _executingTrades.delete(data.trade_id);
      _releaseLock(data.trade_id);
    }
  }

  async function skip(tradeId, reason) {
    _removeBanner(tradeId);
    _releaseLock(tradeId);
    var token = _getToken();
    if (!token) return;
    try {
      await fetch('/api/copy-bot/trades/' + tradeId + '/skipped', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ reason: reason || 'user_skipped' })
      });
    } catch (e) {}
  }

  // ── Public API ──
  window.HFXCopyBot = { start: start, stop: stop, execute: execute, skip: skip };

  // Auto-start on page load if auth present
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(start, 1000); });
  } else {
    setTimeout(start, 1000);
  }
})();
