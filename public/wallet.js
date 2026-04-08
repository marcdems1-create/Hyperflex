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
    adoptSigner: adoptSigner,
    invalidate: invalidate,
    is32002Error: is32002Error,
  };
})(window);
