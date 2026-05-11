// lib/polymarket-proxy.js
//
// Single canonical Polymarket Safe-proxy derivation helper. Replaces six
// independent inline eth_call patterns scattered across server.js that all
// hardcoded selector 0x4d0c6cdb — a fictional selector that doesn't match
// any function on the live Safe factory. Every server-side proxy
// derivation has been reverting since the factory was first integrated;
// the client path at creator-dashboard.html:16527 works because it uses
// ethers' Contract ABI encoding to derive the selector at runtime.
//
// What was wrong:
//   The hardcoded value 0x4d0c6cdb had three different comments in
//   server.js claiming it was three different functions:
//     server.js:21454  // "computeProxyAddress(address)"
//     server.js:28823  // "proxyFor(eoa)"
//     server.js:37193  // "proxies(address)"
//   Computed selectors for the actual function names:
//     0xc4552791  proxies(address)
//     0xd600539a  computeProxyAddress(address)  ← the real one
//     0x1a65b51a  proxyFor(address)
//   None of those is 0x4d0c6cdb. It was invented / mis-typed once and
//   then propagated by copy-paste across six call sites over months.
//
// How this can't happen again:
//   1. ABI string drives the selector at runtime via ethers — function-
//      name typos break loudly with a clear "function not found" rather
//      than a silent contract revert.
//   2. Single canonical helper — callers can't drift independently.
//   3. Boot log emits the resolved selector so a future schema/contract
//      change surfaces immediately in container logs.
//   4. /api/_smoke/polymarket-proxy endpoint lets us verify the live
//      integration with one curl, with no DB writes or wallet juggling.
//   5. CI guard (.github/workflows/no-stale-proxy-selectors.yml) fails
//      the build if 0x4d0c6cdb ever reappears anywhere in the repo.

'use strict';

const ethers = require('ethers');

// Polymarket Gnosis Safe factory on Polygon mainnet. Same address used
// by client market.html and creator-dashboard.html paths.
const SAFE_FACTORY = '0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b';

// ABI string — selector derives from this signature at runtime via
// ethers. NEVER replace this with a hardcoded constant; the whole point
// of this module is to eliminate that failure mode.
const ABI = ['function computeProxyAddress(address user) view returns (address)'];

const FACTORY_IFACE = new ethers.Interface(ABI);
const SELECTOR = FACTORY_IFACE.getFunction('computeProxyAddress').selector; // '0xd600539a'

function _hostOf(rpcUrl) {
  try { return new URL(rpcUrl).host; } catch (_) { return String(rpcUrl).slice(0, 32); }
}

// Derive the Polymarket Safe proxy for `eoaAddress`. Tries each RPC in
// `rpcs` in order; returns the proxy on first success, or null after all
// RPCs fail. Caller is responsible for caching — this helper does the
// raw on-chain call.
async function derivePolymarketProxy(eoaAddress, rpcs) {
  if (!eoaAddress || !ethers.isAddress(eoaAddress)) return null;
  if (!Array.isArray(rpcs) || !rpcs.length) {
    throw new Error('lib/polymarket-proxy.derivePolymarketProxy: rpcs[] required');
  }
  const eoa = ethers.getAddress(eoaAddress); // checksummed
  const failures = [];
  for (const rpcUrl of rpcs) {
    try {
      // staticNetwork=true skips an eth_chainId probe per call — Polygon
      // chainId is fixed, no need to re-query every RPC swap.
      const provider = new ethers.JsonRpcProvider(rpcUrl, 137, { staticNetwork: true });
      const factory = new ethers.Contract(SAFE_FACTORY, ABI, provider);
      const proxy = await factory.computeProxyAddress(eoa);
      if (!proxy || proxy === ethers.ZeroAddress) {
        failures.push(`${_hostOf(rpcUrl)} → zero address`);
        continue;
      }
      return proxy.toLowerCase();
    } catch (e) {
      failures.push(`${_hostOf(rpcUrl)} → ${e.shortMessage || e.code || e.message || 'unknown'}`);
    }
  }
  console.warn('[derivePolymarketProxy] all rpcs failed for ' + eoa.slice(0, 10) + ' — ' + failures.join(' | '));
  return null;
}

module.exports = {
  derivePolymarketProxy,
  SAFE_FACTORY,
  SELECTOR,
  ABI,
};
