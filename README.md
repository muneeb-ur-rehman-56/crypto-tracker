# CoinPulse - Live Crypto Market Tracker

A professional, Binance-style crypto dashboard built for a class project.

**Stack:** HTML, CSS, Tailwind CSS, JavaScript, Node.js (Express)
**Data:** CoinGecko API (+ alternative.me Fear & Greed index)

## Features
- Live ticker, auto-refresh every 60 seconds (with countdown and manual refresh)
- Global market stats: market cap, 24h volume, Bitcoin dominance, Fear & Greed
- Market heatmap (tile size = market cap, colour = 24h change)
- Top gainers, top losers and trending coins
- Top 100 coins table: search, sort, filter, pagination, 7-day sparklines
- Coin details popup with interactive price chart (24H / 7D / 30D / 90D / 1Y)
- Watchlist (saved in the browser), currency switch (USD, EUR, GBP, PKR, INR, AED)
- Dark and light theme, fully responsive

## How to run
1. Install Node.js 18 or newer: https://nodejs.org
2. Open a terminal in this folder and run:

```bash
npm install
npm start
```

3. Open http://localhost:3000

The API key is already in the `.env` file. If you ever need to change it, edit
`COINGECKO_API_KEY` there. (Use `.env.example` as a template.)

## Project structure
```
crypto-tracker/
|-- server.js            Express server + CoinGecko proxy + 60s cache
|-- package.json
|-- .env                 API key and port (never upload this to GitHub)
|-- public/
    |-- index.html       Page structure (Tailwind classes)
    |-- css/styles.css   Theme colours and components
    |-- js/app.js        Fetching data, heatmap, table, charts
```

## How it works
The browser never talks to CoinGecko directly. It calls our own endpoints
(`/api/markets`, `/api/global`, `/api/trending`, `/api/coin/:id/chart`, `/api/fng`).
The Node server adds the secret API key, fetches the data, and caches it for
60 seconds. This keeps the key private and protects the free-plan rate limit.

## Notes
- Tailwind is loaded from its CDN, so there is no build step. The page needs internet access for Tailwind, Google Fonts, Chart.js and the live data.
- The free CoinGecko Demo plan has a rate limit. If you see a "Rate limit" message, wait a minute and it recovers on its own.
- Data attribution: "Powered by CoinGecko" is shown in the footer as required by the API terms.
