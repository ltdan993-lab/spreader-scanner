# Spread Screener

A real-time bull put credit spread screener built with Next.js, deployable to Vercel.

## What it does

- Screens a watchlist of tickers for bull put spread opportunities
- Applies hard gates first: IV rank, bid/ask width, dist/EM buffer, credit/width ratio, OI/volume
- Scores surviving candidates on liquidity, spread economics, strike safety, and volatility edge
- Flags 50% profit target exit level on every spread
- Conservative / Balanced / Aggressive filter presets
- Click any row to expand full gate results and score breakdown

## Stack

- **Frontend**: Next.js + React + Tailwind CSS
- **Backend**: Vercel serverless API routes (Alpaca keys never exposed to client)
- **Data**: Alpaca Market Data API (options chains, stock snapshots, historical bars)

## Deploy to Vercel

### 1. Get Alpaca API keys
1. Sign up at [alpaca.markets](https://alpaca.markets)
2. Create a **paper trading** account
3. Go to **API Keys** and generate a key pair
4. Alpaca's paper account includes market data access

### 2. Deploy
```bash
# Clone or download this repo
npm install
```

Option A — Vercel CLI:
```bash
npm i -g vercel
vercel
```

Option B — GitHub:
1. Push to a GitHub repo
2. Go to [vercel.com](https://vercel.com) → New Project → import your repo
3. Vercel auto-detects Next.js

### 3. Add environment variables
In Vercel dashboard → Settings → Environment Variables, add:

| Name | Value |
|------|-------|
| `ALPACA_KEY_ID` | Your Alpaca key ID |
| `ALPACA_SECRET_KEY` | Your Alpaca secret key |

For local development, copy `.env.local.example` to `.env.local` and fill in your keys.

```bash
cp .env.local.example .env.local
# edit .env.local with your keys
npm run dev
```

## Architecture

```
pages/
  index.jsx              — Main screener UI
  api/
    screen.js            — Single ticker screener (Alpaca calls live here)
    screen-watchlist.js  — Parallel multi-ticker wrapper

components/
  SpreadRow.jsx          — Expandable table row with score breakdown
  ScoreBars.jsx          — Score decomposition sparkline
  GateBadges.jsx         — Gate pass/fail badges
  FilterPanel.jsx        — Config sliders + mode presets

lib/
  alpaca.js              — Alpaca API client (server-side only)
  scoring.js             — All gate logic and scoring (pure functions)
```

## Roadmap (v2+)

- [ ] Earnings calendar gate (SEC EDGAR or Nasdaq feed)
- [ ] Bear call spread side
- [ ] Short interest gate (FINRA data)
- [ ] Position tracker with 50% target alerts
- [ ] Backtest mode with OptionMetrics data
- [ ] Export to CSV

## Notes

- Options data requires Alpaca's **Options Data** subscription (included with paper accounts)
- IV rank is approximated from the current options chain, not a full 52-week IV history
- All data is from Alpaca's paper/sandbox environment — verify fills with your live broker
- This is not financial advice
