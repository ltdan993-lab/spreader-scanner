// pages/api/screen-watchlist.js
// Alpaca indicative feed — IV rank gate removed, greeks-based filtering

import {
  computeExpectedMove, computeIVRVRatio,
  constructBullPutSpreads, runAllGates,
  scoreLiquidity, scoreSpreadEconomics, scoreStrikeSafety, scoreVolatilityEdge,
  computeTotalScore,
} from '../../lib/scoring'

const ALPACA_BASE = 'https://data.alpaca.markets'

function alpacaHeaders() {
  return {
    'APCA-API-KEY-ID': process.env.ALPACA_KEY_ID,
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
    'Content-Type': 'application/json',
  }
}

async function getStockPrice(symbol) {
  const res = await fetch(
    `${ALPACA_BASE}/v2/stocks/${symbol}/snapshot`,
    { headers: alpacaHeaders() }
  )
  if (!res.ok) throw new Error(`Snapshot failed for ${symbol}: ${res.status}`)
  const data = await res.json()
  return data?.latestTrade?.p ?? data?.latestQuote?.ap ?? null
}

async function getDailyBars(symbol) {
  const res = await fetch(
    `${ALPACA_BASE}/v2/stocks/${symbol}/bars?timeframe=1Day&limit=60&adjustment=split`,
    { headers: alpacaHeaders() }
  )
  if (!res.ok) throw new Error(`Bars failed for ${symbol}: ${res.status}`)
  const data = await res.json()
  return (data?.bars ?? []).map(b => b.c)
}

async function getOptionsChain(symbol, expGte, expLte) {
  const qs = new URLSearchParams({
    expiration_date_gte: expGte,
    expiration_date_lte: expLte,
    type: 'put',
    limit: 200,
    feed: 'indicative',
  }).toString()
  const res = await fetch(
    `${ALPACA_BASE}/v1beta1/options/snapshots/${symbol}?${qs}`,
    { headers: alpacaHeaders() }
  )
  if (!res.ok) throw new Error(`Options chain failed for ${symbol}: ${res.status}`)
  return res.json()
}
function getDTE(expiryStr) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((new Date(expiryStr + 'T00:00:00') - today) / (1000 * 60 * 60 * 24))
}

function getWeeklyExpiries(n = 3) {
  const expiries = []
  const today = new Date()
  const daysUntilFriday = (5 - today.getDay() + 7) % 7 || 7
  for (let i = 0; i < n; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + daysUntilFriday + i * 7)
    expiries.push(d.toISOString().split('T')[0])
  }
  return expiries
}

function computeHV(closes, window = 20) {
  if (closes.length < window + 1) return null
  const recent = closes.slice(-window - 1)
  const returns = []
  for (let i = 1; i < recent.length; i++) {
    returns.push(Math.log(recent[i] / recent[i - 1]))
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (returns.length - 1)
  return Math.sqrt(variance * 252) * 100
}

async function screenSymbol(ticker, config) {
  try {
    const stockPrice = await getStockPrice(ticker)
    if (!stockPrice) return { symbol: ticker, error: 'No stock price', passingCandidates: 0, results: [] }

    const closes = await getDailyBars(ticker)
    const hv20 = computeHV(closes, 20)

    const expiries = getWeeklyExpiries(3)
    const chainData = await getOptionsChain(ticker, expiries[0], expiries[expiries.length - 1])
    const snapshots = chainData?.snapshots ?? {}

    const puts = Object.entries(snapshots).map(([optSymbol, snap]) => {
      const parts = optSymbol.match(/([A-Z]+)(\d{6})([CP])(\d{8})/)
      if (!parts) return null
      const expiry = `20${parts[2].slice(0,2)}-${parts[2].slice(2,4)}-${parts[2].slice(4,6)}`
      const strike = parseInt(parts[4]) / 1000
      const bid = snap?.latestQuote?.bp ?? 0
      const ask = snap?.latestQuote?.ap ?? 0
      const oi = snap?.dailyBar?.v ?? 0
      const volume = snap?.minuteBar?.v ?? 0
      const iv = snap?.impliedVolatility ? snap.impliedVolatility * 100 : null
      const greeks = snap?.greeks ?? {}
      return {
        symbol: ticker, optSymbol, expiry, strike,
        bid, ask, oi, volume, iv,
        greeks, dte: getDTE(expiry),
      }
    }).filter(Boolean).filter(p => p.strike < stockPrice && p.bid > 0 && p.dte >= (config.minDTE ?? 2))

    const totalContracts = Object.keys(snapshots).length
const withBid = puts.filter(p => p.bid > 0).length
const belowSpot = puts.filter(p => p.strike < stockPrice).length
if (puts.length === 0) return { 
  symbol: ticker, 
  error: `No valid puts — total:${totalContracts} belowSpot:${belowSpot} withBid:${withBid}`, 
  stockPrice, passingCandidates: 0, results: [] 
}
    const atmPut = puts.reduce((best, p) =>
      Math.abs(p.strike - stockPrice) < Math.abs((best?.strike ?? 0) - stockPrice) ? p : best
    , puts[0])
    const currentIV = atmPut?.iv ?? null
    const ivRVRatio = currentIV && hv20 ? computeIVRVRatio(currentIV, hv20) : null
    const expectedMove = currentIV
      ? computeExpectedMove(stockPrice, currentIV, config.targetDTE ?? 3)
      : stockPrice * 0.02 // fallback: assume 2% move if no IV

    const rawSpreads = constructBullPutSpreads(puts, stockPrice, expectedMove, {
      minDelta: config.minDelta ?? 0.10,
      maxDelta: config.maxDelta ?? 0.20,
      minWidth: 1, maxWidth: 5,
    })

    // Run gates with IV rank disabled (pass: true always)
    const scored = rawSpreads.map(spread => {
      const { gates, allPass } = runAllGates(spread, stockPrice, 100, {
        ...config,
        minIVRank: 0, // disable IV rank gate
      })
      const liq = scoreLiquidity(spread)
      const econ = scoreSpreadEconomics(spread)
      const safety = scoreStrikeSafety(spread, ivRVRatio)
      const volEdge = scoreVolatilityEdge(null, ivRVRatio) // no IV rank
      const total = computeTotalScore(liq, econ, safety, volEdge)
      return {
        ...spread, gates, allPass,
        scores: { liquidity: liq, economics: econ, strikeSafety: safety, volEdge, total },
        meta: { stockPrice, ivRank: null, ivRVRatio, hv20, currentIV, expectedMove },
      }
    })

    const passing = scored.filter(s => s.allPass).sort((a, b) => b.scores.total - a.scores.total)
    const failing = scored.filter(s => !s.allPass).sort((a, b) => b.scores.total - a.scores.total)

    return {
  symbol: ticker, stockPrice, ivRank: null,
  debug: { putsFound: puts.length, spreadsConstructed: rawSpreads.length, passing: passing.length },
      ivRVRatio: ivRVRatio ? parseFloat(ivRVRatio.toFixed(2)) : null,
      passingCandidates: passing.length,
      results: [...passing, ...failing].slice(0, 10),
    }
  } catch (err) {
    console.error(`screenSymbol error for ${ticker}:`, err.message)
    return { symbol: ticker, error: err.message, passingCandidates: 0, results: [] }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { symbols = [], config = {} } = req.body
  if (!symbols.length) return res.status(400).json({ error: 'symbols array required' })

  // Sequential to avoid rate limits
  const limited = symbols.slice(0, 8)
  const results = []
  for (const symbol of limited) {
    const result = await screenSymbol(symbol.toUpperCase().trim(), config)
    results.push(result)
    await new Promise(r => setTimeout(r, 300))
  }

  const allSpreads = results
    .flatMap(r => (r.results ?? []).filter(s => s.allPass))
    .sort((a, b) => b.scores.total - a.scores.total)

  return res.status(200).json({
    screened: results.length,
    totalPassingCandidates: allSpreads.length,
    symbols: results.map(r => ({
      symbol: r.symbol,
      stockPrice: r.stockPrice ?? null,
      ivRank: null,
      ivRVRatio: r.ivRVRatio ?? null,
      passingCandidates: r.passingCandidates ?? 0,
      error: r.error ?? null,
    })),
    spreads: allSpreads.slice(0, 20),
  })
}
