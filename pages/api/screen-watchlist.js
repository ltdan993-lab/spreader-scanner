// pages/api/screen-watchlist.js
import { getSnapshot, getDailyBars, getOptionsChain } from '../../lib/alpaca'
import {
  computeHV, computeExpectedMove, computeIVRank, computeIVRVRatio,
  constructBullPutSpreads, runAllGates,
  scoreLiquidity, scoreSpreadEconomics, scoreStrikeSafety, scoreVolatilityEdge,
  computeTotalScore,
} from '../../lib/scoring'

function getWeeklyExpiries(n = 3) {
  const expiries = []
  const today = new Date()
  const day = today.getDay()
  const daysUntilFriday = (5 - day + 7) % 7 || 7
  for (let i = 0; i < n; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + daysUntilFriday + i * 7)
    expiries.push(d.toISOString().split('T')[0])
  }
  return expiries
}

function getDTE(expiryStr) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expiry = new Date(expiryStr + 'T00:00:00')
  return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24))
}

async function screenSymbol(ticker, config) {
  try {
    const snapshot = await getSnapshot(ticker)
    const stockPrice = snapshot?.latestTrade?.p ?? snapshot?.latestQuote?.ap ?? null
    if (!stockPrice) return { symbol: ticker, error: 'No stock price', passingCandidates: 0, results: [] }

    const barsData = await getDailyBars(ticker, 60)
    const closes = (barsData?.bars ?? []).map(b => b.c)
    const hv20 = computeHV(closes, 20)

    const expiries = getWeeklyExpiries(3)
    const chainData = await getOptionsChain(ticker, {
      expiration_date_gte: expiries[0],
      expiration_date_lte: expiries[expiries.length - 1],
      type: 'put',
    })

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
      const iv = snap?.impliedVolatility ?? null
      const greeks = snap?.greeks ?? {}
      return {
        symbol: ticker, optSymbol, expiry, strike,
        bid, ask, oi, volume,
        iv: iv ? iv * 100 : null,
        greeks, dte: getDTE(expiry),
      }
    }).filter(Boolean).filter(p => p.strike < stockPrice && p.bid > 0)

    if (puts.length === 0) return { symbol: ticker, error: 'No valid puts', stockPrice, passingCandidates: 0, results: [] }

    const allIVs = puts.map(p => p.iv).filter(Boolean)
    const atmPut = puts.reduce((best, p) =>
      Math.abs(p.strike - stockPrice) < Math.abs((best?.strike ?? 0) - stockPrice) ? p : best
    , puts[0])
    const currentIV = atmPut?.iv ?? (allIVs.length ? allIVs[0] : null)
    const ivRank = currentIV && allIVs.length > 5 ? computeIVRank(currentIV, allIVs) : null
    const ivRVRatio = currentIV && hv20 ? computeIVRVRatio(currentIV, hv20) : null
    const expectedMove = currentIV ? computeExpectedMove(stockPrice, currentIV, config.targetDTE ?? 3) : null

    const rawSpreads = constructBullPutSpreads(puts, stockPrice, expectedMove ?? 0, {
      minDelta: config.minDelta ?? 0.10,
      maxDelta: config.maxDelta ?? 0.20,
      minWidth: 1, maxWidth: 5,
    })

    const scored = rawSpreads.map(spread => {
      const { gates, allPass } = runAllGates(spread, stockPrice, ivRank, config)
      const liq = scoreLiquidity(spread)
      const econ = scoreSpreadEconomics(spread)
      const safety = scoreStrikeSafety(spread, ivRVRatio)
      const volEdge = scoreVolatilityEdge(ivRank, ivRVRatio)
      const total = computeTotalScore(liq, econ, safety, volEdge)
      return {
        ...spread, gates, allPass,
        scores: { liquidity: liq, economics: econ, strikeSafety: safety, volEdge, total },
        meta: { stockPrice, ivRank, ivRVRatio, hv20, currentIV, expectedMove },
      }
    })

    const passing = scored.filter(s => s.allPass).sort((a, b) => b.scores.total - a.scores.total)
    const failing = scored.filter(s => !s.allPass).sort((a, b) => b.scores.total - a.scores.total)

    return {
      symbol: ticker, stockPrice, ivRank,
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

  const limited = symbols.slice(0, 10)
  const screenResults = await Promise.allSettled(
    limited.map(symbol => screenSymbol(symbol.toUpperCase().trim(), config))
  )

  const results = screenResults
    .map((r, i) => r.status === 'fulfilled' ? r.value : { symbol: limited[i], error: 'failed', passingCandidates: 0, results: [] })

  const allSpreads = results
    .flatMap(r => (r.results ?? []).filter(s => s.allPass))
    .sort((a, b) => b.scores.total - a.scores.total)

  return res.status(200).json({
    screened: results.length,
    totalPassingCandidates: allSpreads.length,
    symbols: results.map(r => ({
      symbol: r.symbol,
      stockPrice: r.stockPrice ?? null,
      ivRank: r.ivRank ?? null,
      ivRVRatio: r.ivRVRatio ?? null,
      passingCandidates: r.passingCandidates ?? 0,
      error: r.error ?? null,
    })),
    spreads: allSpreads.slice(0, 20),
  })
}
