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
  var _executingTrades = new Set(); // prevent double-execute

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
  function _handleOpportunity(data) {
    if (!data.trade_id) return;
    if (_activeBanners[data.trade_id]) return; // already showing
    _showBanner(data);
    // Auto-execute if possible (non-blocking)
    if (_hasWallet()) {
      _executeTrade(data).catch(function(err) {
        _warn('auto-exec failed:', err.message);
        // Banner stays visible for manual click
      });
    }
  }

  // ── Banner UI ──
  function _showBanner(data) {
    var b = document.createElement('div');
    b.id = 'cbBanner_' + data.trade_id;
    b.style.cssText = 'position:fixed;bottom:20px;right:20px;width:340px;background:linear-gradient(135deg,#0c0c0b,#141412);color:#fff;padding:16px;border-radius:12px;border:1px solid #a855f7;box-shadow:0 8px 32px rgba(168,85,247,0.3);font-family:Inter,sans-serif;font-size:13px;z-index:10001;animation:cbSlideIn 0.3s ease-out';
    var sideColor = data.side && data.side.toUpperCase() === 'YES' ? '#00e68a' : '#ff4d6a';
    var priceCents = Math.round((data.price || 0.5) * 100);
    b.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
        '<span style="font-size:18px">🤖</span>' +
        '<span style="font-family:monospace;font-size:11px;color:#a855f7;font-weight:700;letter-spacing:1px">COPY OPPORTUNITY</span>' +
        '<button onclick="HFXCopyBot.skip(\'' + data.trade_id + '\',\'dismissed\')" style="margin-left:auto;background:none;border:none;color:#888;font-size:18px;cursor:pointer;padding:0 4px">✕</button>' +
      '</div>' +
      '<div style="font-weight:700;margin-bottom:4px">' + _esc(data.whale_name || 'A whale') + ' opened position</div>' +
      '<div style="font-size:12px;color:#aaa;line-height:1.4;margin-bottom:8px">' + _esc((data.market || '').substring(0, 80)) + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
        '<span style="font-family:monospace;font-size:12px;font-weight:700;color:' + sideColor + '">' + (data.side || '').toUpperCase() + ' ' + priceCents + '¢</span>' +
        '<span style="font-family:monospace;font-size:11px;color:#888">·</span>' +
        '<span style="font-family:monospace;font-size:11px;color:#888">Whale: $' + (data.whale_size >= 1000 ? Math.round(data.whale_size/1000) + 'K' : Math.round(data.whale_size)) + '</span>' +
      '</div>' +
      '<div style="display:flex;gap:6px">' +
        '<button id="cbExec_' + data.trade_id + '" onclick="HFXCopyBot.execute(\'' + data.trade_id + '\')" style="flex:1;background:#a855f7;color:#fff;border:none;padding:8px 12px;border-radius:6px;font-family:monospace;font-size:11px;font-weight:700;cursor:pointer">Execute $' + Math.round(data.alloc_usd) + ' →</button>' +
        '<button onclick="HFXCopyBot.skip(\'' + data.trade_id + '\',\'user_skipped\')" style="background:rgba(255,255,255,0.08);color:#888;border:none;padding:8px 12px;border-radius:6px;font-family:monospace;font-size:11px;cursor:pointer">Skip</button>' +
      '</div>' +
      '<div id="cbStatus_' + data.trade_id + '" style="margin-top:8px;font-family:monospace;font-size:10px;color:#888;min-height:12px"></div>';

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
      // Buy $allocUsd worth of shares at market price
      var amount = parseFloat(data.alloc_usd);  // USDC to spend
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
        // Remove banner after 4 seconds
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
    }
  }

  async function skip(tradeId, reason) {
    _removeBanner(tradeId);
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
