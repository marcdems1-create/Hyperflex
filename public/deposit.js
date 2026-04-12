/**
 * HFXDeposit — USDC deposit flow (EOA → Polymarket proxy)
 *
 * Standalone module loaded on every HYPERFLEX page via nav.js. Exposes
 * window.HFXDeposit.open() as the single entry point.
 *
 * Why a shared module:
 * - The deposit flow needs to be accessible from /market/:slug, /creator/
 *   dashboard, /whales, and anywhere else a user might realize they have
 *   no USDC on their proxy. Duplicating ~300 lines of modal code + signing
 *   logic in each page is a maintenance nightmare.
 *
 * Dependencies (all loaded by nav.js):
 * - window.ethers (ethers v6)
 * - window.HFXWallet (shared wallet helper — getSigner, invalidate)
 *
 * State machine:
 *   loading → ready (has USDC) → signing → confirming → success
 *           → ready (no USDC — shows onramps)
 *           → error (any failure state)
 *
 * The module is idempotent — calling open() while a modal is already
 * visible is a no-op. All DOM nodes are created/torn down per call.
 */
(function() {
  'use strict';

  try { console.log('[HFXDeposit] loaded at', new Date().toISOString()); } catch (e) {}

  var USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // Polygon USDC.e (Polymarket uses this)
  var USDC_NATIVE_POLYGON = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'; // Polygon native USDC (Circle)
  var SAFE_FACTORY = '0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b';
  var POLYGON_RPCS = [
    'https://polygon-bor-rpc.publicnode.com',
    'https://1rpc.io/matic',
    'https://polygon-rpc.com'
  ];

  function _esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  async function _getPublicProvider() {
    if (!window.ethers) throw new Error('ethers.js not loaded');
    for (var i = 0; i < POLYGON_RPCS.length; i++) {
      try {
        var p = new window.ethers.JsonRpcProvider(POLYGON_RPCS[i]);
        await p.getBlockNumber();
        return p;
      } catch (e) { /* try next */ }
    }
    throw new Error('All public RPCs failed');
  }

  async function _computeProxy(eoa) {
    var provider = await _getPublicProvider();
    var factory = new window.ethers.Contract(SAFE_FACTORY, [
      'function computeProxyAddress(address user) view returns (address)'
    ], provider);
    var proxy = await factory.computeProxyAddress(eoa);
    return proxy;
  }

  // Check both Polygon USDC.e AND native USDC — many users have one or the other.
  // Returns { total, usdce, native } so callers know which token(s) the user holds.
  async function _usdcBalanceDetailed(address) {
    if (!address) return { total: 0, usdce: 0, native: 0 };
    try {
      var provider = await _getPublicProvider();
      var abi = ['function balanceOf(address) view returns (uint256)'];
      var results = await Promise.all([
        new window.ethers.Contract(USDC_ADDRESS, abi, provider).balanceOf(address).then(function(r) { return parseFloat(window.ethers.formatUnits(r, 6)); }).catch(function() { return 0; }),
        new window.ethers.Contract(USDC_NATIVE_POLYGON, abi, provider).balanceOf(address).then(function(r) { return parseFloat(window.ethers.formatUnits(r, 6)); }).catch(function() { return 0; })
      ]);
      return { total: results[0] + results[1], usdce: results[0], native: results[1] };
    } catch (e) { return { total: 0, usdce: 0, native: 0 }; }
  }

  // Simple total balance (backwards compat for proxy balance which is always USDC.e)
  async function _usdcBalance(address) {
    var d = await _usdcBalanceDetailed(address);
    return d.total;
  }

  async function _polBalance(address) {
    if (!address) return null;
    try {
      var provider = await _getPublicProvider();
      var raw = await provider.getBalance(address);
      return parseFloat(window.ethers.formatEther(raw));
    } catch (e) { return null; }
  }

  function _ensureOverlay() {
    var existing = document.getElementById('hfxDepositOverlay');
    if (existing) return existing;
    var o = document.createElement('div');
    o.id = 'hfxDepositOverlay';
    o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(4px);z-index:10020;display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,system-ui,-apple-system,sans-serif';
    o.onclick = function(e) { if (e.target === o) close(); };
    document.body.appendChild(o);

    // Inject keyframes once
    if (!document.getElementById('hfxDepositStyle')) {
      var style = document.createElement('style');
      style.id = 'hfxDepositStyle';
      style.textContent = '@keyframes hfxDepositSpin{to{transform:rotate(360deg)}}';
      document.head.appendChild(style);
    }
    return o;
  }

  function close() {
    var o = document.getElementById('hfxDepositOverlay');
    if (o) o.remove();
  }

  // Renders the modal body for the given state
  function _frame(state) {
    var bg = '#0e0e0c';
    var border = 'rgba(0,230,138,0.4)';
    if (state.error) border = '#ff4d6a';

    // LOADING
    if (state.loading) {
      return '<div style="background:' + bg + ';border:1px solid ' + border + ';border-radius:14px;padding:28px;max-width:440px;width:100%;color:#f0f0f5;text-align:center">' +
        '<div style="display:inline-block;width:32px;height:32px;border:3px solid #1e1e2a;border-top-color:#00e68a;border-radius:50%;animation:hfxDepositSpin 0.8s linear infinite"></div>' +
        '<div style="margin-top:12px;font-family:\'JetBrains Mono\',monospace;font-size:12px;color:#8888a0">Loading your wallet balances…</div>' +
      '</div>';
    }

    // ERROR
    if (state.error) {
      return '<div style="background:' + bg + ';border:1px solid #ff4d6a;border-radius:14px;padding:28px;max-width:440px;width:100%;color:#f0f0f5">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">' +
          '<span style="font-size:18px">⚠</span>' +
          '<div style="font-size:15px;font-weight:800;flex:1">Deposit unavailable</div>' +
          '<button onclick="HFXDeposit.close()" style="background:none;border:none;color:#888;font-size:22px;cursor:pointer;padding:0 6px">✕</button>' +
        '</div>' +
        '<div style="font-family:\'JetBrains Mono\',monospace;font-size:12px;color:#aaa;line-height:1.6;margin-bottom:16px">' + _esc(state.error) + '</div>' +
        '<button onclick="HFXDeposit.close()" style="width:100%;background:rgba(255,255,255,0.06);color:#f0f0f5;border:1px solid #1e1e2a;padding:12px;border-radius:8px;font-family:\'JetBrains Mono\',monospace;font-size:12px;font-weight:700;cursor:pointer">Close</button>' +
      '</div>';
    }

    // SIGNING
    if (state.signing) {
      return '<div style="background:' + bg + ';border:1px solid ' + border + ';border-radius:14px;padding:28px;max-width:440px;width:100%;color:#f0f0f5;text-align:center">' +
        '<div style="display:inline-block;width:32px;height:32px;border:3px solid #1e1e2a;border-top-color:#00e68a;border-radius:50%;animation:hfxDepositSpin 0.8s linear infinite"></div>' +
        '<div style="margin-top:14px;font-size:14px;font-weight:700;color:#00e68a">Check MetaMask → sign the transfer</div>' +
        '<div style="margin-top:6px;font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0">Sending $' + (state.amount || 0).toFixed(2) + ' USDC to your Polymarket wallet</div>' +
      '</div>';
    }

    // CONFIRMING
    if (state.confirming) {
      return '<div style="background:' + bg + ';border:1px solid ' + border + ';border-radius:14px;padding:28px;max-width:440px;width:100%;color:#f0f0f5;text-align:center">' +
        '<div style="display:inline-block;width:32px;height:32px;border:3px solid #1e1e2a;border-top-color:#00e68a;border-radius:50%;animation:hfxDepositSpin 0.8s linear infinite"></div>' +
        '<div style="margin-top:14px;font-size:14px;font-weight:700;color:#00e68a">Waiting for confirmation…</div>' +
        '<div style="margin-top:6px;font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0">Usually 2–5 seconds on Polygon</div>' +
        (state.txHash ? '<div style="margin-top:12px"><a href="https://polygonscan.com/tx/' + _esc(state.txHash) + '" target="_blank" rel="noopener" style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#4d9fff;text-decoration:none">View on Polygonscan ↗</a></div>' : '') +
      '</div>';
    }

    // SUCCESS
    if (state.success) {
      var badge = '';
      if (state.gasless) badge = '<div style="display:inline-block;padding:3px 8px;background:rgba(168,85,247,0.12);color:#a855f7;border-radius:4px;font-family:\'JetBrains Mono\',monospace;font-size:10px;font-weight:700;margin-bottom:10px;letter-spacing:1px">✨ GASLESS · HYPERFLEX PAID THE GAS</div>';
      else if (state.bridged) badge = '<div style="display:inline-block;padding:3px 8px;background:rgba(77,159,255,0.12);color:#4d9fff;border-radius:4px;font-family:\'JetBrains Mono\',monospace;font-size:10px;font-weight:700;margin-bottom:10px;letter-spacing:1px">🌉 BRIDGED CROSS-CHAIN</div>';
      return '<div style="background:' + bg + ';border:1px solid #00e68a;border-radius:14px;padding:28px;max-width:440px;width:100%;color:#f0f0f5;text-align:center">' +
        '<div style="font-size:48px;margin-bottom:8px">✅</div>' +
        '<div style="font-size:18px;font-weight:800;color:#00e68a;margin-bottom:4px">Deposited $' + (state.amount || 0).toFixed(2) + ' USDC</div>' +
        badge +
        '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0;margin-bottom:18px">New Polymarket balance: <strong style="color:#f0f0f5">$' + (state.newProxyBalance || 0).toFixed(2) + '</strong></div>' +
        (state.txHash ? '<div style="margin-bottom:18px"><a href="https://polygonscan.com/tx/' + _esc(state.txHash) + '" target="_blank" rel="noopener" style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#4d9fff;text-decoration:none">View tx on Polygonscan ↗</a></div>' : '') +
        '<button onclick="HFXDeposit.close()" style="background:#00e68a;color:#0a0a0f;border:none;padding:12px 32px;border-radius:8px;font-family:\'JetBrains Mono\',monospace;font-size:12px;font-weight:800;cursor:pointer;min-height:44px">Close</button>' +
      '</div>';
    }

    // READY — tabbed interface
    var eoaBal = state.eoaBalance != null ? state.eoaBalance : 0;
    var proxyBal = state.proxyBalance != null ? state.proxyBalance : 0;
    var hasEoaUsdc = eoaBal >= 0.01;
    var hasGas = state.polBalance == null || state.polBalance >= 0.001;

    // Default tab: if user has USDC in MetaMask, start on transfer.
    // Otherwise start on Exchange (most common path for new users).
    var currentTab = state.currentTab || (hasEoaUsdc ? 'metamask' : 'exchange');

    function tabBtn(tab, label, icon) {
      var active = currentTab === tab;
      return '<button onclick="HFXDeposit._setTab(\'' + tab + '\')" style="flex:1;min-width:auto;padding:10px 8px;border:1px solid ' + (active ? '#00e68a' : '#1e1e2a') + ';background:' + (active ? 'rgba(0,230,138,0.08)' : 'transparent') + ';color:' + (active ? '#00e68a' : '#8888a0') + ';font-family:\'JetBrains Mono\',monospace;font-size:10px;font-weight:700;border-radius:8px;cursor:pointer;transition:all 0.15s;min-height:40px;white-space:nowrap">' + icon + ' ' + label + '</button>';
    }

    var tabsHtml =
      '<div style="display:flex;gap:6px;margin-bottom:16px;overflow-x:auto;padding-bottom:2px">' +
        tabBtn('metamask', 'MetaMask', '🦊') +
        tabBtn('exchange', 'Exchange', '🏦') +
        tabBtn('card', 'Card/Bank', '💳') +
        tabBtn('bridge', 'Bridge', '🌉') +
      '</div>';

    var bodyHtml;
    if (currentTab === 'metamask') {
      if (hasEoaUsdc) {
        // Auto-pick gasless if user has no POL — but only if they have USDC.e.
        // Gasless (EIP-3009) only works with USDC.e, not native USDC.
        var hasUsdceForGasless = (state.eoaUsdce || 0) >= 0.01;
        var useGasless = !hasGas && hasUsdceForGasless;
        var submitFn = useGasless ? 'HFXDeposit._submitGasless()' : 'HFXDeposit._submit()';
        var submitLabel = useGasless ? '✨ Sign gasless (free) →' : 'Sign & Deposit →';
        var footerNote = useGasless
          ? 'Gasless deposit via EIP-3009 · You sign a message, we pay the POL gas · No POL needed in your wallet'
          : 'Standard USDC ERC-20 transfer on Polygon · Gas: ~$0.01 in POL';

        bodyHtml =
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Amount to deposit</div>' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">' +
            '<div style="flex:1;position:relative">' +
              '<span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-family:\'JetBrains Mono\',monospace;font-size:15px;color:#8888a0">$</span>' +
              '<input type="number" id="hfxDepositAmount" placeholder="0.00" step="0.01" min="0.01" max="' + eoaBal + '" style="width:100%;background:#1a1917;border:1px solid #1e1e2a;border-radius:6px;padding:12px 12px 12px 26px;font-family:\'JetBrains Mono\',monospace;font-size:16px;font-weight:700;color:#f0f0f5;outline:none;box-sizing:border-box"/>' +
            '</div>' +
            '<button onclick="document.getElementById(\'hfxDepositAmount\').value=' + eoaBal.toFixed(2) + '" style="background:rgba(0,230,138,0.1);border:1px solid rgba(0,230,138,0.3);color:#00e68a;padding:10px 14px;border-radius:6px;font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:700;cursor:pointer;min-height:44px">MAX</button>' +
          '</div>' +

          (useGasless ? '<div style="padding:12px 14px;background:rgba(0,230,138,0.06);border:1px solid rgba(0,230,138,0.25);border-radius:8px;margin-bottom:14px;font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#00e68a;line-height:1.6">' +
            '<strong>✨ Gasless mode enabled</strong><br>' +
            '<span style="color:#8888a0">You have no POL for gas, so we\'ll cover the transaction fee. You just sign a message in MetaMask — no gas required. USDC lands in your Polymarket wallet in ~5 seconds.</span>' +
          '</div>' : '') +

          '<button onclick="' + submitFn + '" id="hfxDepositSubmitBtn" style="width:100%;background:#00e68a;color:#0a0a0f;border:none;padding:14px;border-radius:8px;font-family:\'JetBrains Mono\',monospace;font-size:13px;font-weight:800;cursor:pointer;min-height:48px">' + submitLabel + '</button>' +

          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;line-height:1.6;margin-top:14px;text-align:center">' + footerNote + '</div>' +

          // Show the other option as a link
          (useGasless
            ? '' // already gasless, nothing to offer
            : '<div style="text-align:center;margin-top:10px"><a href="#" onclick="event.preventDefault();HFXDeposit._submitGasless()" style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#4d9fff;text-decoration:none">Or sign gasless instead (free, we pay the gas) →</a></div>'
          );
      } else {
        // MetaMask tab but no USDC in EOA
        bodyHtml =
          '<div style="padding:18px 20px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.25);border-radius:10px;text-align:center">' +
            '<div style="font-size:28px;margin-bottom:8px">🦊</div>' +
            '<div style="font-size:14px;font-weight:700;color:#f59e0b;margin-bottom:4px">No USDC in your MetaMask</div>' +
            '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0;line-height:1.7">Your MetaMask wallet has no USDC on Polygon. Switch to one of the other tabs above to fund your Polymarket wallet another way.</div>' +
          '</div>';
      }
    } else if (currentTab === 'exchange') {
      var addr = state.proxy || '';
      var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=8&data=' + encodeURIComponent(addr);
      bodyHtml =
        '<div style="padding:12px 14px;background:rgba(255,77,106,0.08);border:1px solid rgba(255,77,106,0.3);border-radius:8px;margin-bottom:14px">' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:800;color:#ff4d6a;margin-bottom:6px">⚠ READ THIS BEFORE SENDING</div>' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#f0f0f5;line-height:1.6">' +
            '<strong>Network MUST be Polygon</strong> (not Ethereum, not Optimism, not Base). ' +
            'Sending on the wrong network will lose your funds permanently. If your exchange calls it "MATIC", that\'s the same as Polygon.' +
          '</div>' +
        '</div>' +

        // Address + QR
        '<div style="display:flex;gap:14px;align-items:center;padding:14px;background:rgba(255,255,255,0.02);border:1px solid #1e1e2a;border-radius:10px;margin-bottom:14px;flex-wrap:wrap">' +
          '<div style="width:150px;height:150px;background:#fff;border-radius:8px;flex-shrink:0;padding:8px;box-sizing:border-box">' +
            '<img src="' + qrUrl + '" alt="Deposit address QR" style="width:100%;height:100%;display:block" onerror="this.style.display=\'none\'"/>' +
          '</div>' +
          '<div style="flex:1;min-width:200px">' +
            '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Your Polymarket address</div>' +
            '<div id="hfxDepositAddrEl" style="font-family:\'JetBrains Mono\',monospace;font-size:12px;font-weight:700;color:#f0f0f5;word-break:break-all;line-height:1.5;margin-bottom:10px;user-select:all">' + _esc(addr) + '</div>' +
            '<button onclick="HFXDeposit._copyAddr()" id="hfxDepositCopyBtn" style="width:100%;background:rgba(0,230,138,0.1);border:1px solid rgba(0,230,138,0.3);color:#00e68a;padding:10px 14px;border-radius:6px;font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:700;cursor:pointer;min-height:40px">📋 Copy address</button>' +
          '</div>' +
        '</div>' +

        // Exchange-specific instructions (collapsible-ish)
        '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">How to send from your exchange</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">' +
          _exchangeRow('Coinbase', 'Pay → Send → USDC → enter this address → Network: <strong style="color:#f0f0f5">Polygon</strong>', 'https://www.coinbase.com/') +
          _exchangeRow('Binance', 'Wallet → Withdraw → USDC → paste this address → Network: <strong style="color:#f0f0f5">Polygon (MATIC)</strong>', 'https://www.binance.com/en/my/wallet/account/main/withdrawal/crypto/USDC') +
          _exchangeRow('Kraken', 'Funding → Withdraw → USDC → New address → Network: <strong style="color:#f0f0f5">Polygon</strong>', 'https://www.kraken.com/u/funding/withdraw?asset=USDC') +
          _exchangeRow('OKX', 'Assets → Withdraw → USDC → On-chain → Network: <strong style="color:#f0f0f5">Polygon</strong>', 'https://www.okx.com/balance/withdrawal/usdc') +
          _exchangeRow('Robinhood', 'Crypto → USDC → Send → Polygon network', 'https://robinhood.com/') +
        '</div>' +

        '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;line-height:1.6;padding:10px 12px;background:rgba(77,159,255,0.04);border:1px solid rgba(77,159,255,0.15);border-radius:6px">' +
          '<strong style="color:#4d9fff">Timing:</strong> Most exchanges confirm within 2-5 minutes on Polygon. You\'ll see your balance update on HYPERFLEX automatically.' +
        '</div>';
    } else if (currentTab === 'card') {
      bodyHtml =
        '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0;line-height:1.7;margin-bottom:14px">Buy USDC directly with a card, bank transfer, or existing crypto. These providers send USDC straight to your MetaMask, then use the MetaMask tab above to forward it to Polymarket.</div>' +

        '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">' +
          '<a href="https://buy.ramp.network/?userAddress=' + _esc(state.eoa || '') + '&swapAsset=MATIC_USDC&defaultAsset=MATIC_USDC" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:12px;padding:14px;background:rgba(0,230,138,0.04);border:1px solid rgba(0,230,138,0.25);border-radius:10px;text-decoration:none;color:#f0f0f5;transition:background 0.15s">' +
            '<span style="font-size:24px">💳</span>' +
            '<div style="flex:1"><div style="font-size:14px;font-weight:800">Ramp Network</div><div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;margin-top:2px">Card · Apple Pay · Bank transfer · 🇺🇸 🇪🇺 🇬🇧</div></div>' +
            '<span style="color:#00e68a;font-size:18px">→</span>' +
          '</a>' +

          '<a href="https://pay.coinbase.com/buy/select-asset?appId=hyperflex&destinationWallets=' + encodeURIComponent(JSON.stringify([{ address: state.eoa || '', blockchains: ['polygon'], assets: ['USDC'] }])) + '" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:12px;padding:14px;background:rgba(77,159,255,0.04);border:1px solid rgba(77,159,255,0.25);border-radius:10px;text-decoration:none;color:#f0f0f5">' +
            '<span style="font-size:24px">🟦</span>' +
            '<div style="flex:1"><div style="font-size:14px;font-weight:800">Coinbase Pay</div><div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;margin-top:2px">Use your Coinbase account · instant · fee-free</div></div>' +
            '<span style="color:#4d9fff;font-size:18px">→</span>' +
          '</a>' +

          '<a href="https://global.transak.com/?apiKey=e8e5c1a9-3d2a-4f15-9a25-5f4c9e2dc97f&cryptoCurrencyCode=USDC&network=polygon&walletAddress=' + encodeURIComponent(state.eoa || '') + '" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:12px;padding:14px;background:rgba(168,85,247,0.04);border:1px solid rgba(168,85,247,0.25);border-radius:10px;text-decoration:none;color:#f0f0f5">' +
            '<span style="font-size:24px">🌐</span>' +
            '<div style="flex:1"><div style="font-size:14px;font-weight:800">Transak</div><div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;margin-top:2px">130+ countries · SEPA · UPI · Local methods</div></div>' +
            '<span style="color:#a855f7;font-size:18px">→</span>' +
          '</a>' +
        '</div>' +

        '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;line-height:1.6;padding:10px 12px;background:rgba(245,158,11,0.04);border:1px solid rgba(245,158,11,0.15);border-radius:6px">' +
          '<strong style="color:#f59e0b">Note:</strong> On-ramps require KYC (ID verification). Typical time: 5-15 min for first purchase, then instant. Fees: 1.5-3.5% depending on payment method.' +
        '</div>';
    } else if (currentTab === 'bridge') {
      // Native in-app bridge flow via LI.FI API.
      // Users never leave HYPERFLEX — they pick a source chain, we fetch a
      // quote, show the route, they sign ONE transaction on the source chain,
      // and USDC lands directly in their Polymarket proxy in 1-5 minutes.
      var proxyAddr = state.proxy || '';
      var bridgeStep = state.bridgeStep || 'select'; // select | quote | executing | polling | done | error

      if (bridgeStep === 'executing' || bridgeStep === 'polling') {
        // Progress view
        var pollMsg = state.bridgePollMessage || 'Bridging…';
        bodyHtml =
          '<div style="padding:30px 20px;text-align:center">' +
            '<div style="display:inline-block;width:48px;height:48px;border:4px solid #1e1e2a;border-top-color:#4d9fff;border-radius:50%;animation:hfxDepositSpin 0.8s linear infinite;margin-bottom:14px"></div>' +
            '<div style="font-size:16px;font-weight:800;color:#4d9fff;margin-bottom:6px">' + _esc(pollMsg) + '</div>' +
            (state.bridgeSubMessage ? '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0;line-height:1.6;margin-bottom:14px">' + _esc(state.bridgeSubMessage) + '</div>' : '') +
            (state.bridgeTxHash ? '<div style="margin-top:14px"><a href="' + (state.bridgeFromChain === 42161 ? 'https://arbiscan.io/tx/' : state.bridgeFromChain === 1 ? 'https://etherscan.io/tx/' : state.bridgeFromChain === 8453 ? 'https://basescan.org/tx/' : state.bridgeFromChain === 10 ? 'https://optimistic.etherscan.io/tx/' : state.bridgeFromChain === 56 ? 'https://bscscan.com/tx/' : 'https://polygonscan.com/tx/') + _esc(state.bridgeTxHash) + '" target="_blank" rel="noopener" style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#4d9fff;text-decoration:none">View source tx ↗</a></div>' : '') +
          '</div>' +
          '<div style="padding:10px 12px;background:rgba(77,159,255,0.04);border:1px solid rgba(77,159,255,0.15);border-radius:6px;font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;line-height:1.6;text-align:center">' +
            'Cross-chain bridges typically take 1-5 minutes. Feel free to close this modal — we\'ll keep monitoring and show you the result.' +
          '</div>';
      } else if (bridgeStep === 'quote') {
        // Quote preview step — fetched by _fetchBridgeQuote
        var quote = state.bridgeQuote;
        if (!quote) {
          bodyHtml = '<div style="padding:30px;text-align:center"><div style="display:inline-block;width:32px;height:32px;border:3px solid #1e1e2a;border-top-color:#4d9fff;border-radius:50%;animation:hfxDepositSpin 0.8s linear infinite"></div><div style="margin-top:12px;font-family:\'JetBrains Mono\',monospace;font-size:12px;color:#8888a0">Fetching best route…</div></div>';
        } else if (quote.error) {
          bodyHtml =
            '<div style="padding:16px 18px;background:rgba(255,77,106,0.08);border:1px solid rgba(255,77,106,0.3);border-radius:10px;margin-bottom:14px">' +
              '<div style="font-size:14px;font-weight:700;color:#ff4d6a;margin-bottom:6px">Could not find a route</div>' +
              '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0;line-height:1.6">' + _esc(quote.error) + '</div>' +
            '</div>' +
            '<button onclick="HFXDeposit._setBridgeStep(\'select\')" style="width:100%;background:rgba(255,255,255,0.06);color:#f0f0f5;border:1px solid #1e1e2a;padding:12px;border-radius:8px;font-family:\'JetBrains Mono\',monospace;font-size:12px;font-weight:700;cursor:pointer">← Try different amount or chain</button>';
        } else if (state.bridgeProvider === 'relay') {
          // ── RELAY QUOTE DISPLAY ──
          var relayHasTxStep = (quote.steps || []).some(function(s) { return s.kind === 'transaction'; });
          var relayFees = quote.fees || {};
          var relayDetails = quote.details || {};
          var srcChainName = _bridgeChainName(state.bridgeFromChain);
          var relayFromAmt = (_state.bridgeAmount || 0).toFixed(2);
          // Calculate receive amount from details or fees
          var relayGasFee = relayFees.gas ? parseFloat(relayFees.gas.amountUsd || relayFees.gas.amount || 0) : 0;
          var relayRelayerFee = relayFees.relayer ? parseFloat(relayFees.relayer.amountUsd || relayFees.relayer.amount || 0) : 0;
          var relayAppFee = relayFees.app ? parseFloat(relayFees.app.amountUsd || relayFees.app.amount || 0) : 0;
          var relayTotalFees = relayGasFee + relayRelayerFee + relayAppFee;
          var relayToAmt = (parseFloat(relayFromAmt) - relayTotalFees).toFixed(2);
          // If details has currencyOut amount, use that instead
          if (relayDetails.currencyOut && relayDetails.currencyOut.amountUsd) {
            relayToAmt = parseFloat(relayDetails.currencyOut.amountUsd).toFixed(2);
          } else if (relayDetails.currencyOut && relayDetails.currencyOut.amount) {
            relayToAmt = (parseFloat(relayDetails.currencyOut.amount) / 1e6).toFixed(2);
          }
          var relayDuration = relayDetails.timeEstimate || 30;
          var relayDurStr = relayDuration < 120 ? relayDuration + 's' : Math.round(relayDuration / 60) + 'm';

          bodyHtml =
            '<div style="padding:14px 16px;background:rgba(0,230,138,0.04);border:1px solid rgba(0,230,138,0.25);border-radius:10px;margin-bottom:14px">' +
              '<div style="font-size:13px;font-weight:700;color:#00e68a;margin-bottom:4px">✓ Route found via Relay</div>' +
              '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0">Via <strong style="color:#f0f0f5">RELAY</strong> · estimated ' + relayDurStr + (relayHasTxStep ? ' · <span style="color:#f59e0b;font-weight:700">one-time approval needed</span>' : ' · <span style="color:#00e68a;font-weight:700">no gas needed</span>') + '</div>' +
            '</div>' +

            '<div style="display:flex;flex-direction:column;gap:8px;padding:14px;background:rgba(255,255,255,0.02);border:1px solid #1e1e2a;border-radius:10px;margin-bottom:14px;font-family:\'JetBrains Mono\',monospace;font-size:12px">' +
              '<div style="display:flex;justify-content:space-between"><span style="color:#8888a0">You send</span><span style="color:#f0f0f5;font-weight:700">$' + relayFromAmt + ' USDC on ' + _esc(srcChainName) + '</span></div>' +
              '<div style="display:flex;justify-content:space-between"><span style="color:#8888a0">You receive</span><span style="color:#00e68a;font-weight:700">~$' + relayToAmt + ' USDC on Polygon</span></div>' +
              '<div style="height:1px;background:#1e1e2a;margin:4px 0"></div>' +
              (relayTotalFees > 0 ? '<div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:#8888a0">Fees (incl. gas)</span><span style="color:#aaa">~$' + relayTotalFees.toFixed(2) + '</span></div>' : '') +
              '<div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:#8888a0">Gas</span><span style="color:#00e68a;font-weight:700">Paid from USDC ✓</span></div>' +
              '<div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:#8888a0">Destination</span><span style="color:#aaa">' + _esc(proxyAddr.slice(0,6)) + '…' + _esc(proxyAddr.slice(-4)) + '</span></div>' +
            '</div>' +

            '<div style="display:flex;gap:8px">' +
              '<button onclick="HFXDeposit._setBridgeStep(\'select\')" style="background:rgba(255,255,255,0.06);color:#8888a0;border:1px solid #1e1e2a;padding:12px 16px;border-radius:8px;font-family:\'JetBrains Mono\',monospace;font-size:12px;font-weight:700;cursor:pointer;min-height:44px">← Back</button>' +
              '<button onclick="HFXDeposit._executeBridge()" id="hfxBridgeExecBtn" style="flex:1;background:#00e68a;color:#0a0a0f;border:none;padding:12px;border-radius:8px;font-family:\'JetBrains Mono\',monospace;font-size:13px;font-weight:800;cursor:pointer;min-height:44px">Sign & bridge $' + relayFromAmt + ' →</button>' +
            '</div>' +

            (relayHasTxStep
              ? '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#f59e0b;line-height:1.6;margin-top:12px;text-align:center;padding:6px 10px;background:rgba(245,158,11,0.04);border:1px solid rgba(245,158,11,0.15);border-radius:6px">⚠ First bridge needs a one-time USDC approval (~$0.10 ' + _esc((BRIDGE_CHAINS[state.bridgeFromChain]||{}).gas||'ETH') + ' gas). After this, future bridges are fully gasless.</div>'
              : '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#00e68a;line-height:1.6;margin-top:12px;text-align:center;padding:6px 10px;background:rgba(0,230,138,0.04);border:1px solid rgba(0,230,138,0.15);border-radius:6px">⚡ Gasless bridge — you only sign a message, no ETH needed. Gas is deducted from your USDC.</div>');

        } else {
          // ── LI.FI QUOTE DISPLAY (fallback — requires gas) ──
          var est = quote.estimate || {};
          var fromAmt = parseFloat(est.fromAmountUSD || 0).toFixed(2);
          var toAmt = parseFloat(est.toAmountUSD || est.toAmount || 0).toFixed(2);
          var toUsdc = est.toAmount ? (parseFloat(est.toAmount) / 1e6).toFixed(2) : toAmt;
          var actualToAddr = (quote.action && quote.action.toToken && quote.action.toToken.address) || '';
          var isCompatible = actualToAddr.toLowerCase() === USDC_ADDRESS.toLowerCase();
          var routeWarning = '';
          if (actualToAddr && !isCompatible) {
            routeWarning = '<div style="padding:10px 12px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.25);border-radius:6px;margin-bottom:10px;font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#f59e0b;line-height:1.6">⚠ This route delivers <strong>native Polygon USDC</strong>, but Polymarket needs <strong>bridged USDC.e</strong>. You\'ll need to swap on Polygon after.</div>';
          }
          var duration = est.executionDuration || 300;
          var durationStr = duration < 120 ? duration + 's' : Math.round(duration / 60) + 'm';
          var gasCostUsd = est.gasCosts && est.gasCosts.length ? est.gasCosts.reduce(function(s, g) { return s + parseFloat(g.amountUSD || 0); }, 0).toFixed(2) : '—';
          var bridgeFeeUsd = est.feeCosts && est.feeCosts.length ? est.feeCosts.reduce(function(s, f) { return s + parseFloat(f.amountUSD || 0); }, 0).toFixed(2) : '0.00';
          var toolName = (quote.tool || 'auto').toUpperCase();
          var srcChainName = _bridgeChainName(state.bridgeFromChain);

          bodyHtml =
            '<div style="padding:14px 16px;background:rgba(245,158,11,0.04);border:1px solid rgba(245,158,11,0.25);border-radius:10px;margin-bottom:14px">' +
              '<div style="font-size:13px;font-weight:700;color:#f59e0b;margin-bottom:4px">Route found (requires gas)</div>' +
              '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0">Via <strong style="color:#f0f0f5">' + _esc(toolName) + '</strong> · estimated ' + durationStr + ' · <span style="color:#f59e0b">needs ' + _esc((BRIDGE_CHAINS[state.bridgeFromChain]||{}).gas||'ETH') + ' for gas</span></div>' +
            '</div>' +

            routeWarning +

            '<div style="display:flex;flex-direction:column;gap:8px;padding:14px;background:rgba(255,255,255,0.02);border:1px solid #1e1e2a;border-radius:10px;margin-bottom:14px;font-family:\'JetBrains Mono\',monospace;font-size:12px">' +
              '<div style="display:flex;justify-content:space-between"><span style="color:#8888a0">You send</span><span style="color:#f0f0f5;font-weight:700">$' + fromAmt + ' USDC on ' + _esc(srcChainName) + '</span></div>' +
              '<div style="display:flex;justify-content:space-between"><span style="color:#8888a0">You receive</span><span style="color:#00e68a;font-weight:700">$' + toUsdc + ' USDC on Polygon</span></div>' +
              '<div style="height:1px;background:#1e1e2a;margin:4px 0"></div>' +
              '<div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:#8888a0">Bridge fee</span><span style="color:#aaa">$' + bridgeFeeUsd + '</span></div>' +
              '<div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:#8888a0">Source chain gas</span><span style="color:#f59e0b">~$' + gasCostUsd + ' ' + _esc((BRIDGE_CHAINS[state.bridgeFromChain]||{}).gas||'ETH') + '</span></div>' +
              '<div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:#8888a0">Destination</span><span style="color:#aaa">' + _esc(proxyAddr.slice(0,6)) + '…' + _esc(proxyAddr.slice(-4)) + '</span></div>' +
            '</div>' +

            '<div style="display:flex;gap:8px">' +
              '<button onclick="HFXDeposit._setBridgeStep(\'select\')" style="background:rgba(255,255,255,0.06);color:#8888a0;border:1px solid #1e1e2a;padding:12px 16px;border-radius:8px;font-family:\'JetBrains Mono\',monospace;font-size:12px;font-weight:700;cursor:pointer;min-height:44px">← Back</button>' +
              '<button onclick="HFXDeposit._executeBridge()" id="hfxBridgeExecBtn" style="flex:1;background:#f59e0b;color:#0a0a0f;border:none;padding:12px;border-radius:8px;font-family:\'JetBrains Mono\',monospace;font-size:13px;font-weight:800;cursor:pointer;min-height:44px">Sign & bridge $' + fromAmt + ' →</button>' +
            '</div>' +

            '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#f59e0b;line-height:1.5;margin-top:12px;text-align:center;padding:6px 10px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.15);border-radius:6px">⚠ Gasless route unavailable. You need ' + _esc((BRIDGE_CHAINS[state.bridgeFromChain]||{}).gas||'ETH') + ' on ' + _esc(srcChainName) + ' for gas (~$' + gasCostUsd + ').</div>';
        }
      } else {
        // SELECT step (default) — chain picker + amount
        var sourceChains = [
          { id: 42161, name: 'Arbitrum', icon: '🔵', usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
          { id: 8453,  name: 'Base',     icon: '🔷', usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
          { id: 10,    name: 'Optimism', icon: '🔴', usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' },
          { id: 1,     name: 'Ethereum', icon: '🔶', usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
          { id: 56,    name: 'BSC',      icon: '🟡', usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' }
        ];
        var selectedChainId = state.bridgeFromChain || 42161; // default Arbitrum
        var chainBtnsHtml = sourceChains.map(function(c) {
          var active = c.id === selectedChainId;
          return '<button onclick="HFXDeposit._setBridgeChain(' + c.id + ')" style="padding:10px 8px;border:1px solid ' + (active ? '#4d9fff' : '#1e1e2a') + ';background:' + (active ? 'rgba(77,159,255,0.08)' : 'transparent') + ';color:' + (active ? '#4d9fff' : '#f0f0f5') + ';font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:700;border-radius:8px;cursor:pointer;min-height:44px;display:flex;align-items:center;justify-content:center;gap:6px;flex:1;min-width:80px">' + c.icon + ' ' + c.name + '</button>';
        }).join('');

        var chainBalance = state.bridgeSourceBalance;
        var balDisplay = chainBalance == null ? '…' : (chainBalance > 0 ? '$' + chainBalance.toFixed(2) : '$0.00');
        var balColor = chainBalance == null ? '#8888a0' : (chainBalance > 0 ? '#00e68a' : '#ff4d6a');
        // Show USDC.e breakdown if user has bridged tokens
        if (chainBalance != null && chainBalance > 0 && state.bridgeBridgedBalance > 0 && state.bridgeNativeBalance > 0) {
          balDisplay += ' (USDC + .e)';
        } else if (chainBalance != null && chainBalance > 0 && state.bridgeBridgedBalance > 0) {
          balDisplay += ' (USDC.e)';
        }

        bodyHtml =
          '<div style="padding:14px 16px;background:rgba(77,159,255,0.04);border:1px solid rgba(77,159,255,0.25);border-radius:10px;margin-bottom:14px">' +
            '<div style="font-size:13px;font-weight:700;color:#4d9fff;margin-bottom:4px">🌉 Bridge USDC to Polymarket</div>' +
            '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0;line-height:1.6">Your USDC bridges from any source chain directly to your Polymarket wallet. One signature, 1-5 min, no leaving HYPERFLEX.</div>' +
          '</div>' +

          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">1 · Source chain</div>' +
          '<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">' + chainBtnsHtml + '</div>' +

          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
            '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0;text-transform:uppercase;letter-spacing:1px">2 · Amount</div>' +
            '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:' + balColor + '">Balance: ' + balDisplay + '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">' +
            '<div style="flex:1;position:relative">' +
              '<span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-family:\'JetBrains Mono\',monospace;font-size:15px;color:#8888a0">$</span>' +
              '<input type="number" id="hfxBridgeAmount" placeholder="0.00" step="0.01" min="1" value="' + (state.bridgeAmount || '') + '" style="width:100%;background:#1a1917;border:1px solid #1e1e2a;border-radius:6px;padding:12px 12px 12px 26px;font-family:\'JetBrains Mono\',monospace;font-size:16px;font-weight:700;color:#f0f0f5;outline:none;box-sizing:border-box"/>' +
            '</div>' +
            (chainBalance != null && chainBalance > 0 ? '<button onclick="document.getElementById(\'hfxBridgeAmount\').value=' + chainBalance.toFixed(2) + '" style="background:rgba(77,159,255,0.1);border:1px solid rgba(77,159,255,0.3);color:#4d9fff;padding:10px 14px;border-radius:6px;font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:700;cursor:pointer;min-height:44px">MAX</button>' : '') +
          '</div>' +

          '<button onclick="HFXDeposit._fetchBridgeQuote()" style="width:100%;background:#4d9fff;color:#0a0a0f;border:none;padding:14px;border-radius:8px;font-family:\'JetBrains Mono\',monospace;font-size:13px;font-weight:800;cursor:pointer;min-height:48px">Get bridge quote →</button>' +

          '<div style="margin-top:16px;padding-top:14px;border-top:1px solid #1e1e2a">' +
            '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;line-height:1.6;text-align:center">Prefer an external UI? <a href="https://jumper.exchange/?toChain=137&toToken=' + USDC_ADDRESS + '&toAddress=' + encodeURIComponent(proxyAddr) + '" target="_blank" rel="noopener" style="color:#4d9fff">Open in Jumper ↗</a></div>' +
          '</div>';
      }
    }

    return '<div style="background:' + bg + ';border:1px solid ' + border + ';border-radius:14px;padding:22px;max-width:500px;width:100%;color:#f0f0f5;max-height:92vh;overflow-y:auto">' +
      // Header
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">' +
        '<span style="font-size:20px">💰</span>' +
        '<div style="flex:1">' +
          '<div style="font-size:16px;font-weight:800">Deposit to Polymarket</div>' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0;margin-top:2px">Fund your Polymarket wallet from any source</div>' +
        '</div>' +
        '<button onclick="HFXDeposit.close()" style="background:none;border:none;color:#888;font-size:22px;cursor:pointer;padding:0 6px">✕</button>' +
      '</div>' +

      // Balance display
      '<div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:180px;padding:12px 14px;background:rgba(255,255,255,0.02);border:1px solid #1e1e2a;border-radius:8px">' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">🦊 MetaMask</div>' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:18px;font-weight:800;color:' + (hasEoaUsdc ? '#f0f0f5' : '#8888a0') + '">$' + eoaBal.toFixed(2) + '</div>' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;margin-top:2px">' + (state.eoa ? state.eoa.slice(0,6) + '…' + state.eoa.slice(-4) : '') + '</div>' +
        '</div>' +
        '<div style="flex:1;min-width:180px;padding:12px 14px;background:rgba(0,230,138,0.04);border:1px solid rgba(0,230,138,0.2);border-radius:8px">' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#00e68a;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">📊 Polymarket</div>' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:18px;font-weight:800;color:#f0f0f5">$' + proxyBal.toFixed(2) + '</div>' +
          '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;margin-top:2px">' + (state.proxy ? state.proxy.slice(0,6) + '…' + state.proxy.slice(-4) : '') + '</div>' +
        '</div>' +
      '</div>' +

      tabsHtml +
      bodyHtml +
    '</div>';
  }

  // Helper to render an exchange instruction row
  function _exchangeRow(name, instructions, url) {
    return '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:rgba(255,255,255,0.02);border:1px solid #1e1e2a;border-radius:8px">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:12px;font-weight:800;color:#f0f0f5;margin-bottom:2px">' + _esc(name) + '</div>' +
        '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;line-height:1.5">' + instructions + '</div>' +
      '</div>' +
      '<a href="' + url + '" target="_blank" rel="noopener" style="color:#00e68a;text-decoration:none;font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:700;padding:6px 10px;border:1px solid rgba(0,230,138,0.3);border-radius:5px;flex-shrink:0;white-space:nowrap">Open →</a>' +
    '</div>';
  }

  // Cached state for the current modal instance
  var _state = null;

  async function open() {
    if (typeof window.ethereum === 'undefined') {
      alert('MetaMask required. Install or connect a wallet first.');
      return;
    }
    if (!window.ethers) {
      alert('ethers.js not yet loaded. Refresh the page and try again.');
      return;
    }

    var overlay = _ensureOverlay();
    overlay.innerHTML = _frame({ loading: true });

    try {
      // Get EOA (prompt MetaMask if not already connected)
      var eoa = (localStorage.getItem('poly_eoa_address') || '').toLowerCase();
      if (!eoa) {
        var accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (accounts && accounts.length) {
          eoa = accounts[0].toLowerCase();
          localStorage.setItem('poly_eoa_address', eoa);
        }
      }
      if (!eoa) throw new Error('Could not resolve your wallet address');

      // Get / compute proxy
      var proxy = (localStorage.getItem('hf_poly_wallet') || '').toLowerCase();
      if (!proxy || proxy === eoa) {
        var resolved = await _computeProxy(eoa);
        if (resolved && resolved !== window.ethers.ZeroAddress && resolved.toLowerCase() !== eoa) {
          proxy = resolved.toLowerCase();
          localStorage.setItem('hf_poly_wallet', proxy);
        }
      }
      if (!proxy) throw new Error('Could not resolve your Polymarket wallet. Complete setup first by visiting any market page.');

      // Fetch balances — EOA gets detailed breakdown (USDC.e vs native)
      var [eoaDetailed, proxyBal, polBal] = await Promise.all([
        _usdcBalanceDetailed(eoa),
        _usdcBalance(proxy),
        _polBalance(eoa)
      ]);

      console.log('[deposit] EOA balance:', eoaDetailed, 'proxy:', proxyBal, 'POL:', polBal);

      _state = {
        eoa: eoa, proxy: proxy,
        eoaBalance: eoaDetailed.total, eoaUsdce: eoaDetailed.usdce, eoaNativeUsdc: eoaDetailed.native,
        proxyBalance: proxyBal, polBalance: polBal
      };
      overlay.innerHTML = _frame(_state);
    } catch (e) {
      overlay.innerHTML = _frame({ error: e.message || 'Unable to load deposit info' });
    }
  }

  async function _submit() {
    var amountInput = document.getElementById('hfxDepositAmount');
    if (!amountInput) return;
    var amount = parseFloat(amountInput.value);
    if (!amount || amount <= 0) {
      amountInput.style.borderColor = '#ff4d6a';
      return;
    }
    if (!_state) return;

    var overlay = document.getElementById('hfxDepositOverlay');
    if (!overlay) return;
    overlay.innerHTML = _frame(Object.assign({}, _state, { signing: true, amount: amount }));

    try {
      // Ensure on Polygon
      var chainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (chainId !== '0x89') {
        try {
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x89' }] });
        } catch (switchErr) {
          if (switchErr.code === 4902) {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{ chainId: '0x89', chainName: 'Polygon', nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 }, rpcUrls: ['https://polygon-rpc.com'], blockExplorerUrls: ['https://polygonscan.com'] }]
            });
          } else throw switchErr;
        }
      }

      // Signer via HFXWallet if available, else direct
      var signer;
      if (window.HFXWallet && window.HFXWallet.getSigner) {
        var ctx = await window.HFXWallet.getSigner();
        signer = ctx.signer || ctx;
      } else {
        var provider = new window.ethers.BrowserProvider(window.ethereum);
        signer = await provider.getSigner();
      }

      // Pick the right USDC contract based on where the user's funds are.
      // If they have enough USDC.e, use that (Polymarket native). Otherwise
      // use native USDC. Both are valid ERC-20 transfers to the proxy.
      var usdcAddr = USDC_ADDRESS; // default: USDC.e
      if (_state.eoaUsdce != null && _state.eoaUsdce < amount && _state.eoaNativeUsdc >= amount) {
        usdcAddr = USDC_NATIVE_POLYGON;
        console.log('[deposit] Using native Polygon USDC (user has $' + _state.eoaNativeUsdc.toFixed(2) + ' native, $' + _state.eoaUsdce.toFixed(2) + ' USDC.e)');
      }
      var usdc = new window.ethers.Contract(usdcAddr, ['function transfer(address to, uint256 amount) returns (bool)'], signer);
      var amountWei = window.ethers.parseUnits(amount.toFixed(6), 6);
      var tx = await usdc.transfer(_state.proxy, amountWei);

      overlay.innerHTML = _frame(Object.assign({}, _state, { confirming: true, amount: amount, txHash: tx.hash }));

      await tx.wait();

      var newProxyBal = await _usdcBalance(_state.proxy);
      overlay.innerHTML = _frame({
        success: true,
        amount: amount,
        newProxyBalance: newProxyBal != null ? newProxyBal : (_state.proxyBalance || 0) + amount,
        txHash: tx.hash
      });

      // Refresh any external balance displays
      try {
        if (typeof window.fetchTradeBalance === 'function') window.fetchTradeBalance();
      } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('hfx_deposit_success', { detail: { amount: amount, txHash: tx.hash } })); } catch (e) {}
    } catch (err) {
      var msg = (err && err.message) || 'Unknown error';
      if (err && (err.code === 'ACTION_REJECTED' || err.code === 4001)) {
        msg = 'You rejected the transaction in MetaMask.';
      } else if (err && err.message && /insufficient funds/i.test(err.message)) {
        msg = 'Not enough POL in your wallet for gas. You need a tiny amount (~$0.01 in POL).';
      }
      overlay.innerHTML = _frame({ error: msg });
    }
  }

  // ── Gasless deposit via EIP-3009 TransferWithAuthorization ──
  //
  // User signs an EIP-712 message (FREE — no gas, no on-chain tx). Server
  // relayer submits USDC.transferWithAuthorization() on their behalf and
  // pays the POL gas. User gets USDC in their Polymarket wallet in seconds
  // without needing any POL at all.
  //
  // Polygon USDC (0x2791Bca...) uses a `salt`-based EIP-712 domain instead
  // of the standard `chainId` field — this predates the chainId-in-domain
  // standard. The salt is the chainId encoded as bytes32.
  async function _submitGasless() {
    var amountInput = document.getElementById('hfxDepositAmount');
    if (!amountInput) return;
    var amount = parseFloat(amountInput.value);
    if (!amount || amount <= 0) {
      amountInput.style.borderColor = '#ff4d6a';
      return;
    }
    if (!_state) return;

    var overlay = document.getElementById('hfxDepositOverlay');
    if (!overlay) return;
    overlay.innerHTML = _frame(Object.assign({}, _state, { signing: true, amount: amount }));

    try {
      // Ensure MetaMask is on Polygon (required for signing with the right chainId)
      var chainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (chainId !== '0x89') {
        try {
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x89' }] });
        } catch (switchErr) {
          if (switchErr.code === 4902) {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{ chainId: '0x89', chainName: 'Polygon', nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 }, rpcUrls: ['https://polygon-rpc.com'], blockExplorerUrls: ['https://polygonscan.com'] }]
            });
          } else throw switchErr;
        }
      }

      // Get signer
      var signer;
      if (window.HFXWallet && window.HFXWallet.getSigner) {
        var ctx = await window.HFXWallet.getSigner();
        signer = ctx.signer || ctx;
      } else {
        var provider = new window.ethers.BrowserProvider(window.ethereum);
        signer = await provider.getSigner();
      }

      // Build the EIP-712 TransferWithAuthorization message
      var amountWei = window.ethers.parseUnits(amount.toFixed(6), 6).toString();
      var validAfter = 0;
      var validBefore = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      // Generate a 32-byte random nonce
      var nonceBytes = new Uint8Array(32);
      (window.crypto || window.msCrypto).getRandomValues(nonceBytes);
      var nonce = '0x' + Array.from(nonceBytes).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');

      // Polygon USDC uses `salt` (bytes32 chainId) instead of chainId in the domain
      // This is a Circle quirk — their v1 USDC on Polygon was deployed before
      // chainId-in-domain was standardized.
      var domain = {
        name: 'USD Coin (PoS)',
        version: '1',
        verifyingContract: USDC_ADDRESS,
        salt: '0x0000000000000000000000000000000000000000000000000000000000000089'  // chainId 137 as bytes32
      };
      var types = {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' }
        ]
      };
      var message = {
        from: _state.eoa,
        to: _state.proxy,
        value: amountWei,
        validAfter: validAfter,
        validBefore: validBefore,
        nonce: nonce
      };

      // Sign the EIP-712 message (free, no gas)
      var signature = await signer.signTypedData(domain, types, message);
      var sig = window.ethers.Signature.from(signature);

      overlay.innerHTML = _frame(Object.assign({}, _state, { confirming: true, amount: amount }));

      // Submit the authorization to our relayer
      var token = localStorage.getItem('hf_token') || localStorage.getItem('hf_creator_token') || '';
      var r = await fetch('/api/gasless-deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
        body: JSON.stringify({
          from: _state.eoa,
          to: _state.proxy,
          value: amountWei,
          validAfter: validAfter,
          validBefore: validBefore,
          nonce: nonce,
          v: sig.v,
          r: sig.r,
          s: sig.s
        })
      });
      var data = await r.json();

      if (!r.ok) {
        throw new Error(data.error || 'Relayer submission failed');
      }

      // Success — update the overlay
      overlay.innerHTML = _frame(Object.assign({}, _state, { confirming: true, amount: amount, txHash: data.tx_hash }));

      // Small delay so the user sees the confirming state (tx already confirmed at this point)
      setTimeout(async function() {
        var newProxyBal = await _usdcBalance(_state.proxy);
        overlay.innerHTML = _frame({
          success: true,
          amount: amount,
          newProxyBalance: newProxyBal != null ? newProxyBal : (_state.proxyBalance || 0) + amount,
          txHash: data.tx_hash,
          gasless: true
        });

        // Refresh any external balance displays
        try { if (typeof window.fetchTradeBalance === 'function') window.fetchTradeBalance(); } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('hfx_deposit_success', { detail: { amount: amount, txHash: data.tx_hash, gasless: true } })); } catch (e) {}
      }, 600);
    } catch (err) {
      var msg = (err && err.message) || 'Unknown error';
      if (err && (err.code === 'ACTION_REJECTED' || err.code === 4001)) {
        msg = 'You rejected the signature in MetaMask.';
      } else if (err && err.message && /auth required/i.test(err.message)) {
        msg = 'Please sign in to HYPERFLEX first — gasless deposits require an account.';
      }
      overlay.innerHTML = _frame({ error: msg });
    }
  }

  // ── Bridge flow helpers ──
  // LI.FI chain config
  // Native USDC + bridged USDC.e addresses per chain.
  // Many users hold USDC.e (the old bridged version), not native USDC.
  // We check BOTH and show the sum so the balance display is never $0
  // when the user actually has funds. LI.FI can route either token.
  var BRIDGE_CHAINS = {
    1:     { name: 'Ethereum', hex: '0x1',    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', rpcs: ['https://eth.llamarpc.com', 'https://1rpc.io/eth'], scan: 'https://etherscan.io/tx/', gas: 'ETH' },
    42161: { name: 'Arbitrum', hex: '0xa4b1', usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', usdce: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', rpcs: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum.llamarpc.com', 'https://1rpc.io/arb'], scan: 'https://arbiscan.io/tx/', gas: 'ETH' },
    8453:  { name: 'Base',     hex: '0x2105', usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', usdce: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', rpcs: ['https://mainnet.base.org', 'https://1rpc.io/base'], scan: 'https://basescan.org/tx/', gas: 'ETH' },
    10:    { name: 'Optimism', hex: '0xa',    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', usdce: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', rpcs: ['https://mainnet.optimism.io', 'https://1rpc.io/op'], scan: 'https://optimistic.etherscan.io/tx/', gas: 'ETH' },
    56:    { name: 'BSC',      hex: '0x38',   usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', rpcs: ['https://bsc-dataseed.binance.org', 'https://1rpc.io/bnb'], scan: 'https://bscscan.com/tx/', gas: 'BNB' }
  };

  function _bridgeChainName(id) { return (BRIDGE_CHAINS[id] || {}).name || 'Unknown'; }

  // Get a working provider from the rpcs list (with fallback)
  async function _getChainProvider(rpcs) {
    for (var i = 0; i < rpcs.length; i++) {
      try {
        var p = new window.ethers.JsonRpcProvider(rpcs[i]);
        await p.getBlockNumber();
        return p;
      } catch (e) { console.warn('[bridge] RPC failed:', rpcs[i], e.message); }
    }
    throw new Error('All RPCs failed');
  }

  // Raw eth_call balance read via fetch — no ethers dependency, no CORS wrapper
  // balanceOf(address) selector = 0x70a08231
  function _rawBalanceCall(rpcUrl, tokenAddr, ownerAddr) {
    var padded = ownerAddr.toLowerCase().replace('0x', '');
    while (padded.length < 64) padded = '0' + padded;
    var data = '0x70a08231' + padded;
    return fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: tokenAddr, data: data }, 'latest'], id: 1 })
    }).then(function(r) { return r.json(); }).then(function(j) {
      if (j.result && j.result !== '0x' && j.result !== '0x0') {
        return parseInt(j.result, 16) / 1e6;
      }
      return 0;
    });
  }

  // Set source chain + fetch USDC balance (native + bridged USDC.e)
  // Two-tier: server endpoint → direct browser fetch to RPCs
  async function _setBridgeChain(chainId) {
    if (!_state) return;
    _state.bridgeFromChain = chainId;
    _state.bridgeSourceBalance = null;
    _state.bridgeActiveToken = null;
    var overlay = document.getElementById('hfxDepositOverlay');
    if (overlay) overlay.innerHTML = _frame(_state);

    var cfg = BRIDGE_CHAINS[chainId];
    if (!cfg || !_state.eoa) return;
    var nativeBal = 0, bridgedBal = 0;
    var fetched = false;

    // ── Tier 1: Server-side /api/bridge/balance (no CORS, reliable) ──
    try {
      var balRes = await fetch('/api/bridge/balance?address=' + encodeURIComponent(_state.eoa) + '&chainId=' + chainId);
      if (balRes.ok) {
        var balData = await balRes.json();
        console.log('[bridge]', cfg.name, 'server balance:', balData);
        nativeBal = balData.native || 0;
        bridgedBal = balData.bridged || 0;
        fetched = true;
      } else {
        console.warn('[bridge] server balance returned', balRes.status);
      }
    } catch (e) { console.warn('[bridge] server balance failed:', e.message); }

    // ── Tier 2: Direct fetch to public RPCs (try each until one works) ──
    if (!fetched) {
      for (var ri = 0; ri < cfg.rpcs.length && !fetched; ri++) {
        try {
          var results = await Promise.all([
            _rawBalanceCall(cfg.rpcs[ri], cfg.usdc, _state.eoa).catch(function() { return 0; }),
            cfg.usdce ? _rawBalanceCall(cfg.rpcs[ri], cfg.usdce, _state.eoa).catch(function() { return 0; }) : Promise.resolve(0)
          ]);
          nativeBal = results[0];
          bridgedBal = results[1];
          if (nativeBal > 0 || bridgedBal > 0) fetched = true;
          console.log('[bridge]', cfg.name, 'RPC', cfg.rpcs[ri], 'native=', nativeBal, 'bridged=', bridgedBal);
          fetched = true; // even 0 balance from a successful RPC call is valid
        } catch (rpcErr) {
          console.warn('[bridge] RPC', cfg.rpcs[ri], 'failed:', rpcErr.message);
        }
      }
    }

    _state.bridgeSourceBalance = nativeBal + bridgedBal;
    _state.bridgeActiveToken = bridgedBal > nativeBal ? (cfg.usdce || cfg.usdc) : cfg.usdc;
    _state.bridgeNativeBalance = nativeBal;
    _state.bridgeBridgedBalance = bridgedBal;

    var overlay2 = document.getElementById('hfxDepositOverlay');
    if (overlay2) overlay2.innerHTML = _frame(_state);
  }

  function _setBridgeStep(step) {
    if (!_state) return;
    _state.bridgeStep = step;
    if (step === 'select') {
      _state.bridgeQuote = null;
      _state.bridgeTxHash = null;
      _state.bridgePollMessage = null;
    }
    var overlay = document.getElementById('hfxDepositOverlay');
    if (overlay) overlay.innerHTML = _frame(_state);
  }

  // Fetch a bridge quote — tries Relay (gasless) first, falls back to LI.FI
  async function _fetchBridgeQuote() {
    var amtInput = document.getElementById('hfxBridgeAmount');
    if (!amtInput) return;
    var amount = parseFloat(amtInput.value);
    if (!amount || amount < 1) {
      amtInput.style.borderColor = '#ff4d6a';
      return;
    }
    if (!_state) return;
    _state.bridgeAmount = amount;

    var chainId = _state.bridgeFromChain || 42161;
    _state.bridgeFromChain = chainId;
    var cfg = BRIDGE_CHAINS[chainId];
    if (!cfg) return;

    // Check balance
    if (_state.bridgeSourceBalance != null && _state.bridgeSourceBalance < amount) {
      alert('Not enough USDC on ' + cfg.name + '. You have $' + _state.bridgeSourceBalance.toFixed(2) + ' but tried to bridge $' + amount.toFixed(2));
      return;
    }

    _state.bridgeStep = 'quote';
    _state.bridgeQuote = null;
    _state.bridgeProvider = null; // 'relay' or 'lifi'
    var overlay = document.getElementById('hfxDepositOverlay');
    if (overlay) overlay.innerHTML = _frame(_state);

    var fromAmount = Math.floor(amount * 1e6).toString();
    var fromToken = _state.bridgeActiveToken || cfg.usdc;

    // ── Try Relay first (gasless — user only signs a permit, no ETH needed) ──
    try {
      console.log('[bridge] trying Relay gasless quote…');
      var relayRes = await fetch('/api/bridge/relay-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromChain: chainId,
          toChain: 137,
          fromAddress: _state.eoa,
          toAddress: _state.proxy,
          amount: fromAmount,
          currency: fromToken
        })
      });
      var relayData = await relayRes.json();
      if (relayRes.ok && relayData && relayData.steps && relayData.steps.length > 0) {
        console.log('[bridge] Relay quote OK:', relayData);
        _state.bridgeQuote = relayData;
        _state.bridgeProvider = 'relay';
        var overlay2 = document.getElementById('hfxDepositOverlay');
        if (overlay2) overlay2.innerHTML = _frame(_state);
        return;
      }
      console.warn('[bridge] Relay quote failed:', relayData.error || relayData.message || 'no steps');
    } catch (relayErr) {
      console.warn('[bridge] Relay error:', relayErr.message);
    }

    // ── Fallback: LI.FI (requires gas on source chain) ──
    try {
      console.log('[bridge] falling back to LI.FI…');
      var params = new URLSearchParams({
        fromChain: String(chainId),
        fromToken: fromToken,
        toChain: '137',
        toToken: USDC_ADDRESS,
        fromAddress: _state.eoa,
        toAddress: _state.proxy,
        fromAmount: fromAmount
      });
      var r = await fetch('/api/bridge/quote?' + params.toString());
      var data = await r.json();
      if (!r.ok) {
        _state.bridgeQuote = { error: data.error || 'Failed to fetch route' };
      } else {
        _state.bridgeQuote = data;
        _state.bridgeProvider = 'lifi';
      }
    } catch (e) {
      _state.bridgeQuote = { error: e.message || 'Network error' };
    }
    var overlay3 = document.getElementById('hfxDepositOverlay');
    if (overlay3) overlay3.innerHTML = _frame(_state);
  }

  // Execute the bridge transaction — dispatches to Relay (gasless) or LI.FI
  async function _executeBridge() {
    if (!_state || !_state.bridgeQuote) {
      alert('No quote available — please refresh and try again.');
      return;
    }

    // Dispatch to Relay gasless bridge if that's the active provider
    if (_state.bridgeProvider === 'relay') {
      return _executeRelayBridge();
    }

    // LI.FI flow — requires gas on source chain
    if (!_state.bridgeQuote.transactionRequest) {
      alert('No transaction data in quote — please go back and get a new quote.');
      return;
    }
    var chainId = _state.bridgeFromChain || 42161;
    _state.bridgeFromChain = chainId; // ensure persisted
    var cfg = BRIDGE_CHAINS[chainId];
    var txReq = _state.bridgeQuote.transactionRequest;

    if (!cfg) {
      var overlay0 = document.getElementById('hfxDepositOverlay');
      if (overlay0) overlay0.innerHTML = _frame({ error: 'Unsupported source chain (ID: ' + chainId + '). Please select Ethereum, Arbitrum, Base, Optimism, or BSC.' });
      return;
    }

    if (!txReq || !txReq.to || !txReq.data) {
      var overlay00 = document.getElementById('hfxDepositOverlay');
      if (overlay00) overlay00.innerHTML = _frame({ error: 'Invalid transaction from bridge route. Please go back and get a new quote.' });
      return;
    }

    _state.bridgeStep = 'executing';
    _state.bridgePollMessage = 'Switching to ' + cfg.name + '…';
    _state.bridgeSubMessage = 'Check MetaMask';
    var overlay = document.getElementById('hfxDepositOverlay');
    if (overlay) overlay.innerHTML = _frame(_state);

    try {
      // Switch MetaMask to source chain
      var currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (currentChainId !== cfg.hex) {
        try {
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: cfg.hex }] });
        } catch (switchErr) {
          if (switchErr.code === 4902) {
            // Add chain first
            var chainParams = {
              1: { chainId: '0x1', chainName: 'Ethereum', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: [cfg.rpcs[0]], blockExplorerUrls: ['https://etherscan.io'] },
              42161: { chainId: '0xa4b1', chainName: 'Arbitrum One', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: [cfg.rpcs[0]], blockExplorerUrls: ['https://arbiscan.io'] },
              8453: { chainId: '0x2105', chainName: 'Base', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: [cfg.rpcs[0]], blockExplorerUrls: ['https://basescan.org'] },
              10: { chainId: '0xa', chainName: 'Optimism', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: [cfg.rpcs[0]], blockExplorerUrls: ['https://optimistic.etherscan.io'] },
              56: { chainId: '0x38', chainName: 'BNB Smart Chain', nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 }, rpcUrls: [cfg.rpcs[0]], blockExplorerUrls: ['https://bscscan.com'] }
            }[chainId];
            if (chainParams) {
              await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [chainParams] });
            }
          } else {
            throw switchErr;
          }
        }
      }

      // HFXWallet cache may be stale after chain switch — invalidate + get fresh signer
      if (window.HFXWallet && window.HFXWallet.invalidate) window.HFXWallet.invalidate();
      var provider = new window.ethers.BrowserProvider(window.ethereum);
      var signer = await provider.getSigner();

      // Check native gas balance before prompting wallet signature
      try {
        var gasBalance = await provider.getBalance(await signer.getAddress());
        var gasEth = parseFloat(window.ethers.formatEther(gasBalance));
        if (gasEth < 0.0001) {
          var gasToken = cfg.gas || 'ETH';
          var overlay_gas = document.getElementById('hfxDepositOverlay');
          if (overlay_gas) overlay_gas.innerHTML = _frame({ error: 'You need ' + gasToken + ' on ' + cfg.name + ' to pay for gas. Send ~$0.50 of ' + gasToken + ' to your wallet and try again. USDC alone isn\'t enough — every transaction needs a tiny amount of ' + gasToken + ' for network fees.' });
          return;
        }
      } catch (gasErr) { /* non-fatal — let MetaMask handle it */ }

      // ── ERC-20 approval check ──
      // LI.FI routes require the router contract to spend the user's USDC.
      // If the quote includes an approvalAddress, check allowance and approve if needed.
      var approvalAddr = (_state.bridgeQuote.estimate && _state.bridgeQuote.estimate.approvalAddress) || txReq.to;
      var fromTokenAddr = (_state.bridgeQuote.action && _state.bridgeQuote.action.fromToken && _state.bridgeQuote.action.fromToken.address) || (_state.bridgeActiveToken || cfg.usdc);

      if (approvalAddr && fromTokenAddr) {
        try {
          var erc20Abi = ['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];
          var tokenContract = new window.ethers.Contract(fromTokenAddr, erc20Abi, signer);
          var signerAddr = await signer.getAddress();
          var currentAllowance = await tokenContract.allowance(signerAddr, approvalAddr);
          var neededAmount = window.ethers.parseUnits(String(_state.bridgeAmount), 6);

          if (currentAllowance < neededAmount) {
            _state.bridgePollMessage = 'Approve USDC spending…';
            _state.bridgeSubMessage = 'MetaMask will ask to approve the bridge router';
            var overlayApproval = document.getElementById('hfxDepositOverlay');
            if (overlayApproval) overlayApproval.innerHTML = _frame(_state);

            // Approve max uint256 so user doesn't need to re-approve for future bridges
            var maxUint = window.ethers.MaxUint256;
            var approveTx = await tokenContract.approve(approvalAddr, maxUint);
            _state.bridgePollMessage = 'Waiting for approval…';
            _state.bridgeSubMessage = 'Confirming on ' + cfg.name;
            var overlayApproval2 = document.getElementById('hfxDepositOverlay');
            if (overlayApproval2) overlayApproval2.innerHTML = _frame(_state);
            await approveTx.wait(1);
            console.log('[bridge] ERC-20 approval confirmed:', approveTx.hash);
          } else {
            console.log('[bridge] Sufficient allowance, skipping approval');
          }
        } catch (approveErr) {
          if (approveErr && (approveErr.code === 'ACTION_REJECTED' || approveErr.code === 4001)) {
            throw new Error('You rejected the approval in MetaMask.');
          }
          console.warn('[bridge] Approval check/tx failed:', approveErr.message);
          // Continue anyway — the bridge tx might work if the token doesn't need approval
          // (e.g., native ETH bridging) or if approval was already granted
        }
      }

      _state.bridgePollMessage = 'Sign bridge transaction…';
      _state.bridgeSubMessage = 'MetaMask will ask to confirm the bridge';
      var overlay2 = document.getElementById('hfxDepositOverlay');
      if (overlay2) overlay2.innerHTML = _frame(_state);

      // Submit the bridge tx as returned by LI.FI
      var tx = await signer.sendTransaction({
        to: txReq.to,
        data: txReq.data,
        value: txReq.value || '0',
        gasLimit: txReq.gasLimit || undefined
      });

      _state.bridgeTxHash = tx.hash;
      _state.bridgePollMessage = 'Transaction sent';
      _state.bridgeSubMessage = 'Waiting for confirmation on ' + cfg.name + '…';
      var overlay3 = document.getElementById('hfxDepositOverlay');
      if (overlay3) overlay3.innerHTML = _frame(_state);

      // Wait for source chain confirmation
      await tx.wait(1);

      // Start polling LI.FI status
      _state.bridgeStep = 'polling';
      _state.bridgePollMessage = 'Bridging to Polygon…';
      _state.bridgeSubMessage = 'This typically takes 1-5 minutes depending on the route';
      var overlay4 = document.getElementById('hfxDepositOverlay');
      if (overlay4) overlay4.innerHTML = _frame(_state);
      _pollBridgeStatus(tx.hash, chainId);
    } catch (err) {
      var msg = (err && err.message) || 'Unknown error';
      if (err && (err.code === 'ACTION_REJECTED' || err.code === 4001)) {
        msg = 'You rejected the transaction in MetaMask.';
      }
      var overlay5 = document.getElementById('hfxDepositOverlay');
      if (overlay5) overlay5.innerHTML = _frame({ error: msg });
    }
  }

  // Poll LI.FI /status endpoint until DONE or FAILED
  async function _pollBridgeStatus(txHash, fromChainId) {
    var maxPolls = 90; // 90 × 5s = 7.5 min max
    var pollInterval = 5000;
    var polls = 0;
    var tool = (_state && _state.bridgeQuote && _state.bridgeQuote.tool) || '';

    async function tick() {
      polls++;
      try {
        var params = new URLSearchParams({ txHash: txHash, fromChain: String(fromChainId), toChain: '137' });
        if (tool) params.set('bridge', tool);
        var r = await fetch('/api/bridge/status?' + params.toString());
        var data = await r.json();
        var status = data.status || 'PENDING';
        var substatus = data.substatus || '';

        if (status === 'DONE') {
          // Fetch new proxy balance to show
          var newBal = await _usdcBalance(_state.proxy);
          var overlay = document.getElementById('hfxDepositOverlay');
          if (overlay) {
            overlay.innerHTML = _frame({
              success: true,
              amount: _state.bridgeAmount || 0,
              newProxyBalance: newBal != null ? newBal : 0,
              txHash: (data.receiving && data.receiving.txHash) || txHash,
              bridged: true
            });
          }
          try { if (typeof window.fetchTradeBalance === 'function') window.fetchTradeBalance(); } catch (e) {}
          try { window.dispatchEvent(new CustomEvent('hfx_deposit_success', { detail: { amount: _state.bridgeAmount, bridged: true } })); } catch (e) {}
          return;
        }
        if (status === 'FAILED') {
          var overlay2 = document.getElementById('hfxDepositOverlay');
          if (overlay2) overlay2.innerHTML = _frame({ error: 'Bridge failed: ' + (data.substatusMessage || 'Unknown reason') });
          return;
        }

        // Still pending — update the message
        if (_state && _state.bridgeStep === 'polling') {
          var statusMsg = substatus === 'BRIDGE_NOT_AVAILABLE' ? 'Finding route…' :
                          substatus === 'CHAIN_NOT_AVAILABLE' ? 'Waiting for bridge…' :
                          substatus === 'WAIT_SOURCE_CONFIRMATIONS' ? 'Waiting for source chain confirmations…' :
                          substatus === 'WAIT_DESTINATION_TRANSACTION' ? 'Bridge initiated — waiting for Polygon delivery…' :
                          'Bridging to Polygon…';
          _state.bridgePollMessage = statusMsg;
          _state.bridgeSubMessage = 'Usually 1-5 min · you can close this modal and we\'ll finish in the background';
          var overlay3 = document.getElementById('hfxDepositOverlay');
          if (overlay3) overlay3.innerHTML = _frame(_state);
        }

        if (polls < maxPolls) {
          setTimeout(tick, pollInterval);
        } else {
          var overlay4 = document.getElementById('hfxDepositOverlay');
          if (overlay4) overlay4.innerHTML = _frame({ error: 'Bridge still pending after 7 minutes. Your source tx succeeded — check ' + (BRIDGE_CHAINS[fromChainId] || {}).scan + txHash + ' and try refreshing your balance later.' });
        }
      } catch (e) {
        if (polls < maxPolls) setTimeout(tick, pollInterval);
        else {
          var overlay5 = document.getElementById('hfxDepositOverlay');
          if (overlay5) overlay5.innerHTML = _frame({ error: 'Polling error: ' + e.message });
        }
      }
    }
    setTimeout(tick, 3000); // first poll after 3s
  }

  // ── Relay gasless bridge execution ──
  // User signs permit messages (no gas), Relay's solver executes the bridge
  async function _executeRelayBridge() {
    if (!_state || !_state.bridgeQuote || !_state.bridgeQuote.steps) {
      alert('No Relay quote available — please refresh and try again.');
      return;
    }

    var steps = _state.bridgeQuote.steps;
    var cfg = BRIDGE_CHAINS[_state.bridgeFromChain || 42161];

    _state.bridgeStep = 'executing';
    _state.bridgePollMessage = 'Preparing gasless bridge…';
    _state.bridgeSubMessage = 'No gas needed — just sign the message';
    var overlay = document.getElementById('hfxDepositOverlay');
    if (overlay) overlay.innerHTML = _frame(_state);

    try {
      // Ensure MetaMask is on the source chain for signing
      var currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (cfg && currentChainId !== cfg.hex) {
        try {
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: cfg.hex }] });
        } catch (switchErr) {
          if (switchErr.code === 4902 && cfg) {
            var chainParams = {
              1: { chainId: '0x1', chainName: 'Ethereum', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: [cfg.rpcs[0]], blockExplorerUrls: ['https://etherscan.io'] },
              42161: { chainId: '0xa4b1', chainName: 'Arbitrum One', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: [cfg.rpcs[0]], blockExplorerUrls: ['https://arbiscan.io'] },
              8453: { chainId: '0x2105', chainName: 'Base', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: [cfg.rpcs[0]], blockExplorerUrls: ['https://basescan.org'] },
              10: { chainId: '0xa', chainName: 'Optimism', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: [cfg.rpcs[0]], blockExplorerUrls: ['https://optimistic.etherscan.io'] },
              56: { chainId: '0x38', chainName: 'BNB Smart Chain', nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 }, rpcUrls: [cfg.rpcs[0]], blockExplorerUrls: ['https://bscscan.com'] }
            }[_state.bridgeFromChain];
            if (chainParams) await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [chainParams] });
          } else {
            throw switchErr;
          }
        }
      }

      if (window.HFXWallet && window.HFXWallet.invalidate) window.HFXWallet.invalidate();
      var provider = new window.ethers.BrowserProvider(window.ethereum);
      var signer = await provider.getSigner();

      // Pre-check: does any Relay step require an on-chain transaction?
      // If so, user needs gas — warn them before we start
      var hasTransactionStep = steps.some(function(s) { return s.kind === 'transaction'; });
      if (hasTransactionStep) {
        try {
          var gasCheckBal = await provider.getBalance(await signer.getAddress());
          var gasCheckEth = parseFloat(window.ethers.formatEther(gasCheckBal));
          if (gasCheckEth < 0.0001) {
            var gasToken = cfg ? (cfg.gas || 'ETH') : 'ETH';
            var chainName = cfg ? cfg.name : 'this chain';
            var overlayNoGas = document.getElementById('hfxDepositOverlay');
            if (overlayNoGas) overlayNoGas.innerHTML = _frame({ error: 'This route requires a one-time USDC approval transaction which needs ' + gasToken + ' for gas on ' + chainName + '. Send ~$0.50 of ' + gasToken + ' to your wallet and try again. After this first approval, future bridges will be fully gasless.' });
            return;
          }
        } catch (gasE) { /* continue — let it fail naturally if no gas */ }
      }

      // Process each step from Relay
      // Relay step format: { kind: 'signature'|'transaction', items: [{ status, data: { sign, post } }] }
      var requestId = null;
      for (var si = 0; si < steps.length; si++) {
        var step = steps[si];
        var items = step.items || [];
        console.log('[relay] step', si, 'kind:', step.kind, 'items:', items.length, JSON.stringify(step).slice(0, 500));

        for (var ii = 0; ii < items.length; ii++) {
          var item = items[ii];
          console.log('[relay] item', ii, 'keys:', Object.keys(item), JSON.stringify(item).slice(0, 500));

          // Relay nests sign data at item.data.sign or item.data directly
          var signData = (item.data && item.data.sign) ? item.data.sign : item.data;
          var postData = (item.data && item.data.post) ? item.data.post : item.postData;

          if (step.kind === 'signature') {
            // ── Signature step (gasless permit) ──
            _state.bridgePollMessage = 'Sign in wallet…';
            _state.bridgeSubMessage = 'Approve USDC transfer (no gas needed)';
            var overlaySign = document.getElementById('hfxDepositOverlay');
            if (overlaySign) overlaySign.innerHTML = _frame(_state);

            var signature;
            console.log('[relay] signData keys:', signData ? Object.keys(signData) : 'null');

            if (signData && signData.domain && signData.types) {
              // EIP-712 typed data signing
              var types = Object.assign({}, signData.types);
              delete types.EIP712Domain; // ethers adds this automatically

              // Find the primary type value — could be signData.message, signData.value, or signData.primaryType
              var msgValue = signData.message || signData.value || {};

              // If types is empty after removing EIP712Domain, check if primaryType is set
              var typeKeys = Object.keys(types);
              if (typeKeys.length === 0 && signData.primaryType) {
                // Reconstruct types from the raw sign data
                console.warn('[relay] types empty after removing EIP712Domain, using raw eth_signTypedData_v4');
                var rawTypedData = JSON.stringify({
                  domain: signData.domain,
                  types: signData.types,
                  primaryType: signData.primaryType,
                  message: msgValue
                });
                signature = await window.ethereum.request({
                  method: 'eth_signTypedData_v4',
                  params: [await signer.getAddress(), rawTypedData]
                });
              } else if (typeKeys.length > 0) {
                signature = await signer.signTypedData(signData.domain, types, msgValue);
              } else {
                throw new Error('No valid types found in sign data');
              }
            } else if (signData && signData.signatureKind === 'eip191') {
              signature = await signer.signMessage(signData.message || signData);
            } else if (typeof signData === 'string') {
              signature = await signer.signMessage(signData);
            } else {
              // Last resort: try raw eth_signTypedData_v4 with the full data
              console.warn('[relay] unknown sign format, trying raw eth_signTypedData_v4');
              var rawData = typeof signData === 'object' ? JSON.stringify(signData) : String(signData);
              signature = await window.ethereum.request({
                method: 'eth_signTypedData_v4',
                params: [await signer.getAddress(), rawData]
              });
            }

            console.log('[relay] signature obtained:', signature ? signature.slice(0, 20) + '…' : 'null');

            // POST the signature back to Relay
            if (postData && postData.endpoint) {
              var postUrl = postData.endpoint;
              var postBody = postData.body ? JSON.parse(JSON.stringify(postData.body)) : {};
              postBody.signature = signature;

              console.log('[relay] posting to:', postUrl);
              var postRes = await fetch(postUrl, {
                method: postData.method || 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(postBody)
              });

              var postResult;
              try { postResult = await postRes.json(); } catch (e) { postResult = {}; }
              console.log('[relay] post result:', JSON.stringify(postResult).slice(0, 300));

              // Extract requestId for status polling
              if (postResult.requestId) requestId = postResult.requestId;
              if (postResult.id) requestId = postResult.id;
            }

          } else if (step.kind === 'transaction') {
            // ── Transaction step ──
            _state.bridgePollMessage = 'Confirm transaction…';
            _state.bridgeSubMessage = 'Your wallet will ask to sign';
            var overlayTx = document.getElementById('hfxDepositOverlay');
            if (overlayTx) overlayTx.innerHTML = _frame(_state);

            var txData = (item.data && item.data.to) ? item.data : (signData && signData.to ? signData : item);
            var tx = await signer.sendTransaction({
              to: txData.to,
              data: txData.data || '0x',
              value: txData.value || '0',
              gasLimit: txData.gasLimit || txData.gas || undefined
            });
            await tx.wait(1);
            console.log('[relay] tx step confirmed:', tx.hash);
            if (!requestId) requestId = tx.hash;

            // Check for post-tx callback
            if (postData && postData.endpoint) {
              var txPostBody = postData.body ? JSON.parse(JSON.stringify(postData.body)) : {};
              txPostBody.txHash = tx.hash;
              try {
                var txPostRes = await fetch(postData.endpoint, {
                  method: postData.method || 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(txPostBody)
                });
                var txPostResult = await txPostRes.json();
                if (txPostResult.requestId) requestId = txPostResult.requestId;
                if (txPostResult.id) requestId = txPostResult.id;
              } catch (e) { console.warn('[relay] post-tx callback failed:', e.message); }
            }
          }
        }
      }

      // Extract requestId from quote if not obtained from step execution
      if (!requestId && _state.bridgeQuote.protocol) {
        requestId = _state.bridgeQuote.protocol.requestId || _state.bridgeQuote.protocol.orderId;
      }

      if (!requestId) {
        // No requestId — show optimistic success after a delay
        _state.bridgeStep = 'polling';
        _state.bridgePollMessage = 'Bridge submitted…';
        _state.bridgeSubMessage = 'Waiting for Relay to process';
        var overlayOpt = document.getElementById('hfxDepositOverlay');
        if (overlayOpt) overlayOpt.innerHTML = _frame(_state);
        // Check proxy balance after 30s
        setTimeout(async function() {
          var newBal = await _usdcBalance(_state.proxy);
          var overlayDone = document.getElementById('hfxDepositOverlay');
          if (overlayDone) overlayDone.innerHTML = _frame({
            success: true, amount: _state.bridgeAmount || 0,
            newProxyBalance: newBal != null ? newBal : 0, bridged: true
          });
          try { if (typeof window.fetchTradeBalance === 'function') window.fetchTradeBalance(); } catch (e) {}
        }, 30000);
        return;
      }

      // Start polling Relay status
      _state.bridgeStep = 'polling';
      _state.bridgePollMessage = 'Bridging to Polygon…';
      _state.bridgeSubMessage = 'Gasless via Relay — usually takes 5-30 seconds';
      var overlayPoll = document.getElementById('hfxDepositOverlay');
      if (overlayPoll) overlayPoll.innerHTML = _frame(_state);
      _pollRelayStatus(requestId);

    } catch (err) {
      var msg = (err && err.message) || 'Unknown error';
      if (err && (err.code === 'ACTION_REJECTED' || err.code === 4001)) {
        msg = 'You rejected the signature in MetaMask.';
      } else if (msg.indexOf('-32002') !== -1 || msg.indexOf('too many errors') !== -1) {
        msg = 'RPC rate limited — the network endpoint is temporarily overloaded. Wait 30 seconds and try again.';
      } else if (msg.indexOf('insufficient funds') !== -1 || msg.indexOf('gas required') !== -1) {
        var gasToken = (cfg && cfg.gas) || 'ETH';
        msg = 'Not enough ' + gasToken + ' for gas. This route needs a small amount of ' + gasToken + ' (~$0.20) for a one-time approval. After that, future bridges are gasless.';
      } else if (msg.length > 200) {
        // Truncate overly verbose RPC errors
        msg = msg.slice(0, 150) + '…';
      }
      var overlayErr = document.getElementById('hfxDepositOverlay');
      if (overlayErr) overlayErr.innerHTML = _frame({ error: msg });
    }
  }

  // Poll Relay /intents/status endpoint until completed or failed
  function _pollRelayStatus(requestId) {
    var maxPolls = 60; // 60 × 2s = 2 min
    var pollInterval = 2000;
    var polls = 0;

    async function tick() {
      polls++;
      try {
        var r = await fetch('/api/bridge/relay-status?requestId=' + encodeURIComponent(requestId));
        var data = await r.json();

        var status = (data.status || '').toLowerCase();

        if (status === 'success' || status === 'complete' || status === 'completed') {
          var newBal = await _usdcBalance(_state.proxy);
          var overlay = document.getElementById('hfxDepositOverlay');
          if (overlay) {
            overlay.innerHTML = _frame({
              success: true,
              amount: _state.bridgeAmount || 0,
              newProxyBalance: newBal != null ? newBal : 0,
              bridged: true,
              gasless: true
            });
          }
          try { if (typeof window.fetchTradeBalance === 'function') window.fetchTradeBalance(); } catch (e) {}
          try { window.dispatchEvent(new CustomEvent('hfx_deposit_success', { detail: { amount: _state.bridgeAmount, bridged: true } })); } catch (e) {}
          return;
        }

        if (status === 'failed' || status === 'error' || status === 'refunded') {
          var overlay2 = document.getElementById('hfxDepositOverlay');
          if (overlay2) overlay2.innerHTML = _frame({ error: 'Bridge failed: ' + (data.message || data.error || 'Unknown reason') + '. Your USDC was not deducted.' });
          return;
        }

        // Still pending
        if (_state && _state.bridgeStep === 'polling') {
          _state.bridgePollMessage = status === 'pending' ? 'Relay is processing…' : 'Bridging to Polygon…';
          _state.bridgeSubMessage = 'Gasless bridge — usually 5-30 seconds';
          var overlay3 = document.getElementById('hfxDepositOverlay');
          if (overlay3) overlay3.innerHTML = _frame(_state);
        }

        if (polls < maxPolls) setTimeout(tick, pollInterval);
        else {
          var overlay4 = document.getElementById('hfxDepositOverlay');
          if (overlay4) overlay4.innerHTML = _frame({ error: 'Bridge still pending after 2 minutes. Check your Polymarket balance shortly — it may still arrive.' });
        }
      } catch (e) {
        if (polls < maxPolls) setTimeout(tick, pollInterval);
        else {
          var overlay5 = document.getElementById('hfxDepositOverlay');
          if (overlay5) overlay5.innerHTML = _frame({ error: 'Status check failed: ' + e.message });
        }
      }
    }
    setTimeout(tick, 2000);
  }

  // Switch tabs without re-fetching balances
  function _setTab(tab) {
    if (!_state) return;
    _state.currentTab = tab;
    var overlay = document.getElementById('hfxDepositOverlay');
    if (overlay) overlay.innerHTML = _frame(_state);
    // Auto-fetch source balance when entering Bridge tab for the first time
    if (tab === 'bridge') {
      if (!_state.bridgeFromChain) _state.bridgeFromChain = 42161; // always ensure chain is set
      if (_state.bridgeSourceBalance == null) {
        _setBridgeChain(_state.bridgeFromChain);
      }
    }
  }

  // Copy the proxy address to clipboard with visual feedback
  function _copyAddr() {
    if (!_state || !_state.proxy) return;
    var addr = _state.proxy;
    var btn = document.getElementById('hfxDepositCopyBtn');
    var done = function() {
      if (btn) {
        var original = btn.innerHTML;
        btn.innerHTML = '✓ Copied!';
        btn.style.background = 'rgba(0,230,138,0.25)';
        setTimeout(function() { btn.innerHTML = original; btn.style.background = 'rgba(0,230,138,0.1)'; }, 1500);
      }
    };
    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(addr).then(done).catch(function() {
        // Fallback to execCommand
        try {
          var tmp = document.createElement('textarea');
          tmp.value = addr;
          document.body.appendChild(tmp);
          tmp.select();
          document.execCommand('copy');
          document.body.removeChild(tmp);
          done();
        } catch (e) {
          alert('Copy failed. Address: ' + addr);
        }
      });
    } else {
      try {
        var tmp2 = document.createElement('textarea');
        tmp2.value = addr;
        document.body.appendChild(tmp2);
        tmp2.select();
        document.execCommand('copy');
        document.body.removeChild(tmp2);
        done();
      } catch (e) {
        alert('Copy failed. Address: ' + addr);
      }
    }
  }

  // Public API
  window.HFXDeposit = {
    open: open,
    close: close,
    _submit: _submit,
    _submitGasless: _submitGasless,
    _setTab: _setTab,
    _copyAddr: _copyAddr,
    // Bridge flow
    _setBridgeChain: _setBridgeChain,
    _setBridgeStep: _setBridgeStep,
    _fetchBridgeQuote: _fetchBridgeQuote,
    _executeBridge: _executeBridge,
    _executeRelayBridge: _executeRelayBridge
  };
})();
