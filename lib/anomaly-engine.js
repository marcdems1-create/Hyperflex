'use strict';

/**
 * HYPERFLEX Anomaly Detection Engine
 * Phase 2 Intelligence MVP
 *
 * Detects statistical anomalies across prediction markets:
 * - Volume Z-scores (unusual volume vs. historical baseline)
 * - Price velocity alerts (rapid price movements)
 * - Cross-market correlation breaks (matched markets diverging)
 * - Whale cluster formation (multiple whales entering same market)
 */

// ── MODULE STATE ─────────────────────────────────────────────────────────
let _pool = null;
let _getScreenerCache = null;   // function that returns current screener cache
let _getDataEngine = null;      // function that returns data engine instance

// Active anomalies (in-memory, refreshed on each scan)
let _anomalyCache = { ts: 0, anomalies: [] };
const ANOMALY_TTL = 60 * 1000; // 60 seconds
const ANOMALY_MAX_AGE = 4 * 60 * 60 * 1000; // 4 hours — drop old anomalies

// Historical baselines for Z-score computation
let _volumeBaselines = new Map(); // slug -> { mean, stddev, samples }
const BASELINE_TTL = 30 * 60 * 1000; // recompute baselines every 30 min
let _baselineTs = 0;

// Anomaly history (track when anomalies first appeared)
const _anomalyFirstSeen = new Map(); // key -> timestamp

// ── INIT ─────────────────────────────────────────────────────────────────

function init(opts) {
  _pool = opts.pool || null;
  _getScreenerCache = opts.getScreenerCache || (() => null);
  _getDataEngine = opts.getDataEngine || (() => null);
}

// ── ANOMALY TYPES ────────────────────────────────────────────────────────

/**
 * @typedef {Object} Anomaly
 * @property {string} id          - Unique key (type:slug)
 * @property {string} type        - volume_spike | price_velocity | correlation_break | whale_cluster
 * @property {string} severity    - critical | high | medium | low
 * @property {string} title       - Market question
 * @property {string} slug        - Market slug or identifier
 * @property {string} description - Human-readable explanation
 * @property {number} score       - Anomaly magnitude (higher = more unusual)
 * @property {Object} data        - Type-specific data
 * @property {string} detected_at - ISO timestamp
 * @property {string} first_seen  - ISO timestamp of first detection
 */

// ── SEVERITY THRESHOLDS ──────────────────────────────────────────────────

const VOLUME_Z_CRITICAL = 4.0;
const VOLUME_Z_HIGH = 3.0;
const VOLUME_Z_MEDIUM = 2.0;

const PRICE_VELOCITY_CRITICAL = 15;  // 15%+ move
const PRICE_VELOCITY_HIGH = 10;      // 10%+ move
const PRICE_VELOCITY_MEDIUM = 7;     // 7%+ move

const CORRELATION_BREAK_THRESHOLD = 0.08; // 8%+ divergence between matched markets

// ── MAIN SCAN ────────────────────────────────────────────────────────────

async function scan() {
  if (Date.now() - _anomalyCache.ts < ANOMALY_TTL) {
    return _anomalyCache.anomalies;
  }

  const anomalies = [];
  const now = Date.now();

  try {
    // 1. Volume anomalies from screener cache
    const screener = _getScreenerCache();
    if (screener && Array.isArray(screener.data)) {
      const volumeAnomalies = detectVolumeAnomalies(screener.data);
      anomalies.push(...volumeAnomalies);

      // 2. Price velocity from screener
      const priceAnomalies = detectPriceVelocity(screener.data);
      anomalies.push(...priceAnomalies);

      // 3. Whale cluster detection from screener
      const whaleAnomalies = detectWhaleClusters(screener.data);
      anomalies.push(...whaleAnomalies);
    }

    // 4. Cross-market correlation breaks from data engine
    const dataEngine = _getDataEngine();
    if (dataEngine) {
      const corrAnomalies = await detectCorrelationBreaks(dataEngine);
      anomalies.push(...corrAnomalies);
    }

    // Track first-seen timestamps
    for (const a of anomalies) {
      if (!_anomalyFirstSeen.has(a.id)) {
        _anomalyFirstSeen.set(a.id, now);
      }
      a.first_seen = new Date(_anomalyFirstSeen.get(a.id)).toISOString();
    }

    // Prune old first-seen entries
    for (const [key, ts] of _anomalyFirstSeen) {
      if (now - ts > ANOMALY_MAX_AGE) _anomalyFirstSeen.delete(key);
    }

    // Sort by severity then score
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    anomalies.sort((a, b) => {
      const sd = (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3);
      return sd !== 0 ? sd : b.score - a.score;
    });

    _anomalyCache = { ts: now, anomalies };
  } catch (err) {
    console.error('[anomaly-engine] Scan error:', err.message);
    // Return stale cache on error
  }

  return _anomalyCache.anomalies;
}

// ── VOLUME ANOMALIES ─────────────────────────────────────────────────────

function detectVolumeAnomalies(markets) {
  const anomalies = [];

  for (const m of markets) {
    const vol24h = parseFloat(m.volume24hr || m.volume_24h || 0);
    if (vol24h < 10000) continue; // Skip low-volume noise

    // Use volume_spike_ratio from screener if available (current 24h / 7d avg)
    const spikeRatio = m.volume_spike_ratio || null;
    const volumeSpike = (m.edge_components && m.edge_components.volume_spike) || 0;

    if (spikeRatio && spikeRatio >= 2.0) {
      // Z-score approximation: (ratio - 1) as rough Z since baseline is 1x
      const zScore = spikeRatio - 1;
      let severity = 'low';
      if (zScore >= VOLUME_Z_CRITICAL) severity = 'critical';
      else if (zScore >= VOLUME_Z_HIGH) severity = 'high';
      else if (zScore >= VOLUME_Z_MEDIUM) severity = 'medium';

      if (severity !== 'low') {
        anomalies.push({
          id: 'volume_spike:' + (m.slug || m.question),
          type: 'volume_spike',
          severity,
          title: m.question,
          slug: m.slug,
          description: spikeRatio.toFixed(1) + 'x normal volume (' + formatVol(vol24h) + ' 24h)',
          score: Math.round(zScore * 10),
          data: {
            volume_24h: vol24h,
            spike_ratio: spikeRatio,
            z_score: Math.round(zScore * 100) / 100,
            yes_price: m.yes_price
          },
          detected_at: new Date().toISOString()
        });
      }
    } else if (volumeSpike >= 5) {
      // Fallback: use edge component score
      anomalies.push({
        id: 'volume_spike:' + (m.slug || m.question),
        type: 'volume_spike',
        severity: volumeSpike >= 10 ? 'high' : 'medium',
        title: m.question,
        slug: m.slug,
        description: 'Unusual volume activity (' + formatVol(vol24h) + ' 24h)',
        score: volumeSpike,
        data: {
          volume_24h: vol24h,
          edge_volume_spike: volumeSpike,
          yes_price: m.yes_price
        },
        detected_at: new Date().toISOString()
      });
    }
  }

  return anomalies;
}

// ── PRICE VELOCITY ───────────────────────────────────────────────────────

function detectPriceVelocity(markets) {
  const anomalies = [];

  for (const m of markets) {
    const priceChange = m.price_change_24h;
    if (priceChange == null) continue;

    const absPriceChange = Math.abs(priceChange);
    if (absPriceChange < PRICE_VELOCITY_MEDIUM) continue;

    let severity = 'medium';
    if (absPriceChange >= PRICE_VELOCITY_CRITICAL) severity = 'critical';
    else if (absPriceChange >= PRICE_VELOCITY_HIGH) severity = 'high';

    const direction = priceChange > 0 ? 'up' : 'down';

    anomalies.push({
      id: 'price_velocity:' + (m.slug || m.question),
      type: 'price_velocity',
      severity,
      title: m.question,
      slug: m.slug,
      description: (priceChange > 0 ? '+' : '') + priceChange.toFixed(1) + '% in 24h — rapid ' + direction + ' move',
      score: Math.round(absPriceChange),
      data: {
        price_change_24h: priceChange,
        direction,
        yes_price: m.yes_price,
        volume_24h: parseFloat(m.volume24hr || m.volume_24h || 0)
      },
      detected_at: new Date().toISOString()
    });
  }

  return anomalies;
}

// ── WHALE CLUSTERS ───────────────────────────────────────────────────────

function detectWhaleClusters(markets) {
  const anomalies = [];

  for (const m of markets) {
    const whaleCount = m.whale_count || 0;
    const totalWhaleCapital = m.total_whale_capital || 0;
    const whaleVelocity = m.whale_velocity_event || null;

    // 3+ whales = cluster
    if (whaleCount >= 3) {
      let severity = 'medium';
      if (whaleCount >= 5 && totalWhaleCapital >= 1000000) severity = 'critical';
      else if (whaleCount >= 4 || totalWhaleCapital >= 500000) severity = 'high';

      const consensusSide = m.whale_consensus_side || null;

      anomalies.push({
        id: 'whale_cluster:' + (m.slug || m.question),
        type: 'whale_cluster',
        severity,
        title: m.question,
        slug: m.slug,
        description: whaleCount + ' whales, ' + formatVol(totalWhaleCapital) + ' capital' +
          (consensusSide ? ' — consensus ' + consensusSide.toUpperCase() : '') +
          (whaleVelocity ? ' — whale just moved' : ''),
        score: whaleCount * 10 + Math.min(Math.floor(totalWhaleCapital / 100000), 20),
        data: {
          whale_count: whaleCount,
          total_capital: totalWhaleCapital,
          consensus_side: consensusSide,
          has_velocity_event: !!whaleVelocity,
          yes_price: m.yes_price
        },
        detected_at: new Date().toISOString()
      });
    }
  }

  return anomalies;
}

// ── CORRELATION BREAKS ───────────────────────────────────────────────────

async function detectCorrelationBreaks(dataEngine) {
  const anomalies = [];

  try {
    const result = await dataEngine.getCrossRefs({ min_spread: CORRELATION_BREAK_THRESHOLD, limit: 20 });
    const opps = result.opportunities || [];

    for (const ref of opps) {
      const spread = ref.spread || 0;
      let severity = 'medium';
      if (spread >= 0.15) severity = 'critical';
      else if (spread >= 0.10) severity = 'high';

      anomalies.push({
        id: 'correlation_break:' + ref.hfx_id_a + ':' + ref.hfx_id_b,
        type: 'correlation_break',
        severity,
        title: ref.title_a || 'Cross-market divergence',
        slug: ref.hfx_id_a,
        description: (ref.source_a || 'Platform A') + ' vs ' + (ref.source_b || 'Platform B') + ' — ' +
          ref.spread_pct + '% price divergence (arb ROI ' + ref.arb_roi + '%)',
        score: ref.spread_pct,
        data: {
          source_a: ref.source_a,
          source_b: ref.source_b,
          price_a: ref.price_a,
          price_b: ref.price_b,
          spread: ref.spread,
          spread_pct: ref.spread_pct,
          arb_roi: ref.arb_roi,
          confidence: ref.confidence,
          buy_on: ref.buy_on,
          sell_on: ref.sell_on
        },
        detected_at: new Date().toISOString()
      });
    }
  } catch (err) {
    console.warn('[anomaly-engine] Correlation break detection failed:', err.message);
  }

  return anomalies;
}

// ── PUBLIC API ────────────────────────────────────────────────────────────

async function getAnomalies(opts = {}) {
  const anomalies = await scan();

  let filtered = anomalies;

  // Filter by type
  if (opts.type) {
    filtered = filtered.filter(a => a.type === opts.type);
  }

  // Filter by severity
  if (opts.severity) {
    const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const minSev = sevOrder[opts.severity] || 3;
    filtered = filtered.filter(a => (sevOrder[a.severity] || 3) <= minSev);
  }

  const limit = Math.min(parseInt(opts.limit) || 50, 100);

  return {
    anomalies: filtered.slice(0, limit),
    total: filtered.length,
    by_type: {
      volume_spike: anomalies.filter(a => a.type === 'volume_spike').length,
      price_velocity: anomalies.filter(a => a.type === 'price_velocity').length,
      whale_cluster: anomalies.filter(a => a.type === 'whale_cluster').length,
      correlation_break: anomalies.filter(a => a.type === 'correlation_break').length
    },
    by_severity: {
      critical: anomalies.filter(a => a.severity === 'critical').length,
      high: anomalies.filter(a => a.severity === 'high').length,
      medium: anomalies.filter(a => a.severity === 'medium').length
    },
    updated_at: new Date(_anomalyCache.ts).toISOString()
  };
}

function getStats() {
  return {
    total: _anomalyCache.anomalies.length,
    cache_age_ms: Date.now() - _anomalyCache.ts,
    tracking: _anomalyFirstSeen.size
  };
}

// ── HELPERS ──────────────────────────────────────────────────────────────

function formatVol(n) {
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + Math.round(n);
}

// ── EXPORTS ──────────────────────────────────────────────────────────────

module.exports = { init, scan, getAnomalies, getStats };
