require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const cron = require('node-cron');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(require("express").static("public"));

// Tenant: subdomain from host (e.g. acme.hyperflex.io → req.tenant.subdomain = 'acme')
app.use((req, res, next) => {
  const host = req.headers.host || '';
  const parts = host.split('.');
  let subdomain = null;
  if (parts.length >= 3) {
    subdomain = parts[0].toLowerCase();
    if (subdomain === 'www' || subdomain === 'hyperflex') subdomain = null;
  }
  req.tenant = { subdomain };
  next();
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ── AUTH ──────────────────────────────────────────

// Register
app.post('/register', async (req, res) => {
  const { email, password, display_name } = req.body;
  const password_hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from('users')
    .insert([{ email, password_hash, display_name }])
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Account created', user: data });
});

// Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();
  if (error || !user) return res.status(400).json({ error: 'User not found' });
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(400).json({ error: 'Invalid password' });
  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'hyperflex_secret');
  res.json({ token, user: { id: user.id, email: user.email, display_name: user.display_name, balance: user.balance } });
});

// Auth middleware for protected routes
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Auth required' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'hyperflex_secret');
    req.userId = payload.id;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ── MARKETS ───────────────────────────────────────

// Get all open markets
app.get('/markets', async (req, res) => {
  const { data, error } = await supabase
    .from('markets')
    .select('*')
    .eq('resolved', false)
    .order('expiry_date', { ascending: true });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Get single market
app.get('/markets/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('markets')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Create market (admin)
app.post('/markets', async (req, res) => {
  const {
    question, expiry_date,
    commodity, target_price, direction,
    category, creator_id, tenant_slug, is_public, resolution_source
  } = req.body;

  const row = {
    question,
    expiry_date,
    commodity:    commodity    || category || '',
    target_price: target_price ?? 0,
    direction:    direction    || 'above',
    yes_price:    0.5,
    no_price:     0.5,
    resolved:     false,
  };
  if (category          !== undefined) row.category          = category;
  if (creator_id        !== undefined) row.creator_id        = creator_id;
  if (tenant_slug       !== undefined) row.tenant_slug       = tenant_slug;
  if (is_public         !== undefined) row.is_public         = is_public;
  if (resolution_source !== undefined) row.resolution_source = resolution_source;

  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET || 'hyperflex_secret');
      // Try creator_id first (new schema), fall back to user_id (old schema)
      let { data: settings } = await supabase
        .from('creator_settings')
        .select('slug')
        .eq('creator_id', payload.id)
        .maybeSingle();
      if (!settings) {
        ({ data: settings } = await supabase
          .from('creator_settings')
          .select('slug')
          .eq('user_id', payload.id)
          .maybeSingle());
      }
      if (settings?.slug) {
        // Populate tenant_slug if the caller didn't provide it
        if (!row.tenant_slug) row.tenant_slug = settings.slug;
      }
    } catch (e) {
      // ignore invalid token
    }
  }

  // Prohibited keyword check
  const prohibited = PROHIBITED_PATTERNS.find(p => p.re.test(row.question || ''));
  if (prohibited) return res.status(400).json({ error: prohibited.msg });

  // Store resolution_sources array if provided
  const { resolution_sources } = req.body;
  if (Array.isArray(resolution_sources) && resolution_sources.length >= 3) {
    row.resolution_sources = JSON.stringify(resolution_sources);
  }

  const { data, error } = await supabase
    .from('markets')
    .insert([row])
    .select()
    .single();
  if (error) {
    console.error('POST /markets insert error:', JSON.stringify({ message: error.message, code: error.code, details: error.details, hint: error.hint, row }));
    return res.status(400).json({ error: error.message, details: error.details, hint: error.hint });
  }
  res.json(data);
});

// ── TRADING ───────────────────────────────────────

// Place a trade
app.post('/trade', async (req, res) => {
  const { user_id, market_id, side, amount } = req.body;

  // Get user balance
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('balance')
    .eq('id', user_id)
    .single();
  if (userError || !user) return res.status(400).json({ error: 'User not found' });
  if (user.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });

  // Get market
  const { data: market, error: marketError } = await supabase
    .from('markets')
    .select('*')
    .eq('id', market_id)
    .single();
  if (marketError || !market) return res.status(400).json({ error: 'Market not found' });
  if (market.resolved) return res.status(400).json({ error: 'Market already resolved' });

  const price = side === 'YES' ? market.yes_price : market.no_price;
  const potential_payout = amount / price;

  // Check if this user has traded on this market before (determines trader_count increment)
  const { count: priorPositions } = await supabase
    .from('positions')
    .select('id', { count: 'exact', head: true })
    .eq('market_id', market_id)
    .eq('user_id', user_id);
  const isNewTrader = (priorPositions || 0) === 0;

  // Deduct balance
  await supabase
    .from('users')
    .update({ balance: user.balance - amount })
    .eq('id', user_id);

  // Record position
  const { data: position, error: posError } = await supabase
    .from('positions')
    .insert([{ user_id, market_id, side, amount, potential_payout }])
    .select()
    .single();
  if (posError) return res.status(400).json({ error: posError.message });

  // Update volume; only increment trader_count if this user hadn't traded here before
  const marketUpdate = { volume: (market.volume || 0) + amount };
  if (isNewTrader) marketUpdate.trader_count = (market.trader_count || 0) + 1;
  const { error: mktErr } = await supabase.from('markets').update(marketUpdate).eq('id', market_id);
  if (mktErr) console.error('market volume update error:', mktErr.message, mktErr.details);

  res.json({ message: 'Trade placed', position });
});

// Get user positions
app.get('/positions/:user_id', async (req, res) => {
  const { data, error } = await supabase
    .from('positions')
    .select('*, markets(*)')
    .eq('user_id', req.params.user_id);
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Leaderboard: top 20 by PnL (join users + positions, settled only). If tenant subdomain, filter to that creator's markets.
app.get('/api/leaderboard', async (req, res) => {
  try {
    let positions;
    const subdomain = req.tenant?.subdomain;

    if (subdomain) {
      const { data: tenantMarkets } = await supabase
        .from('markets')
        .select('id')
        .eq('creator_slug', subdomain);
      const marketIds = (tenantMarkets || []).map((m) => m.id);
      if (marketIds.length === 0) return res.json([]);
      const { data: pos } = await supabase
        .from('positions')
        .select('user_id, amount, potential_payout, settled, won')
        .eq('settled', true)
        .in('market_id', marketIds);
      positions = pos;
    } else {
      const { data: pos } = await supabase
        .from('positions')
        .select('user_id, amount, potential_payout, settled, won')
        .eq('settled', true);
      positions = pos;
    }

    if (!positions || positions.length === 0) {
      return res.json([]);
    }

    const userIds = [...new Set(positions.map((p) => p.user_id))];
    const { data: users } = await supabase
      .from('users')
      .select('id, display_name, email')
      .in('id', userIds);

    const userMap = new Map((users || []).map((u) => [u.id, u]));
    const agg = new Map();

    for (const p of positions) {
      if (!agg.has(p.user_id)) {
        agg.set(p.user_id, { total_pnl: 0, wins: 0, total_trades: 0 });
      }
      const a = agg.get(p.user_id);
      a.total_trades += 1;
      if (p.won) {
        a.wins += 1;
        a.total_pnl += Number(p.potential_payout) || 0;
      }
      a.total_pnl -= Number(p.amount) || 0;
    }

    const rows = [];
    for (const [userId, a] of agg) {
      const u = userMap.get(userId);
      rows.push({
        user_id: userId,
        username: (u?.display_name || u?.email || 'Unknown').trim() || 'Unknown',
        total_pnl: Math.round(a.total_pnl * 100) / 100,
        win_rate: a.total_trades > 0 ? Math.round((a.wins / a.total_trades) * 100) : 0,
        total_trades: a.total_trades,
      });
    }

    rows.sort((a, b) => b.total_pnl - a.total_pnl);
    const top20 = rows.slice(0, 20).map((r, i) => ({
      rank: i + 1,
      user_id: r.user_id,
      username: r.username,
      total_pnl: r.total_pnl,
      win_rate: r.win_rate,
      total_trades: r.total_trades,
    }));

    res.json(top20);
  } catch (err) {
    console.error('leaderboard error:', err.message);
    res.status(500).json({ error: 'Leaderboard failed' });
  }
});

// ── PRICES (60s cache, backend-only; frontend uses GET /api/prices) ─────────
let pricesCache = { data: null, ts: 0 };
const PRICES_CACHE_MS = 60 * 1000;

app.get('/api/prices', async (req, res) => {
  const now = Date.now();
  if (pricesCache.data && now - pricesCache.ts < PRICES_CACHE_MS) {
    return res.json(pricesCache.data);
  }
  try {
    const cgRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd').then((r) => (r.ok ? r.json() : null));
    const btc = cgRes?.bitcoin?.usd;
    const eth = cgRes?.ethereum?.usd;
    const [gold, silver, oil] = await Promise.all([
      fetchCurrentPrice('gold'),
      fetchCurrentPrice('silver'),
      fetchCurrentPrice('oil'),
    ]);
    const data = {
      BTC: typeof btc === 'number' && btc > 0 ? btc : null,
      ETH: typeof eth === 'number' && eth > 0 ? eth : null,
      XAU: gold,
      XAG: silver,
      WTI: oil,
    };
    pricesCache = { data, ts: now };
    res.json(data);
  } catch (err) {
    console.warn('GET /api/prices error:', err.message);
    res.json(pricesCache.data || { BTC: null, ETH: null, XAU: null, XAG: null, WTI: null });
  }
});

// ── SETTLEMENT ────────────────────────────────────

/**
 * Fetch current price for a commodity. Returns null if fetch fails.
 * - Crypto (bitcoin, ethereum): CoinGecko
 * - Commodities (gold, silver): metals.live spot
 * - Oil (WTI): Yahoo Finance CL=F
 */
async function fetchCurrentPrice(commodity) {
  if (!commodity || typeof commodity !== 'string') return null;
  const c = commodity.toLowerCase().trim();

  try {
    // Crypto via CoinGecko
    if (c === 'bitcoin' || c === 'btc' || c === 'crypto') {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
      if (!res.ok) return null;
      const data = await res.json();
      const price = data?.bitcoin?.usd;
      return typeof price === 'number' && price > 0 ? price : null;
    }
    if (c === 'ethereum' || c === 'eth') {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      if (!res.ok) return null;
      const data = await res.json();
      const price = data?.ethereum?.usd;
      return typeof price === 'number' && price > 0 ? price : null;
    }

    // Precious metals via metals.live
    if (c === 'gold' || c === 'xau') {
      const res = await fetch('https://api.metals.live/v1/spot/gold');
      if (!res.ok) return null;
      const data = await res.json();
      const price = Array.isArray(data)?.[0]?.price ?? data?.price;
      return typeof price === 'number' && price > 0 ? price : null;
    }
    if (c === 'silver' || c === 'xag') {
      const res = await fetch('https://api.metals.live/v1/spot/silver');
      if (!res.ok) return null;
      const data = await res.json();
      const price = Array.isArray(data)?.[0]?.price ?? data?.price;
      return typeof price === 'number' && price > 0 ? price : null;
    }

    // WTI crude via Yahoo Finance chart
    if (c === 'oil' || c === 'wti' || c === 'crude') {
      const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/CL=F');
      if (!res.ok) return null;
      const data = await res.json();
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      return typeof price === 'number' && price > 0 ? price : null;
    }

    return null;
  } catch (err) {
    console.warn('fetchCurrentPrice failed for', commodity, err.message);
    return null;
  }
}

async function settleMarkets() {
  console.log('Running settlement check...');
  const now = new Date().toISOString();

  const { data: markets } = await supabase
    .from('markets')
    .select('*')
    .eq('resolved', false)
    .lt('expiry_date', now);

  if (!markets || markets.length === 0) return;

  for (const market of markets) {
    const settlement_price = await fetchCurrentPrice(market.commodity);
    if (settlement_price == null) {
      console.log(`Skipping settlement for market ${market.id} (${market.question}): no price for commodity "${market.commodity}"`);
      continue;
    }

    const outcome = market.direction === 'above'
      ? settlement_price >= market.target_price
      : settlement_price <= market.target_price;

    // Resolve market
    await supabase
      .from('markets')
      .update({ resolved: true, settlement_price, outcome })
      .eq('id', market.id);

    // Settle positions
    const { data: positions } = await supabase
      .from('positions')
      .select('*')
      .eq('market_id', market.id)
      .eq('settled', false);

    for (const position of positions) {
      const won = (position.side === 'YES') === outcome;
      await supabase
        .from('positions')
        .update({ settled: true, won })
        .eq('id', position.id);

      if (won) {
        const { data: user } = await supabase
          .from('users')
          .select('balance')
          .eq('id', position.user_id)
          .single();
        await supabase
          .from('users')
          .update({ balance: user.balance + position.potential_payout })
          .eq('id', position.user_id);
      }
    }
    console.log(`Settled market: ${market.question} — settlement_price: ${settlement_price}, outcome: ${outcome}`);
  }
}

// Run settlement every hour
cron.schedule('0 * * * *', settleMarkets);

// ── CLAUDE AI MARKET SCANNER ─────────────────────

async function scanAndCreateMarkets() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('scanAndCreateMarkets skipped: ANTHROPIC_API_KEY not set');
    return;
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const systemPrompt =
      'You are a financial prediction market creator. Today is ' + today + '. Generate 5 prediction market questions with resolution_date between 30-90 days from today. All dates must be in 2026. Return ONLY a JSON array, no other text. Each object must have: question (string), category (crypto/commodities/earnings/macro), resolution_date (YYYY-MM-DD format), target_price (number), direction (above or below)';

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content:
            'Generate the markets as requested in the system prompt and return ONLY the JSON array.',
        },
      ],
    });

    const content = response?.content?.[0]?.text || response?.content?.[0]?.input_text || '';
    if (!content) {
      console.warn('Claude scan returned empty content');
      return;
    }

    let markets;
    try {
      markets = JSON.parse(content);
    } catch (err) {
      console.error('Failed to parse Claude JSON for market scan:', err.message);
      return;
    }

    if (!Array.isArray(markets)) {
      console.warn('Claude scan did not return an array, skipping');
      return;
    }

    for (const m of markets) {
      if (!m || typeof m.question !== 'string') continue;

      // Skip duplicates by question
      const { data: existing } = await supabase
        .from('markets')
        .select('id')
        .eq('question', m.question)
        .maybeSingle();
      if (existing) continue;

      const category = (m.category || '').toString();
      const direction = (m.direction || '').toLowerCase() === 'above' ? 'above' : 'below';
      const target_price = Number(m.target_price) || 0;
      const resolution_date = m.resolution_date;
      const expiry_date = resolution_date;

      const insertRow = {
        question: m.question,
        category,
        resolution_date,
        commodity: category,
        target_price,
        direction,
        expiry_date,
        resolved: false,
      };
      console.log('[scanAndCreateMarkets] inserting:', JSON.stringify(insertRow, null, 2));

      const { data: inserted, error } = await supabase.from('markets').insert([insertRow]).select();
      if (error) {
        console.error('[scanAndCreateMarkets] Supabase insert error:', error.message, error);
      }
    }
  } catch (err) {
    console.error('scanAndCreateMarkets error:', err.message);
  }
}

// Run Claude scanner every 6 hours
cron.schedule('0 */6 * * *', scanAndCreateMarkets);

// Manual trigger endpoint
app.post('/api/scan-markets', async (req, res) => {
  try {
    await scanAndCreateMarkets();
    res.json({ ok: true });
  } catch (err) {
    console.error('Manual scan-markets error:', err.message);
    res.status(500).json({ error: 'Scan failed' });
  }
});

// POST /api/creator/resolve/:marketId — creator manually resolves a market (YES/NO)
app.post('/api/creator/resolve/:marketId', requireAuth, async (req, res) => {
  const { marketId } = req.params;
  const { outcome } = req.body; // boolean: true = YES, false = NO
  if (typeof outcome !== 'boolean') return res.status(400).json({ error: 'outcome (boolean) required' });

  // Verify this market belongs to the authenticated creator
  const { data: settings } = await supabase
    .from('creator_settings')
    .select('slug')
    .eq('user_id', req.userId)
    .maybeSingle();
  if (!settings) return res.status(403).json({ error: 'Not a creator account' });

  const { data: market, error: marketErr } = await supabase
    .from('markets')
    .select('*')
    .eq('id', marketId)
    .eq('creator_slug', settings.slug)
    .maybeSingle();
  if (marketErr || !market) return res.status(404).json({ error: 'Market not found or not yours' });
  if (market.resolved) return res.status(400).json({ error: 'Market already resolved' });

  // Resolve the market
  await supabase
    .from('markets')
    .update({ resolved: true, outcome, settlement_price: null })
    .eq('id', marketId);

  // Settle all positions
  const { data: positions } = await supabase
    .from('positions')
    .select('*')
    .eq('market_id', marketId)
    .eq('settled', false);

  for (const position of (positions || [])) {
    const won = (position.side === 'YES') === outcome;
    await supabase
      .from('positions')
      .update({ settled: true, won })
      .eq('id', position.id);

    if (won) {
      const { data: user } = await supabase
        .from('users')
        .select('balance')
        .eq('id', position.user_id)
        .single();
      if (user) {
        await supabase
          .from('users')
          .update({ balance: user.balance + position.potential_payout })
          .eq('id', position.user_id);
      }
    }
  }

  console.log(`Creator resolved market ${marketId} (${market.question}) → ${outcome ? 'YES' : 'NO'}`);
  res.json({ ok: true, market_id: marketId, outcome, positions_settled: (positions || []).length });
});

// GET /api/creator/:slug/theme — public, returns theme config for a creator subdomain
app.get('/api/creator/:slug/theme', async (req, res) => {
  const { slug } = req.params;
  const { data, error } = await supabase
    .from('creator_settings')
    .select('display_name, custom_points_name, theme_type')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !data) return res.status(404).json({ error: 'Creator not found' });
  res.json({
    display_name: data.display_name,
    custom_points_name: data.custom_points_name || 'Flex Points',
    theme_type: data.theme_type || 'default',
  });
});

// ── TEMPLATES ─────────────────────────────────────

const TEMPLATES = {
  sports: {
    name: 'Sports',
    category: 'entertainment',
    markets: [
      { question: 'Will the home team win tonight\'s game?', category: 'entertainment', target_price: 0, direction: 'above', days: 1 },
      { question: 'Will there be overtime in the next playoff game?', category: 'entertainment', target_price: 0, direction: 'above', days: 7 },
      { question: 'Will the leading scorer finish the season above 30 PPG?', category: 'entertainment', target_price: 30, direction: 'above', days: 60 },
      { question: 'Will the #1 seed make the finals?', category: 'entertainment', target_price: 0, direction: 'above', days: 45 },
      { question: 'Will any underdog ranked 5+ win the championship?', category: 'entertainment', target_price: 0, direction: 'above', days: 60 },
    ],
  },
  crypto: {
    name: 'Crypto',
    category: 'crypto',
    markets: [
      { question: 'Will Bitcoin exceed $100,000 by end of month?', category: 'crypto', target_price: 100000, direction: 'above', days: 30 },
      { question: 'Will Ethereum stay above $3,000 this week?', category: 'crypto', target_price: 3000, direction: 'above', days: 7 },
      { question: 'Will a new country adopt Bitcoin as legal tender?', category: 'crypto', target_price: 0, direction: 'above', days: 90 },
      { question: 'Will BTC dominance exceed 60% this month?', category: 'crypto', target_price: 0, direction: 'above', days: 30 },
      { question: 'Will a spot ETH ETF see $1B+ in weekly inflows?', category: 'crypto', target_price: 0, direction: 'above', days: 45 },
    ],
  },
  podcast: {
    name: 'Podcast',
    category: 'entertainment',
    markets: [
      { question: 'Will the next episode hit #1 on Spotify charts?', category: 'entertainment', target_price: 0, direction: 'above', days: 14 },
      { question: 'Will the host interview a political figure this month?', category: 'entertainment', target_price: 0, direction: 'above', days: 30 },
      { question: 'Will the next guest be a repeat appearance?', category: 'entertainment', target_price: 0, direction: 'above', days: 7 },
      { question: 'Will the show cross 1M downloads this quarter?', category: 'entertainment', target_price: 0, direction: 'above', days: 90 },
      { question: 'Will there be a live show announcement this month?', category: 'entertainment', target_price: 0, direction: 'above', days: 30 },
    ],
  },
  finance: {
    name: 'Finance',
    category: 'macro',
    markets: [
      { question: 'Will the Fed cut rates at the next FOMC meeting?', category: 'macro', target_price: 0, direction: 'above', days: 45 },
      { question: 'Will the S&P 500 close above 5,500 this month?', category: 'macro', target_price: 5500, direction: 'above', days: 30 },
      { question: 'Will US CPI come in below 3% this quarter?', category: 'macro', target_price: 0, direction: 'above', days: 60 },
      { question: 'Will gold exceed $3,000/oz before July?', category: 'commodities', target_price: 3000, direction: 'above', days: 60 },
      { question: 'Will any Magnificent 7 stock drop 20%+ from its high?', category: 'earnings', target_price: 0, direction: 'above', days: 90 },
    ],
  },
  entertainment: {
    name: 'Entertainment',
    category: 'entertainment',
    markets: [
      { question: 'Will this weekend\'s #1 movie gross over $50M?', category: 'entertainment', target_price: 0, direction: 'above', days: 7 },
      { question: 'Will the Best Picture winner be a sequel or franchise film?', category: 'entertainment', target_price: 0, direction: 'above', days: 60 },
      { question: 'Will a major streaming show be cancelled this month?', category: 'entertainment', target_price: 0, direction: 'above', days: 30 },
      { question: 'Will a music artist announce a world tour this quarter?', category: 'entertainment', target_price: 0, direction: 'above', days: 90 },
      { question: 'Will a video game release score 90+ on Metacritic?', category: 'entertainment', target_price: 0, direction: 'above', days: 45 },
    ],
  },
};

// GET /api/templates/:id — return pre-seeded market questions for a template
app.get('/api/templates/:id', (req, res) => {
  const tpl = TEMPLATES[req.params.id];
  if (!tpl) return res.status(404).json({ error: 'Template not found' });
  const today = new Date();
  const markets = tpl.markets.map(m => {
    const expiry = new Date(today);
    expiry.setDate(expiry.getDate() + m.days);
    return {
      question: m.question,
      category: m.category,
      commodity: m.category,
      target_price: m.target_price,
      direction: m.direction,
      expiry_date: expiry.toISOString().split('T')[0],
    };
  });
  res.json({ id: req.params.id, name: tpl.name, markets });
});

// ── START ─────────────────────────────────────────
// ============================================================
// HYPERFLEX — Creator Platform Routes
// Drop this entire block into server.js BEFORE your 404 handler
// Requires: bcrypt, jsonwebtoken (already in package.json likely)
// Run: npm install bcrypt jsonwebtoken
// ============================================================

const JWT_SECRET = process.env.JWT_SECRET || 'hyperflex-dev-secret-change-in-prod';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const PROHIBITED_PATTERNS = [
  { re: /\b(assassinat\w*|kill\s+(?:the\s+)?(?:president|prime\s+minister|senator|official|leader)|murder\s+(?:the\s+)?(?:president|pm))\b/i,
    msg: 'Markets about assassination or targeted killing of individuals are not permitted.' },
  { re: /\b(drug\s+traffick\w*|money\s+laundering|human\s+traffick\w*|child\s+(?:abuse|exploit\w*)|terrorist\s+attack|bomb\s+(?:a|the)\s+\w+)\b/i,
    msg: 'Markets about illegal activities are not permitted.' },
  { re: /\b(insider\s+trad\w*|market\s+manipulat\w*)\b/i,
    msg: 'Markets about illegal financial activities are not permitted.' },
];

// ─── MIDDLEWARE: Auth guard ──────────────────────────────────
function requireCreator(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.creator = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── HELPER: Generate JWT ────────────────────────────────────
function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, slug: user.slug, is_creator: true },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// ════════════════════════════════════════════════════════════
// 1. CHECK SLUG AVAILABILITY
// GET /api/creator/check-slug?slug=gridiron-picks
// ════════════════════════════════════════════════════════════
app.get('/api/creator/check-slug', async (req, res) => {
  try {
    const { slug } = req.query;
    if (!slug || !/^[a-z0-9-]{3,30}$/.test(slug)) {
      return res.json({ available: false, reason: 'Invalid slug format' });
    }

    // Reserved slugs
    const reserved = ['admin', 'api', 'app', 'www', 'creator', 'dashboard',
      'login', 'signup', 'markets', 'leaderboard', 'hyperflex', 'support', 'help'];
    if (reserved.includes(slug)) {
      return res.json({ available: false, reason: 'Reserved slug' });
    }

    const { data } = await supabase
      .from('creator_settings')
      .select('slug')
      .eq('slug', slug)
      .maybeSingle();

    res.json({ available: !data });
  } catch (err) {
    console.error('check-slug error:', err);
    res.status(500).json({ available: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 2. CREATOR SIGNUP
// POST /api/creator/signup
// Body: { display_name, email, password, slug, custom_points_name,
//         primary_color, community_description, selected_markets[] }
// ════════════════════════════════════════════════════════════
app.post('/api/creator/signup', async (req, res) => {
  try {
    const {
      display_name, email, password, slug,
      custom_points_name = 'Flex Points',
      primary_color = '#c9920d',
      community_description = '',
      selected_markets = []
    } = req.body;

    // Validate required fields
    if (!display_name || !email || !password || !slug) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password too short' });
    }
    if (!/^[a-z0-9-]{3,30}$/.test(slug)) {
      return res.status(400).json({ error: 'Invalid slug' });
    }

    // Check slug not taken
    const { data: existing } = await supabase
      .from('creator_settings')
      .select('slug')
      .eq('slug', slug)
      .maybeSingle();
    if (existing) {
      return res.status(409).json({ error: 'Slug already taken' });
    }

    // Check email not taken
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle();
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 12);

    // Create user
    const { data: newUser, error: userErr } = await supabase
      .from('users')
      .insert({
        email: email.toLowerCase(),
        password_hash,
        display_name,
        is_creator: true,
        tenant_slug: slug,
        balance: 1000 * 100 // $1,000 starting balance in cents
      })
      .select()
      .single();

    if (userErr) throw userErr;

    // Create creator settings
    const { error: settingsErr } = await supabase
      .from('creator_settings')
      .insert({
        creator_id: newUser.id,
        slug,
        display_name,
        custom_points_name,
        primary_color,
        community_description,
        is_active: true,
        plan: 'free',
        created_at: new Date().toISOString()
      });

    if (settingsErr) {
      // Roll back the created user so we don't leave an orphaned record
      await supabase.from('users').delete().eq('id', newUser.id);
      throw settingsErr;
    }

    // Publish selected AI-suggested markets
    if (selected_markets.length > 0) {
      const marketsToInsert = selected_markets.map(m => ({
        question: m.question,
        category: m.category || 'other',
        commodity: m.category || 'other',
        target_price: 0,
        direction: 'above',
        expiry_date: m.resolution_date || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
        creator_id: newUser.id,
        tenant_slug: slug,
        is_public: true,
        yes_price: 0.50,
        no_price: 0.50,
        resolved: false,
        created_at: new Date().toISOString()
      }));

      const { error: marketsErr } = await supabase
        .from('markets')
        .insert(marketsToInsert);

      if (marketsErr) console.error('Markets insert error:', marketsErr);
    }

    // Generate token
    const token = makeToken({ id: newUser.id, email: newUser.email, slug });

    res.json({
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        display_name: newUser.display_name,
        slug,
        custom_points_name,
        primary_color
      }
    });

  } catch (err) {
    console.error('creator signup error:', err);
    res.status(500).json({
      error: err.message || 'Signup failed',
      details: err.details || undefined,
      hint: err.hint || undefined
    });
  }
});

// ════════════════════════════════════════════════════════════
// 3. CREATOR LOGIN
// POST /api/creator/login
// Body: { email, password }
// ════════════════════════════════════════════════════════════
app.post('/api/creator/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing email or password' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('is_creator', true)
      .maybeSingle();

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const { data: settings } = await supabase
      .from('creator_settings')
      .select('*')
      .eq('creator_id', user.id)
      .maybeSingle();

    const token = makeToken({ id: user.id, email: user.email, slug: settings?.slug });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        slug: settings?.slug,
        custom_points_name: settings?.custom_points_name,
        primary_color: settings?.primary_color
      }
    });

  } catch (err) {
    console.error('creator login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 4. CREATOR DASHBOARD DATA
// GET /api/creator/dashboard
// Auth: Bearer token required
// ════════════════════════════════════════════════════════════
app.get('/api/creator/dashboard', requireCreator, async (req, res) => {
  try {
    const creatorId = req.creator.id;

    // Get creator settings
    const { data: settings, error: settingsErr } = await supabase
      .from('creator_settings')
      .select('*')
      .eq('creator_id', creatorId)
      .single();

    if (settingsErr || !settings) {
      return res.status(404).json({ error: 'Creator not found' });
    }

    // Get creator's markets — match by creator_id OR tenant_slug to catch all creation paths
    const { data: markets } = await supabase
      .from('markets')
      .select('*')
      .or(`creator_id.eq.${creatorId},tenant_slug.eq.${settings.slug}`)
      .order('created_at', { ascending: false });

    // Get creator's display name from users
    const { data: creatorUser } = await supabase
      .from('users')
      .select('display_name, email')
      .eq('id', creatorId)
      .maybeSingle();

    // Build stats
    const liveMarkets = (markets || []).filter(m => !m.resolved && new Date(m.expiry_date) >= new Date());
    const totalVolume = (markets || []).reduce((sum, m) => sum + (m.volume || 0), 0);

    // Get unique traders across all creator's markets
    const marketIds = (markets || []).map(m => m.id);
    let totalTraders = 0;
    let weeklyTrades = 0;

    if (marketIds.length > 0) {
      const { data: traderRows } = await supabase
        .from('positions')
        .select('user_id')
        .in('market_id', marketIds);

      totalTraders = new Set((traderRows || []).map(r => r.user_id)).size;

      const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const { count: weekCount } = await supabase
        .from('positions')
        .select('id', { count: 'exact', head: true })
        .in('market_id', marketIds)
        .gte('created_at', oneWeekAgo);

      weeklyTrades = weekCount || 0;
    }

    // Get community leaderboard — distinct traders by current balance
    let leaderboard = [];
    if (marketIds.length > 0) {
      const { data: positions } = await supabase
        .from('positions')
        .select('user_id')
        .in('market_id', marketIds);

      if (positions && positions.length > 0) {
        const userIds = [...new Set(positions.map(p => p.user_id))];

        // Count trades per user
        const tradeCountMap = {};
        positions.forEach(p => { tradeCountMap[p.user_id] = (tradeCountMap[p.user_id] || 0) + 1; });

        const { data: traders } = await supabase
          .from('users')
          .select('id, display_name, balance')
          .in('id', userIds);

        leaderboard = (traders || [])
          .map(u => ({
            user_id: u.id,
            display_name: u.display_name || 'Anonymous',
            balance: u.balance || 0,
            pnl: u.balance || 0,   // frontend uses pnl field for display
            trade_count: tradeCountMap[u.id] || 0
          }))
          .sort((a, b) => b.balance - a.balance)
          .slice(0, 20);
      }
    }

    res.json({
      creator: {
        id: creatorId,
        display_name: creatorUser?.display_name || settings.display_name,
        email: creatorUser?.email,
        slug: settings.slug,
        custom_points_name: settings.custom_points_name,
        primary_color: settings.primary_color,
        plan: settings.plan || 'free',
        community_description: settings.community_description
      },
      stats: {
        total_traders: totalTraders,
        live_markets: liveMarkets.length,
        total_volume: totalVolume,
        weekly_trades: weeklyTrades,
        total_markets: (markets || []).length,
        resolved_markets: (markets || []).filter(m => m.resolved).length
      },
      markets: markets || [],
      leaderboard,
      rewards: await supabase
        .from('creator_rewards')
        .select('id, threshold, title, description')
        .eq('creator_id', creatorId)
        .order('threshold', { ascending: true })
        .then(r => r.data || [])
    });

  } catch (err) {
    console.error('dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 5. UPDATE CREATOR SETTINGS
// PUT /api/creator/settings
// Auth: Bearer token required
// Body: { display_name, custom_points_name, primary_color }
// ════════════════════════════════════════════════════════════
app.put('/api/creator/settings', requireCreator, async (req, res) => {
  try {
    const { display_name, custom_points_name, primary_color } = req.body;

    const { error } = await supabase
      .from('creator_settings')
      .update({
        display_name,
        custom_points_name,
        primary_color,
        updated_at: new Date().toISOString()
      })
      .eq('creator_id', req.creator.id);

    if (error) throw error;

    // Also update users table display name
    if (display_name) {
      await supabase
        .from('users')
        .update({ display_name })
        .eq('id', req.creator.id);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('settings update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 5a. QUESTION VALIDATOR
// POST /api/creator/validate-question
// Body: { question }
// Returns: { valid, reason, suggested_rewrite? }
// ════════════════════════════════════════════════════════════
app.post('/api/creator/validate-question', requireCreator, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || question.trim().length < 5) {
      return res.json({ valid: false, reason: 'Question is too short.', suggested_rewrite: null });
    }

    if (!ANTHROPIC_API_KEY) {
      return res.json({ valid: true, reason: 'Validation unavailable (no API key).', suggested_rewrite: null });
    }

    const prompt = `You are a prediction market quality checker. Evaluate whether this market question is resolvable and well-formed.

A good prediction market question:
- Has a clear YES or NO answer determinable by a specific future date
- References concrete, observable events
- Is not ambiguous about what counts as YES vs NO
- Cannot be answered by pure opinion or interpretation

Question: "${question.trim()}"

Return ONLY valid JSON:
{
  "valid": true or false,
  "reason": "one sentence explanation",
  "suggested_rewrite": "improved version of the question if invalid, or null if already valid"
}`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await aiRes.json();
    const text = aiData.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.json({ valid: true, reason: 'Could not parse validation result.', suggested_rewrite: null });

    const parsed = JSON.parse(jsonMatch[0]);
    res.json({
      valid: !!parsed.valid,
      reason: parsed.reason || '',
      suggested_rewrite: parsed.suggested_rewrite || null
    });
  } catch (err) {
    // Fail open — don't block creation on validation errors
    res.json({ valid: true, reason: 'Validation service unavailable.', suggested_rewrite: null });
  }
});

// ════════════════════════════════════════════════════════════
// 5b. REWARDS CRUD
// GET  /api/creator/:slug/rewards  — public
// POST /api/creator/rewards        — requireCreator
// PUT  /api/creator/rewards/:id    — requireCreator
// DELETE /api/creator/rewards/:id  — requireCreator
// ════════════════════════════════════════════════════════════

app.get('/api/creator/:slug/rewards', async (req, res) => {
  try {
    const { data: settings } = await supabase
      .from('creator_settings')
      .select('creator_id')
      .eq('slug', req.params.slug)
      .maybeSingle();
    if (!settings) return res.status(404).json({ error: 'Community not found' });

    const { data: rewards, error } = await supabase
      .from('creator_rewards')
      .select('id, threshold, title, description')
      .eq('creator_id', settings.creator_id)
      .order('threshold', { ascending: true });
    if (error) throw error;
    res.json({ rewards: rewards || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/creator/rewards', requireCreator, async (req, res) => {
  try {
    const { threshold, title, description } = req.body;
    if (!threshold || !title) return res.status(400).json({ error: 'threshold and title are required' });

    const { data, error } = await supabase
      .from('creator_rewards')
      .insert([{ creator_id: req.creator.id, threshold: Number(threshold), title, description: description || '' }])
      .select()
      .single();
    if (error) throw error;
    res.json({ ok: true, reward: data });
  } catch (err) {
    console.error('rewards insert error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/creator/rewards/:id', requireCreator, async (req, res) => {
  try {
    const { threshold, title, description } = req.body;
    const updates = {};
    if (threshold !== undefined) updates.threshold = Number(threshold);
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;

    const { error } = await supabase
      .from('creator_rewards')
      .update(updates)
      .eq('id', req.params.id)
      .eq('creator_id', req.creator.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/creator/rewards/:id', requireCreator, async (req, res) => {
  try {
    const { error } = await supabase
      .from('creator_rewards')
      .delete()
      .eq('id', req.params.id)
      .eq('creator_id', req.creator.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 5c. SMART RESOLUTION — AI-POWERED SUGGESTION
// POST /api/creator/markets/:id/suggest-resolution
// Auth: requireCreator
// Returns: { suggested_outcome, reasoning, sources_cited, confidence, crypto_data? }
// ════════════════════════════════════════════════════════════
app.post('/api/creator/markets/:id/suggest-resolution', requireCreator, async (req, res) => {
  try {
    const { data: market } = await supabase
      .from('markets')
      .select('*')
      .eq('id', req.params.id)
      .eq('creator_id', req.creator.id)
      .maybeSingle();

    if (!market) return res.status(404).json({ error: 'Market not found or not yours' });
    if (market.resolved) return res.status(409).json({ error: 'Market already resolved' });

    if (!ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'Anthropic API key not configured' });
    }

    // For crypto markets, try to fetch live price data from CoinGecko
    let cryptoContext = '';
    if (market.category === 'crypto' || market.category === 'finance') {
      try {
        // Ask Claude mini to extract coin symbol first, then fetch price
        const coinRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 100,
            messages: [{ role: 'user', content: `Extract the cryptocurrency coin ID for CoinGecko API from this question. Reply with ONLY the lowercase CoinGecko ID (e.g. "bitcoin", "ethereum", "solana") or "none" if not applicable.\n\nQuestion: "${market.question}"` }]
          })
        });
        const coinData = await coinRes.json();
        const coinId = (coinData.content?.[0]?.text || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');

        if (coinId && coinId !== 'none' && coinId.length > 1) {
          const priceRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`);
          if (priceRes.ok) {
            const priceData = await priceRes.json();
            if (priceData[coinId]) {
              const p = priceData[coinId];
              cryptoContext = `\n\nLIVE PRICE DATA (CoinGecko): ${coinId} = $${p.usd?.toLocaleString()} USD (24h change: ${p.usd_24h_change?.toFixed(2)}%)`;
            }
          }
        }
      } catch (e) {
        // price fetch is best-effort, continue without it
      }
    }

    const sources = (() => {
      try { return JSON.parse(market.resolution_sources || '[]'); } catch { return []; }
    })();

    const prompt = `You are an impartial resolution analyst for a prediction market platform.

Market Question: "${market.question}"
Category: ${market.category || 'general'}
Resolution Date: ${market.expiry_date}
Today's Date: ${new Date().toISOString().split('T')[0]}
Resolution Sources: ${sources.length ? sources.join(', ') : 'Not specified'}${cryptoContext}

Based on your knowledge up to your training cutoff and the context above, provide a resolution analysis.

IMPORTANT:
- If the resolution date is in the future, note that the market should not be resolved yet unless the outcome is already certain
- Be honest about uncertainty — use confidence levels
- For crypto/finance: use the live price data if provided
- Cite which sources would confirm your suggestion

Return ONLY valid JSON:
{
  "suggested_outcome": "YES" or "NO" or "UNRESOLVABLE",
  "confidence": "HIGH" or "MEDIUM" or "LOW",
  "reasoning": "2-3 sentence explanation of why you suggest this outcome",
  "sources_cited": ["source1", "source2"],
  "caveat": "Any important caveat or 'none'"
}`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-opus-4-6', max_tokens: 600, messages: [{ role: 'user', content: prompt }] })
    });

    const aiData = await aiRes.json();
    const text = aiData.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI returned invalid format');

    const parsed = JSON.parse(jsonMatch[0]);

    // Store the suggestion on the market
    await supabase.from('markets').update({
      suggested_outcome: parsed.suggested_outcome,
      auto_resolution_data: JSON.stringify({ ...parsed, crypto_context: cryptoContext, generated_at: new Date().toISOString() })
    }).eq('id', req.params.id);

    res.json({ ...parsed, market_id: req.params.id });

  } catch (err) {
    console.error('suggest-resolution error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 6. RESOLVE MARKET (Creator only)
// POST /markets/:id/resolve
// Auth: Bearer token required
// Body: { outcome: 'YES' | 'NO' }
// ════════════════════════════════════════════════════════════
app.post('/markets/:id/resolve', requireCreator, async (req, res) => {
  try {
    const { id } = req.params;
    const { outcome } = req.body;
    const { attestation_text } = req.body;

    if (!['YES', 'NO'].includes(outcome)) {
      return res.status(400).json({ error: 'Outcome must be YES or NO' });
    }

    // Verify market belongs to this creator
    const { data: market } = await supabase
      .from('markets')
      .select('*')
      .eq('id', id)
      .eq('creator_id', req.creator.id)
      .maybeSingle();

    if (!market) return res.status(404).json({ error: 'Market not found or not yours' });
    if (market.resolved) return res.status(409).json({ error: 'Market already resolved' });

    // Mark market resolved
    const { error: resolveErr } = await supabase
      .from('markets')
      .update({
        resolved: true,
        outcome,
        resolved_at: new Date().toISOString()
      })
      .eq('id', id);

    if (resolveErr) throw resolveErr;

    // Store attestation
    if (attestation_text) {
      await supabase.from('markets').update({ attestation_text }).eq('id', id);
    }

    // Pay out winners — get all positions for this market
    const { data: positions } = await supabase
      .from('positions')
      .select('*')
      .eq('market_id', id);

    if (positions && positions.length > 0) {
      const payouts = [];
      for (const pos of positions) {
        const isWinner = pos.side === outcome;
        const pnl = isWinner ? pos.amount : -pos.amount; // simplified pnl

        payouts.push(
          supabase.from('positions').update({
            resolved: true,
            won: isWinner,
            pnl
          }).eq('id', pos.id)
        );

        if (isWinner) {
          // Credit winner's balance — fetch current then increment
          payouts.push(
            (async () => {
              const { data: u } = await supabase.from('users').select('balance').eq('id', pos.user_id).single();
              if (u) await supabase.from('users').update({ balance: (u.balance || 0) + pos.amount * 2 }).eq('id', pos.user_id);
            })()
          );
        }
      }
      await Promise.allSettled(payouts);
    }

    res.json({ ok: true, outcome, positions_settled: positions?.length || 0 });

  } catch (err) {
    console.error('resolve error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 7. AI MARKET SUGGESTER
// POST /api/suggest-markets
// Body: { description: "Weekly fantasy football podcast..." }
// Returns: { markets: [{ question, category, resolution_date }] }
// ════════════════════════════════════════════════════════════
app.post('/api/suggest-markets', async (req, res) => {
  try {
    const { description } = req.body;
    if (!description || description.trim().length < 10) {
      return res.status(400).json({ error: 'Please provide a community description' });
    }

    if (!ANTHROPIC_API_KEY) {
      // Fallback suggestions if no API key
      return res.json({ markets: getFallbackSuggestions(description) });
    }

    const today = new Date();
    const in30 = new Date(today.getTime() + 30 * 86400000).toISOString().split('T')[0];
    const in60 = new Date(today.getTime() + 60 * 86400000).toISOString().split('T')[0];
    const in90 = new Date(today.getTime() + 90 * 86400000).toISOString().split('T')[0];

    const prompt = `You are helping a community creator set up prediction markets for their audience.

Community description: "${description}"

Generate exactly 10 prediction market questions tailored to this community. Each must:
- Be a clear YES or NO question
- Be interesting and specific to this community's niche  
- Have a realistic resolution date (use dates: near=${in30}, mid=${in60}, far=${in90})
- Be fun and engaging for fans/members

Return ONLY valid JSON in this exact format, no other text:
{
  "markets": [
    {
      "question": "Will [specific question]?",
      "category": "sports|entertainment|finance|other",
      "resolution_date": "YYYY-MM-DD"
    }
  ]
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await response.json();
    const text = aiData.content?.[0]?.text || '';

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Invalid AI response format');

    const parsed = JSON.parse(jsonMatch[0]);
    res.json({ markets: parsed.markets || [] });

  } catch (err) {
    console.error('suggest-markets error:', err);
    // Return fallback on any error
    res.json({ markets: getFallbackSuggestions(req.body.description || '') });
  }
});

// Fallback suggestions if AI is unavailable
function getFallbackSuggestions(description) {
  const isFantasy = /fantasy|football|nfl|nba|dfs|roto/i.test(description);
  const isComedy = /comedy|podcast|stand.?up|roast|funny/i.test(description);
  const isFinance = /finance|stock|crypto|invest|trading/i.test(description);

  if (isFantasy) {
    return [
      { question: "Will the top fantasy scorer this week exceed 40 points?", category: "sports", resolution_date: getDate(7) },
      { question: "Will a running back be the #1 overall fantasy scorer this weekend?", category: "sports", resolution_date: getDate(7) },
      { question: "Will any QB throw for 400+ yards this week?", category: "sports", resolution_date: getDate(7) },
      { question: "Will there be a walk-off fantasy win decided by a Monday night kicker?", category: "sports", resolution_date: getDate(8) },
      { question: "Will the consensus #1 waiver pickup score 15+ points in their next game?", category: "sports", resolution_date: getDate(14) },
      { question: "Will any team score 50+ total fantasy points this week?", category: "sports", resolution_date: getDate(7) },
      { question: "Will a tight end crack the top 5 overall scorers this week?", category: "sports", resolution_date: getDate(7) },
      { question: "Will the most traded player on the waiver wire outperform their start?", category: "sports", resolution_date: getDate(14) },
      { question: "Will the highest-owned DFS player bust (under 15 pts) this week?", category: "sports", resolution_date: getDate(7) },
      { question: "Will any player score 3+ touchdowns in a single game this week?", category: "sports", resolution_date: getDate(7) }
    ];
  }

  if (isComedy) {
    return [
      { question: "Will this week's episode feature a surprise celebrity guest?", category: "entertainment", resolution_date: getDate(7) },
      { question: "Will the host go on a rant lasting more than 10 minutes in the next episode?", category: "entertainment", resolution_date: getDate(7) },
      { question: "Will the next episode hit #1 on the podcast charts?", category: "entertainment", resolution_date: getDate(14) },
      { question: "Will a guest make the host genuinely laugh uncontrollably this week?", category: "entertainment", resolution_date: getDate(7) },
      { question: "Will the next episode be longer than 2 hours?", category: "entertainment", resolution_date: getDate(7) },
      { question: "Will there be a controversial clip that goes viral from the next episode?", category: "entertainment", resolution_date: getDate(14) },
      { question: "Will the host mention their most talked-about bit in the next 3 episodes?", category: "entertainment", resolution_date: getDate(21) },
      { question: "Will a fan question get answered on the next episode?", category: "entertainment", resolution_date: getDate(7) },
      { question: "Will the podcast release a bonus episode this month?", category: "entertainment", resolution_date: getDate(30) },
      { question: "Will the next episode have fewer than 5 sponsor reads?", category: "entertainment", resolution_date: getDate(7) }
    ];
  }

  if (isFinance) {
    return [
      { question: "Will the S&P 500 close higher than today by end of month?", category: "finance", resolution_date: getDate(30) },
      { question: "Will Bitcoin exceed $100,000 by end of quarter?", category: "finance", resolution_date: getDate(90) },
      { question: "Will the Fed cut rates at the next FOMC meeting?", category: "finance", resolution_date: getDate(45) },
      { question: "Will Apple stock outperform the Nasdaq this month?", category: "finance", resolution_date: getDate(30) },
      { question: "Will any major bank announce layoffs in the next 60 days?", category: "finance", resolution_date: getDate(60) },
      { question: "Will gold hit $3,000/oz before Bitcoin hits $120,000?", category: "finance", resolution_date: getDate(90) },
      { question: "Will any tech IPO this month pop 50%+ on day one?", category: "finance", resolution_date: getDate(30) },
      { question: "Will inflation data come in below 3% at the next release?", category: "finance", resolution_date: getDate(45) },
      { question: "Will the 10-year Treasury yield fall below 4% this quarter?", category: "finance", resolution_date: getDate(90) },
      { question: "Will any meme stock gain more than 50% in a single day this month?", category: "finance", resolution_date: getDate(30) }
    ];
  }

  // Generic fallback
  return [
    { question: "Will our community reach 1,000 members by end of month?", category: "other", resolution_date: getDate(30) },
    { question: "Will this week's most-discussed topic get resolved in our favor?", category: "other", resolution_date: getDate(7) },
    { question: "Will the host/leader make their prediction from last week correct?", category: "other", resolution_date: getDate(14) },
    { question: "Will we hit a community engagement milestone this week?", category: "other", resolution_date: getDate(7) },
    { question: "Will the most-upvoted prediction in our community this week be right?", category: "other", resolution_date: getDate(14) },
    { question: "Will the underdog position win this week's debate?", category: "other", resolution_date: getDate(7) },
    { question: "Will our community's consensus prediction beat the experts?", category: "other", resolution_date: getDate(30) },
    { question: "Will there be a major surprise announcement in our niche this month?", category: "other", resolution_date: getDate(30) },
    { question: "Will the most controversial take this week age well?", category: "other", resolution_date: getDate(60) },
    { question: "Will our community's top predictor win again next week?", category: "other", resolution_date: getDate(7) }
  ];
}

function getDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split('T')[0];
}

// ════════════════════════════════════════════════════════════
// 7b. YOUTUBE COMMENT + TRANSCRIPT SCANNER
// POST /api/creator/scan-youtube
// Body: { url: "https://youtube.com/watch?v=..." }
// Returns: { markets, comment_count, transcript_length, video_title }
// Each market has source: 'comments' | 'transcript'
// ════════════════════════════════════════════════════════════

// Helper: fetch auto-generated captions from watch page HTML
async function fetchYouTubeTranscript(videoId) {
  try {
    const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const html = await watchRes.text();

    // Extract all caption baseUrls embedded in the page
    const captionMatches = [...html.matchAll(/"baseUrl":"(https:\\\/\\\/www\.youtube\.com\\\/api\\\/timedtext[^"]+)"/g)];
    if (!captionMatches.length) return null;

    // Unescape JSON-encoded URL, prefer English track
    let captionUrl = null;
    for (const m of captionMatches) {
      const raw = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
      if (!captionUrl) captionUrl = raw; // fallback: first track
      if (raw.includes('lang=en') || raw.includes('lang%3Den')) {
        captionUrl = raw;
        break;
      }
    }
    if (!captionUrl) return null;

    // Fetch as JSON3 format (structured segments)
    const sep = captionUrl.includes('?') ? '&' : '?';
    const transcriptRes = await fetch(captionUrl + sep + 'fmt=json3');
    if (!transcriptRes.ok) return null;

    const transcriptData = await transcriptRes.json();
    const events = transcriptData.events || [];

    const text = events
      .filter(e => e.segs)
      .map(e => e.segs.map(s => (s.utf8 || '').replace(/\n/g, ' ')).join(''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return text || null;
  } catch (err) {
    console.warn('transcript fetch failed:', err.message);
    return null;
  }
}

app.post('/api/creator/scan-youtube', requireCreator, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'YouTube URL is required' });

    if (!YOUTUBE_API_KEY) {
      return res.status(503).json({ error: 'YouTube API key not configured. Add YOUTUBE_API_KEY to your environment.' });
    }
    if (!ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'Anthropic API key not configured.' });
    }

    // ── Extract video ID ──────────────────────────────────────
    let videoId = null;
    let channelId = null;
    let videoTitle = '';

    const videoMatch = url.match(/(?:v=|youtu\.be\/|\/shorts\/|\/live\/)([a-zA-Z0-9_-]{11})/);
    if (videoMatch) {
      videoId = videoMatch[1];
    } else {
      const channelMatch = url.match(/youtube\.com\/(?:channel\/(UC[a-zA-Z0-9_-]+)|c\/([^/?]+)|@([^/?]+))/);
      if (channelMatch) {
        const handle = channelMatch[1] || channelMatch[2] || channelMatch[3];
        if (channelMatch[1]) {
          channelId = channelMatch[1];
        } else {
          const searchRes = await fetch(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(handle)}&maxResults=1&key=${YOUTUBE_API_KEY}`
          );
          const searchData = await searchRes.json();
          if (searchData.error) throw new Error(searchData.error.message);
          channelId = searchData.items?.[0]?.id?.channelId;
        }
        if (!channelId) return res.status(400).json({ error: 'Could not resolve YouTube channel. Try a direct video URL instead.' });

        const vidRes = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&order=date&type=video&maxResults=1&key=${YOUTUBE_API_KEY}`
        );
        const vidData = await vidRes.json();
        if (vidData.error) throw new Error(vidData.error.message);
        videoId = vidData.items?.[0]?.id?.videoId;
        videoTitle = vidData.items?.[0]?.snippet?.title || '';
        if (!videoId) return res.status(404).json({ error: 'No videos found for this channel.' });
      }
    }

    if (!videoId) return res.status(400).json({ error: 'Could not extract a video ID. Paste a YouTube video URL (e.g. youtube.com/watch?v=...)' });

    // ── Fetch title, comments, and transcript in parallel ─────
    const [infoRes, commentRes, transcript] = await Promise.all([
      videoTitle ? null : fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`),
      fetch(`https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&order=relevance&maxResults=100&key=${YOUTUBE_API_KEY}`),
      fetchYouTubeTranscript(videoId)
    ]);

    if (infoRes) {
      const infoData = await infoRes.json();
      if (infoData.error) throw new Error(infoData.error.message);
      videoTitle = infoData.items?.[0]?.snippet?.title || 'YouTube video';
    }

    const commentData = await commentRes.json();
    if (commentData.error) {
      if (commentData.error.code === 403) return res.status(403).json({ error: 'Comments are disabled for this video.' });
      throw new Error(commentData.error.message || 'YouTube API error');
    }

    const comments = (commentData.items || []).map(item =>
      item.snippet?.topLevelComment?.snippet?.textDisplay || ''
    ).filter(Boolean);

    if (comments.length === 0 && !transcript) {
      return res.status(404).json({ error: 'No comments or transcript found for this video.' });
    }

    // ── Build prompt ──────────────────────────────────────────
    const in30 = getDate(30);
    const in60 = getDate(60);
    const in90 = getDate(90);

    const commentBlock = comments.length
      ? comments.slice(0, 100).map((c, i) => `${i + 1}. ${c.replace(/<[^>]+>/g, '').trim()}`).join('\n')
      : '(comments unavailable)';

    // Truncate transcript to ~4000 chars to stay within token budget
    const transcriptBlock = transcript
      ? transcript.slice(0, 4000) + (transcript.length > 4000 ? '… [truncated]' : '')
      : '(transcript unavailable — captions may be disabled or not yet generated)';

    const hasTranscript = !!transcript;

    const prompt = `You are analyzing a YouTube video to generate two types of prediction markets for a fan community.

Video title: "${videoTitle}"

━━━ COMMENTS (what fans are debating) ━━━
${commentBlock}

━━━ VIDEO TRANSCRIPT (what the creator said) ━━━
${transcriptBlock}

Generate two sets of prediction markets:

**SET 1 — FAN DEBATE MARKETS** (source: "comments")
Based on predictions, debates, and speculation in the comments. These are FUTURE questions fans want answered.
Generate 3-6 markets.

**SET 2 — TRANSCRIPT MARKETS** (source: "transcript")
${hasTranscript
  ? `Based on claims, predictions, or upcoming events the CREATOR mentioned in the video. These should be verifiable using the video itself as the resolution source (e.g. "Will X that was claimed in the video turn out to be true?", "Will the creator follow through on Y they announced?"). Generate 3-5 markets.`
  : `The transcript was unavailable — generate 0 transcript markets.`
}

Rules for ALL markets:
- Clear YES or NO question, objectively resolvable
- Resolution dates: near=${in30}, mid=${in60}, far=${in90}
- No duplicate ideas between the two sets

Return ONLY valid JSON, no other text:
{
  "comment_markets": [
    { "question": "Will ...?", "category": "sports|entertainment|finance|politics|other", "resolution_date": "YYYY-MM-DD" }
  ],
  "transcript_markets": [
    { "question": "Will ...?", "category": "sports|entertainment|finance|politics|other", "resolution_date": "YYYY-MM-DD", "resolution_note": "one sentence on how to verify this" }
  ]
}`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 1800,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await aiRes.json();
    const text = aiData.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI returned invalid format');

    const parsed = JSON.parse(jsonMatch[0]);

    const commentMarkets = (parsed.comment_markets || []).map(m => ({ ...m, source: 'comments' }));
    const transcriptMarkets = (parsed.transcript_markets || []).map(m => ({ ...m, source: 'transcript' }));

    res.json({
      markets: [...commentMarkets, ...transcriptMarkets],
      comment_markets: commentMarkets,
      transcript_markets: transcriptMarkets,
      comment_count: comments.length,
      transcript_length: transcript ? transcript.length : 0,
      has_transcript: hasTranscript,
      video_title: videoTitle
    });

  } catch (err) {
    console.error('scan-youtube error:', err);
    res.status(500).json({ error: err.message || 'Failed to scan YouTube video' });
  }
});

// ════════════════════════════════════════════════════════════
// 8. PUBLIC COMMUNITY PAGE DATA
// GET /api/community/:slug
// Returns public data for a creator's community page
// ════════════════════════════════════════════════════════════
app.get('/api/community/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    const { data: settings } = await supabase
      .from('creator_settings')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();

    if (!settings) return res.status(404).json({ error: 'Community not found' });

    // Match on any of the three fields that market-creation routes populate
    const { data: markets } = await supabase
      .from('markets')
      .select('id, question, category, expiry_date, yes_price, no_price, volume, trader_count, resolved, outcome')
      .or(`tenant_slug.eq.${slug},creator_id.eq.${settings.creator_id}`)
      .eq('is_public', true)
      .order('created_at', { ascending: false });

    res.json({
      community: {
        display_name: settings.display_name,
        slug: settings.slug,
        custom_points_name: settings.custom_points_name,
        primary_color: settings.primary_color
      },
      markets: markets || [],
      rewards: await supabase
        .from('creator_rewards')
        .select('id, threshold, title, description')
        .eq('creator_id', settings.creator_id)
        .order('threshold', { ascending: true })
        .then(r => r.data || [])
    });

  } catch (err) {
    console.error('community page error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 8b. EDIT / DELETE MARKET
// PUT  /markets/:id   — update question, expiry_date, resolution_source, category
// DELETE /markets/:id — archive market (set is_public=false)
// ════════════════════════════════════════════════════════════

app.put('/markets/:id', requireCreator, async (req, res) => {
  try {
    const { id } = req.params;
    const { question, expiry_date, resolution_source, category } = req.body;

    // Verify ownership
    const { data: market } = await supabase
      .from('markets')
      .select('id, creator_id')
      .eq('id', id)
      .eq('creator_id', req.creator.id)
      .maybeSingle();

    if (!market) return res.status(404).json({ error: 'Market not found or not yours' });

    const updates = {};
    if (question !== undefined) updates.question = question;
    if (expiry_date !== undefined) updates.expiry_date = expiry_date;
    if (resolution_source !== undefined) updates.resolution_source = resolution_source;
    if (category !== undefined) { updates.category = category; updates.commodity = category; }

    const { data, error } = await supabase
      .from('markets')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ ok: true, market: data });
  } catch (err) {
    console.error('market update error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/markets/:id', requireCreator, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const { data: market } = await supabase
      .from('markets')
      .select('id, creator_id')
      .eq('id', id)
      .eq('creator_id', req.creator.id)
      .maybeSingle();

    if (!market) return res.status(404).json({ error: 'Market not found or not yours' });

    const { error } = await supabase
      .from('markets')
      .update({ is_public: false })
      .eq('id', id);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('market delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// 9. SERVE CREATOR PAGES
// These routes serve the HTML files
// ════════════════════════════════════════════════════════════

// Signup page
app.get('/creator/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'creator-signup.html'));
});

// Login page
app.get('/creator/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'creator-login.html'));
});

// Dashboard (protected - auth handled client-side via localStorage token)
app.get('/creator/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'creator-dashboard.html'));
});

// ════════════════════════════════════════════════════════════
// 10. PUBLIC COMMUNITY PAGE (slug catch-all — must be last)
// GET /:slug  →  serves community.html, injects slug via query
// ════════════════════════════════════════════════════════════
const RESERVED_SLUGS = new Set([
  'creator', 'api', 'markets', 'positions', 'leaderboard',
  'trade', 'register', 'login', 'favicon.ico', 'robots.txt'
]);
app.get('/:slug', (req, res, next) => {
  const { slug } = req.params;
  if (RESERVED_SLUGS.has(slug) || slug.includes('.')) return next();
  res.sendFile(path.join(__dirname, 'public', 'community.html'));
});

// ════════════════════════════════════════════════════════════
// END CREATOR PLATFORM ROUTES
// ════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HYPERFLEX server running on port ${PORT}`));
