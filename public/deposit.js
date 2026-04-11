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

  var USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
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

  async function _usdcBalance(address) {
    if (!address) return null;
    try {
      var provider = await _getPublicProvider();
      var contract = new window.ethers.Contract(USDC_ADDRESS, ['function balanceOf(address) view returns (uint256)'], provider);
      var raw = await contract.balanceOf(address);
      return parseFloat(window.ethers.formatUnits(raw, 6));
    } catch (e) { return null; }
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
        // Auto-pick gasless if user has no POL — this is the key UX:
        // they never need to buy POL just to deposit USDC.
        var useGasless = !hasGas;
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
        } else {
          var est = quote.estimate || {};
          var fromAmt = parseFloat(est.fromAmountUSD || 0).toFixed(2);
          var toAmt = parseFloat(est.toAmountUSD || est.toAmount || 0).toFixed(2);
          // toAmount is in token units; convert to USDC (6 decimals)
          var toUsdc = est.toAmount ? (parseFloat(est.toAmount) / 1e6).toFixed(2) : toAmt;
          var duration = est.executionDuration || 300;
          var durationStr = duration < 120 ? duration + 's' : Math.round(duration / 60) + 'm';
          var gasCostUsd = est.gasCosts && est.gasCosts.length ? est.gasCosts.reduce(function(s, g) { return s + parseFloat(g.amountUSD || 0); }, 0).toFixed(2) : '—';
          var bridgeFeeUsd = est.feeCosts && est.feeCosts.length ? est.feeCosts.reduce(function(s, f) { return s + parseFloat(f.amountUSD || 0); }, 0).toFixed(2) : '0.00';
          var toolName = (quote.tool || 'auto').toUpperCase();
          var srcChainName = _bridgeChainName(state.bridgeFromChain);

          bodyHtml =
            '<div style="padding:14px 16px;background:rgba(0,230,138,0.04);border:1px solid rgba(0,230,138,0.25);border-radius:10px;margin-bottom:14px">' +
              '<div style="font-size:13px;font-weight:700;color:#00e68a;margin-bottom:4px">✓ Route found</div>' +
              '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#8888a0">Via <strong style="color:#f0f0f5">' + _esc(toolName) + '</strong> · estimated ' + durationStr + '</div>' +
            '</div>' +

            '<div style="display:flex;flex-direction:column;gap:8px;padding:14px;background:rgba(255,255,255,0.02);border:1px solid #1e1e2a;border-radius:10px;margin-bottom:14px;font-family:\'JetBrains Mono\',monospace;font-size:12px">' +
              '<div style="display:flex;justify-content:space-between"><span style="color:#8888a0">You send</span><span style="color:#f0f0f5;font-weight:700">$' + fromAmt + ' USDC on ' + _esc(srcChainName) + '</span></div>' +
              '<div style="display:flex;justify-content:space-between"><span style="color:#8888a0">You receive</span><span style="color:#00e68a;font-weight:700">$' + toUsdc + ' USDC on Polygon</span></div>' +
              '<div style="height:1px;background:#1e1e2a;margin:4px 0"></div>' +
              '<div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:#8888a0">Bridge fee</span><span style="color:#aaa">$' + bridgeFeeUsd + '</span></div>' +
              '<div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:#8888a0">Source chain gas</span><span style="color:#aaa">~$' + gasCostUsd + '</span></div>' +
              '<div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:#8888a0">Destination</span><span style="color:#aaa">' + _esc(proxyAddr.slice(0,6)) + '…' + _esc(proxyAddr.slice(-4)) + '</span></div>' +
            '</div>' +

            '<div style="display:flex;gap:8px">' +
              '<button onclick="HFXDeposit._setBridgeStep(\'select\')" style="background:rgba(255,255,255,0.06);color:#8888a0;border:1px solid #1e1e2a;padding:12px 16px;border-radius:8px;font-family:\'JetBrains Mono\',monospace;font-size:12px;font-weight:700;cursor:pointer;min-height:44px">← Back</button>' +
              '<button onclick="HFXDeposit._executeBridge()" id="hfxBridgeExecBtn" style="flex:1;background:#00e68a;color:#0a0a0f;border:none;padding:12px;border-radius:8px;font-family:\'JetBrains Mono\',monospace;font-size:13px;font-weight:800;cursor:pointer;min-height:44px">Sign & bridge $' + fromAmt + ' →</button>' +
            '</div>' +

            '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#8888a0;line-height:1.6;margin-top:12px;text-align:center">We\'ll switch MetaMask to ' + _esc(srcChainName) + ' and request one signature. USDC lands in your Polymarket wallet automatically.</div>';
        }
      } else {
        // SELECT step (default) — chain picker + amount
        var sourceChains = [
          { id: 42161, name: 'Arbitrum', icon: '🔵', usdc: '0xaf88d065e7f2c4323cd1623f11b60d34aa1bb087' },
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

      // Fetch balances
      var [eoaBal, proxyBal, polBal] = await Promise.all([
        _usdcBalance(eoa),
        _usdcBalance(proxy),
        _polBalance(eoa)
      ]);

      _state = {
        eoa: eoa, proxy: proxy,
        eoaBalance: eoaBal, proxyBalance: proxyBal, polBalance: polBal
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

      // USDC.transfer(proxy, amount * 1e6)
      var usdc = new window.ethers.Contract(USDC_ADDRESS, ['function transfer(address to, uint256 amount) returns (bool)'], signer);
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
  var BRIDGE_CHAINS = {
    1:     { name: 'Ethereum', hex: '0x1',    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', rpc: 'https://eth.llamarpc.com', scan: 'https://etherscan.io/tx/' },
    42161: { name: 'Arbitrum', hex: '0xa4b1', usdc: '0xaf88d065e7f2c4323cd1623f11b60d34aa1bb087', rpc: 'https://arb1.arbitrum.io/rpc', scan: 'https://arbiscan.io/tx/' },
    8453:  { name: 'Base',     hex: '0x2105', usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', rpc: 'https://mainnet.base.org', scan: 'https://basescan.org/tx/' },
    10:    { name: 'Optimism', hex: '0xa',    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', rpc: 'https://mainnet.optimism.io', scan: 'https://optimistic.etherscan.io/tx/' },
    56:    { name: 'BSC',      hex: '0x38',   usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', rpc: 'https://bsc-dataseed.binance.org', scan: 'https://bscscan.com/tx/' }
  };

  function _bridgeChainName(id) { return (BRIDGE_CHAINS[id] || {}).name || 'Unknown'; }

  // Set source chain + fetch USDC balance on that chain
  async function _setBridgeChain(chainId) {
    if (!_state) return;
    _state.bridgeFromChain = chainId;
    _state.bridgeSourceBalance = null;
    var overlay = document.getElementById('hfxDepositOverlay');
    if (overlay) overlay.innerHTML = _frame(_state);

    // Fetch balance on the source chain
    try {
      var cfg = BRIDGE_CHAINS[chainId];
      if (!cfg || !_state.eoa) return;
      var provider = new window.ethers.JsonRpcProvider(cfg.rpc);
      var contract = new window.ethers.Contract(cfg.usdc, ['function balanceOf(address) view returns (uint256)'], provider);
      var raw = await contract.balanceOf(_state.eoa);
      var bal = parseFloat(window.ethers.formatUnits(raw, 6));
      _state.bridgeSourceBalance = bal;
      // Re-render to show the balance
      var overlay2 = document.getElementById('hfxDepositOverlay');
      if (overlay2) overlay2.innerHTML = _frame(_state);
    } catch (e) {
      console.warn('[bridge] source balance fetch failed:', e.message);
      _state.bridgeSourceBalance = 0;
      var overlay3 = document.getElementById('hfxDepositOverlay');
      if (overlay3) overlay3.innerHTML = _frame(_state);
    }
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

  // Fetch a quote from LI.FI (via our server proxy)
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
    var cfg = BRIDGE_CHAINS[chainId];
    if (!cfg) return;

    // Check balance
    if (_state.bridgeSourceBalance != null && _state.bridgeSourceBalance < amount) {
      alert('Not enough USDC on ' + cfg.name + '. You have $' + _state.bridgeSourceBalance.toFixed(2) + ' but tried to bridge $' + amount.toFixed(2));
      return;
    }

    _state.bridgeStep = 'quote';
    _state.bridgeQuote = null;
    var overlay = document.getElementById('hfxDepositOverlay');
    if (overlay) overlay.innerHTML = _frame(_state);

    try {
      // LI.FI expects fromAmount in token base units (6 decimals for USDC)
      var fromAmount = Math.floor(amount * 1e6).toString();
      var params = new URLSearchParams({
        fromChain: String(chainId),
        fromToken: cfg.usdc,
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
      }
    } catch (e) {
      _state.bridgeQuote = { error: e.message || 'Network error' };
    }
    var overlay2 = document.getElementById('hfxDepositOverlay');
    if (overlay2) overlay2.innerHTML = _frame(_state);
  }

  // Execute the bridge transaction (user signs on source chain)
  async function _executeBridge() {
    if (!_state || !_state.bridgeQuote || !_state.bridgeQuote.transactionRequest) {
      alert('No quote available — please refresh and try again.');
      return;
    }
    var chainId = _state.bridgeFromChain;
    var cfg = BRIDGE_CHAINS[chainId];
    var txReq = _state.bridgeQuote.transactionRequest;

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
              1: { chainId: '0x1', chainName: 'Ethereum', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: [cfg.rpc], blockExplorerUrls: ['https://etherscan.io'] },
              42161: { chainId: '0xa4b1', chainName: 'Arbitrum One', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: [cfg.rpc], blockExplorerUrls: ['https://arbiscan.io'] },
              8453: { chainId: '0x2105', chainName: 'Base', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: [cfg.rpc], blockExplorerUrls: ['https://basescan.org'] },
              10: { chainId: '0xa', chainName: 'Optimism', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: [cfg.rpc], blockExplorerUrls: ['https://optimistic.etherscan.io'] },
              56: { chainId: '0x38', chainName: 'BNB Smart Chain', nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 }, rpcUrls: [cfg.rpc], blockExplorerUrls: ['https://bscscan.com'] }
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

      _state.bridgePollMessage = 'Sign in MetaMask…';
      _state.bridgeSubMessage = 'Your wallet will ask to approve the bridge transaction';
      var overlay2 = document.getElementById('hfxDepositOverlay');
      if (overlay2) overlay2.innerHTML = _frame(_state);

      // Submit the tx as returned by LI.FI
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

  // Switch tabs without re-fetching balances
  function _setTab(tab) {
    if (!_state) return;
    _state.currentTab = tab;
    var overlay = document.getElementById('hfxDepositOverlay');
    if (overlay) overlay.innerHTML = _frame(_state);
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
    _executeBridge: _executeBridge
  };
})();
