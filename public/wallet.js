/**
 * HFXWallet — shared ethers v6 wallet helpers
 *
 * Single cached BrowserProvider + signer per page lifetime. Both market.html
 * and creator-dashboard.html use this so we never construct two BrowserProviders
 * in the same flow — each construction fires `eth_requestAccounts` via ethers'
 * internal _start(), and on mobile MetaMask overlapping requests return
 * EIP-1193 -32002 "request already pending".
 *
 * Concurrent dedup: a single in-flight Promise is shared across all callers
 * during the cold-path construction, so if auto-reconnect and a manual Connect
 * tap fire within the same tick they both await the same construction.
 *
 * Cache invariants:
 *   - Cleared on `accountsChanged`, on `chainChanged`, on -32002, and on
 *     explicit invalidate().
 *   - `getSigner()` is the only function that constructs a BrowserProvider.
 *   - `adoptSigner(p, s, a)` lets a flow that ALREADY has a provider/signer
 *     (e.g. enableTrading after wallet_switchEthereumChain) populate the
 *     cache without going through getSigner() again.
 *   - `getSignerFresh()` forces MetaMask's account picker via
 *     wallet_requestPermissions — use this when the user wants to switch
 *     accounts. Mobile MetaMask ignores eth_requestAccounts after
 *     disconnect/reconnect, so wallet_requestPermissions is the only way
 *     to force a fresh prompt.
 *   - `revokePermissions()` tells MetaMask to fully drop its connection
 *     to our site (EIP-2255 wallet_revokePermissions) so the next connect
 *     goes through the full permission flow.
 */
(function(global) {
  var _cachedSigner = null;
  var _cachedAddress = null;
  var _signerPromise = null;

  async function getSigner() {
    if (_cachedSigner && _cachedAddress) {
      return { provider: _cachedSigner.provider, signer: _cachedSigner, address: _cachedAddress };
    }
    if (!_signerPromise) {
      _signerPromise = (async function() {
        if (!global.ethereum) throw new Error('MetaMask required');
        if (!global.ethers) throw new Error('ethers.js not loaded');
        var provider = new global.ethers.BrowserProvider(global.ethereum);
        var signer = await provider.getSigner();
        var address = await signer.getAddress();
        _cachedSigner = signer;
        _cachedAddress = address;
        return { provider: provider, signer: signer, address: address };
      })();
    }
    try {
      return await _signerPromise;
    } finally {
      _signerPromise = null;
    }
  }

  // Force MetaMask to show the account picker, even on mobile where
  // eth_requestAccounts silently returns the last-connected account.
  //
  // Uses EIP-2255 wallet_requestPermissions which MetaMask always
  // responds to with a permission prompt (account selection UI).
  async function getSignerFresh() {
    if (!global.ethereum) throw new Error('MetaMask required');
    if (!global.ethers) throw new Error('ethers.js not loaded');

    // Drop any cached state first — we want a completely fresh pick
    invalidate();

    try {
      // EIP-2255: always prompts for account selection on both mobile
      // and desktop MetaMask. Returns the list of permitted accounts.
      await global.ethereum.request({
        method: 'wallet_requestPermissions',
        params: [{ eth_accounts: {} }]
      });
    } catch (permErr) {
      // Some wallets (older MetaMask, some mobile wallets) don't support
      // wallet_requestPermissions. Fall back to eth_requestAccounts and
      // hope the user switched their active account in MetaMask first.
      if (permErr && permErr.code === 4001) {
        throw permErr; // user rejected — bubble up so caller knows
      }
      console.warn('[HFXWallet] wallet_requestPermissions unsupported, falling back:', permErr && permErr.message);
      try {
        await global.ethereum.request({ method: 'eth_requestAccounts' });
      } catch (reqErr) {
        throw reqErr;
      }
    }

    // Now build the provider/signer on the freshly-picked account
    var provider = new global.ethers.BrowserProvider(global.ethereum);
    var signer = await provider.getSigner();
    var address = await signer.getAddress();
    _cachedSigner = signer;
    _cachedAddress = address;
    return { provider: provider, signer: signer, address: address };
  }

  // Tell MetaMask to fully drop its connection to our site (EIP-2255).
  // After this, the next getSigner() / getSignerFresh() call will trigger
  // a full permission flow. Silently no-ops on wallets that don't support
  // wallet_revokePermissions (older MetaMask, Coinbase Wallet, etc.).
  async function revokePermissions() {
    invalidate();
    if (!global.ethereum) return;
    try {
      await global.ethereum.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }]
      });
    } catch (e) {
      // Older MetaMask versions return "method not supported". Silent fallback.
      if (e && e.code !== 4200 && e.code !== -32601) {
        console.warn('[HFXWallet] revokePermissions:', e && e.message);
      }
    }
  }

  function adoptSigner(provider, signer, address) {
    _cachedSigner = signer;
    _cachedAddress = address;
    _signerPromise = null;
  }

  function invalidate() {
    _cachedSigner = null;
    _cachedAddress = null;
    _signerPromise = null;
  }

  // EIP-1193 -32002 "Request already pending" — ethers v6 wraps raw errors
  // inconsistently via `info.error` / `error`, so check every level.
  function is32002Error(err) {
    if (!err) return false;
    if (err.code === -32002) return true;
    if (err.error && err.error.code === -32002) return true;
    if (err.info && err.info.error && err.info.error.code === -32002) return true;
    if (err.message && String(err.message).indexOf('-32002') !== -1) return true;
    return false;
  }

  // Wire up the only events that should drop the cache. Both files used to
  // do this independently; now it's centralized so neither can forget.
  if (global.ethereum && typeof global.ethereum.on === 'function') {
    global.ethereum.on('accountsChanged', function() { invalidate(); });
    global.ethereum.on('chainChanged', function() { invalidate(); });
  }

  global.HFXWallet = {
    getSigner: getSigner,
    getSignerFresh: getSignerFresh,
    revokePermissions: revokePermissions,
    adoptSigner: adoptSigner,
    invalidate: invalidate,
    is32002Error: is32002Error,
  };
})(window);
