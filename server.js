require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());
app.use(require("express").static("public"));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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
  const { data, error } = await supabase
    .from('markets')
    .insert([{ question, commodity, target_price, direction, expiry_date }])
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

// ── SETTLEMENT ────────────────────────────────────

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
    // Fetch settlement price from metals-api (or manual for now)
    // For paper trading we simulate a price
    const settlement_price = market.target_price * (Math.random() > 0.5 ? 1.05 : 0.95);
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
    console.log(`Settled market: ${market.question} — outcome: ${outcome}`);
  }
}

// Run settlement every hour
cron.schedule('0 * * * *', settleMarkets);

// ── START ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HYPERFLEX server running on port ${PORT}`));