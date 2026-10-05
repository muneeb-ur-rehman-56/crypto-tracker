/**
 * CoinPulse - server
 * - Serves the static frontend from /public
 * - Proxies CoinGecko so the API key stays on the server
 * - Caches responses for 60s so we stay inside the free rate limit
 */
require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.COINGECKO_API_KEY;
const BASE = (process.env.COINGECKO_BASE_URL || 'https://api.coingecko.com/api/v3').replace(/\/$/, '');

if (!API_KEY) {
  console.warn('[warn] COINGECKO_API_KEY is missing. Add it to your .env file.');
}

// ---------- tiny in-memory cache (serves stale data if CoinGecko is down) ----------
const cache = new Map();

async function cachedFetch(key, ttlMs, url, headers = {}) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.time < ttlMs) return hit.data;

  try {
    const res = await fetch(url, { headers: { accept: 'application/json', ...headers } });
    if (!res.ok) {
      const err = new Error(
        res.status === 429
          ? 'Rate limit reached. Data will refresh in a minute.'
          : `Data provider returned ${res.status}`
      );
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    cache.set(key, { time: now, data });
    return data;
  } catch (err) {
    if (hit) return hit.data; // stale is better than nothing
    throw err;
  }
}

function coingecko(pathname, params = {}) {
  const url = new URL(BASE + pathname);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return cachedFetch(url.toString(), 60_000, url.toString(), { 'x-cg-demo-api-key': API_KEY || '' });
}

// ---------- validation helpers ----------
const CURRENCIES = new Set(['usd', 'eur', 'gbp', 'pkr', 'inr', 'aed']);
const DAYS = new Set(['1', '7', '30', '90', '365']);
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error('[api]', err.message);
    res.status(err.status === 429 ? 429 : 502).json({ error: err.message || 'Failed to load data' });
  });

// ---------- API routes ----------
app.get('/api/markets', wrap(async (req, res) => {
  const vs = String(req.query.vs || 'usd').toLowerCase();
  if (!CURRENCIES.has(vs)) return res.status(400).json({ error: 'Unsupported currency' });
  const data = await coingecko('/coins/markets', {
    vs_currency: vs,
    order: 'market_cap_desc',
    per_page: 100,
    page: 1,
    sparkline: true,
    price_change_percentage: '1h,24h,7d',
  });
  res.json(data);
}));

app.get('/api/global', wrap(async (_req, res) => {
  res.json(await coingecko('/global'));
}));

app.get('/api/trending', wrap(async (_req, res) => {
  res.json(await coingecko('/search/trending'));
}));

app.get('/api/coin/:id/chart', wrap(async (req, res) => {
  const id = String(req.params.id);
  const vs = String(req.query.vs || 'usd').toLowerCase();
  const days = String(req.query.days || '7');
  if (!/^[a-z0-9-]{1,80}$/.test(id)) return res.status(400).json({ error: 'Invalid coin id' });
  if (!CURRENCIES.has(vs) || !DAYS.has(days)) return res.status(400).json({ error: 'Invalid parameters' });
  res.json(await coingecko(`/coins/${id}/market_chart`, { vs_currency: vs, days }));
}));

// Fear & Greed index (free, no key)
app.get('/api/fng', wrap(async (_req, res) => {
  const url = 'https://api.alternative.me/fng/?limit=1';
  res.json(await cachedFetch('fng', 10 * 60_000, url));
}));

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---------- static frontend ----------
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`CoinPulse is running  ->  http://localhost:${PORT}`);
});
