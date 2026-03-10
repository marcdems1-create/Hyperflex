require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const cron = require('node-cron');

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
  process.env.SUPABASE_ANON_KEY
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

// ── CREATOR PLATFORM ──────────────────────────────

// Creator signup: email, password, display_name, slug → user + creator_settings, return JWT
app.post('/api/creator/signup', async (req, res) => {
  const { email, password, display_name, slug, theme_type } = req.body;
  if (!email || !password || !display_name || !slug) {
    return res.status(400).json({ error: 'email, password, display_name, and slug are required' });
  }
  const slugStr = String(slug).trim().toLowerCase();
  if (!/^[a-z0-9]{3,20}$/.test(slugStr)) {
    return res.status(400).json({ error: 'slug must be lowercase alphanumeric, 3–20 characters' });
  }
  const { data: existingSlug } = await supabase
    .from('creator_settings')
    .select('user_id')
    .eq('slug', slugStr)
    .maybeSingle();
  if (existingSlug) return res.status(400).json({ error: 'slug already taken' });

  const { data: existingEmail } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (existingEmail) return res.status(400).json({ error: 'email already registered' });

  const password_hash = await bcrypt.hash(password, 10);
  const { data: user, error: userError } = await supabase
    .from('users')
    .insert([{ email, password_hash, display_name, is_creator: true }])
    .select()
    .single();
  if (userError) return res.status(400).json({ error: userError.message });

  const { error: settingsError } = await supabase
    .from('creator_settings')
    .insert([{ user_id: user.id, slug: slugStr, display_name: display_name || user.display_name, custom_points_name: 'Flex Points', theme_type: theme_type || 'default' }]);
  if (settingsError) {
    await supabase.from('users').delete().eq('id', user.id);
    return res.status(400).json({ error: settingsError.message || 'Failed to create creator settings' });
  }

  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'hyperflex_secret');
  res.json({
    token,
    user: { id: user.id, email: user.email, display_name: user.display_name, balance: user.balance, is_creator: true },
  });
});

// Creator dashboard: markets, total traders, total volume, resolution queue (auth required)
app.get('/api/creator/dashboard', requireAuth, async (req, res) => {
  try {
    const { data: settings, error: settingsErr } = await supabase
      .from('creator_settings')
      .select('slug, display_name')
      .eq('user_id', req.userId)
      .single();
    if (settingsErr || !settings) return res.status(404).json({ error: 'Creator settings not found' });
    const slug = settings.slug;

    const { data: markets, error: marketsErr } = await supabase
      .from('markets')
      .select('*')
      .eq('creator_slug', slug)
      .order('created_at', { ascending: false });
    if (marketsErr) return res.status(400).json({ error: marketsErr.message });

    const marketIds = (markets || []).map((m) => m.id);
    let totalTraders = 0;
    let totalVolume = 0;
    if (marketIds.length > 0) {
      const { data: positions } = await supabase
        .from('positions')
        .select('user_id, amount')
        .in('market_id', marketIds);
      const traders = new Set((positions || []).map((p) => p.user_id));
      totalTraders = traders.size;
      totalVolume = (positions || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    }

    const now = new Date().toISOString();
    const { data: resolutionQueue } = await supabase
      .from('markets')
      .select('*')
      .eq('creator_slug', slug)
      .eq('resolved', false)
      .lt('expiry_date', now)
      .order('expiry_date', { ascending: true });

    res.json({
      markets: markets || [],
      total_traders: totalTraders,
      total_volume: Math.round(totalVolume * 100) / 100,
      resolution_queue: resolutionQueue || [],
    });
  } catch (err) {
    console.error('creator/dashboard error:', err.message);
    res.status(500).json({ error: 'Dashboard failed' });
  }
});

app.get('/api/creator/analytics', requireAuth, async (req, res) => {
  try {
    const { data: settings } = await supabase
      .from('creator_settings')
      .select('slug, display_name')
      .eq('user_id', req.userId)
      .single();
    if (!settings) return res.status(404).json({ error: 'Creator not found' });
    const slug = settings.slug;

    const { data: markets } = await supabase
      .from('markets')
      .select('*')
      .eq('creator_slug', slug)
      .order('created_at', { ascending: true });

    const marketIds = (markets || []).map(m => m.id);
    let positions = [];
    if (marketIds.length > 0) {
      const { data: pos } = await supabase
        .from('positions')
        .select('*, markets(question, category, resolved, outcome)')
        .in('market_id', marketIds);
      positions = pos || [];
    }

    // Markets by category
    const byCategory = {};
    for (const m of (markets || [])) {
      const cat = m.category || 'other';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }

    // Markets over time (by week)
    const byWeek = {};
    for (const m of (markets || [])) {
      if (!m.created_at) continue;
      const d = new Date(m.created_at);
      const week = `${d.getFullYear()}-W${String(Math.ceil((d.getDate()) / 7)).padStart(2,'0')}`;
      byWeek[week] = (byWeek[week] || 0) + 1;
    }

    // Top markets by trade volume
    const mktVolume = {};
    for (const p of positions) {
      mktVolume[p.market_id] = (mktVolume[p.market_id] || { volume: 0, trades: 0, question: p.markets?.question || '' });
      mktVolume[p.market_id].volume += Number(p.amount) || 0;
      mktVolume[p.market_id].trades += 1;
    }
    const topMarkets = Object.entries(mktVolume)
      .map(([id, v]) => ({ market_id: id, question: v.question, volume: Math.round(v.volume * 100) / 100, trades: v.trades }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);

    // Unique traders over time
    const tradersByWeek = {};
    const seenTraders = new Set();
    for (const p of positions.sort((a,b) => new Date(a.created_at) - new Date(b.created_at))) {
      if (!p.created_at) continue;
      const d = new Date(p.created_at);
      const week = `${d.getFullYear()}-W${String(Math.ceil((d.getDate()) / 7)).padStart(2,'0')}`;
      seenTraders.add(p.user_id);
      tradersByWeek[week] = seenTraders.size;
    }

    // Resolution accuracy (resolved markets)
    const resolved = (markets || []).filter(m => m.resolved);
    const totalResolved = resolved.length;
    const yesOutcomes = resolved.filter(m => m.outcome === true).length;

    res.json({
      total_markets: (markets || []).length,
      total_positions: positions.length,
      by_category: byCategory,
      markets_by_week: byWeek,
      traders_by_week: tradersByWeek,
      top_markets: topMarkets,
      total_resolved: totalResolved,
      yes_outcomes: yesOutcomes,
    });
  } catch (err) {
    console.error('analytics error:', err.message);
    res.status(500).json({ error: 'Analytics failed' });
  }
});

// Suggest markets: auth + { description } → Claude returns 5 YES/NO market ideas
app.post('/api/suggest-markets', requireAuth, async (req, res) => {
  const { description } = req.body;
  if (!description || typeof description !== 'string') {
    return res.status(400).json({ error: 'description (string) is required' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'Market suggestions unavailable' });
  }
  try {
    const systemPrompt = `You are a prediction market designer. The user describes their show or community. Generate exactly 5 YES/NO prediction market ideas tailored to that audience. Return ONLY a JSON array, no other text. Each object must have: question (string), category (string, e.g. crypto/commodities/earnings/macro/entertainment), resolution_date (YYYY-MM-DD, 30–90 days from today), notes (string, brief).`;
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Community/show description:\n${description}\n\nReturn the JSON array of 5 market ideas.` }],
    });
    const content = response?.content?.[0]?.text || response?.content?.[0]?.input_text || '';
    if (!content) return res.status(502).json({ error: 'Empty response from AI' });
    let list;
    try {
      list = JSON.parse(content);
    } catch (e) {
      return res.status(502).json({ error: 'Invalid JSON from AI' });
    }
    if (!Array.isArray(list)) list = [list];
    const out = list.slice(0, 5).map((m) => ({
      question: m?.question || '',
      category: m?.category || 'macro',
      resolution_date: m?.resolution_date || null,
      notes: m?.notes || '',
    }));
    res.json(out);
  } catch (err) {
    console.error('suggest-markets error:', err.message);
    res.status(500).json({ error: 'Suggestion failed' });
  }
});

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
  const { question, commodity, target_price, direction, expiry_date } = req.body;
  const row = { question, commodity, target_price, direction, expiry_date };

  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET || 'hyperflex_secret');
      const { data: settings } = await supabase
        .from('creator_settings')
        .select('slug')
        .eq('user_id', payload.id)
        .maybeSingle();
      if (settings?.slug) row.creator_slug = settings.slug;
    } catch (e) {
      // ignore invalid token; insert without creator_slug
    }
  }

  const { data, error } = await supabase
    .from('markets')
    .insert([row])
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HYPERFLEX server running on port ${PORT}`));