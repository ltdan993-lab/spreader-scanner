// pages/api/screen.js
// Serverless function — Alpaca keys never leave the server

import {
  getSnapshot,
  getDailyBars,
  getOptionsChain,
} from '../../lib/alpaca'

import {
  computeHV,
  computeExpectedMove,
  computeIVRank,
  computeIVRVRatio,
  constructBullPutSpreads,
  runAllGates,
  scoreLiquidity,
  scoreSpreadEconomics,
  scoreStrikeSafety,
  scoreVolatilityEdge,
  computeTotalScore,
} from '../../lib/scoring'

// Get next N weekly expiration dates (Fridays)
function getWeeklyExpiries(n = 3) {
  const expiries = []
  const today = new Date()
  const day = today.getDay()
  // Days until next Friday
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
  const expiry = new Date(expiryStr)
  const diff = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24))
  return diff
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { symbol, config = {} } = req.body
  if (!symbol) return res.status(400).json({ error: 'symbol required' })

  const ticker = symbol.toUpperCase().trim()

  try {
    // ── 1. Stock snapshot ──────────────────────────────────────────────────
    const snapshot = await getSnapshot(ticker)
    const stockPrice = snapshot?.latestTrade?.p ?? snapshot?.latestQuote?.ap ?? null
    if (!stockPrice) return res.status(200).json({ symbol: ticker, error: 'No stock price available' })

    // ── 2. Historical bars for HV ──────────────────────────────────────────
    const barsData = await getDailyBars(ticker, 60)
    const bars = barsData?.bars ?? []
    const closes = bars.map(b => b.c)
    const hv20 = computeHV(closes, 20)

    // ── 3. Options chain ───────────────────────────────────────────────────
    const expiries = getWeeklyExpiries(3)
    const expiryGte = expiries[0]
    const expiryLte = expiries[expiries.length - 1]

    const chainData = await getOptionsChain(ticker, {
      expiration_date_gte: expiryGte,
      expiration_date_lte: expiryLte,
      type: 'put',
      limit: 200,
    })

    const snapshots = chainData?.snapshots ?? {}

    // Parse options into usable format
    const puts = Object.entries(snapshots).map(([optSymbol, snap]) => {
      const parts = optSymbol.match(/([A-Z]+)(\d{6})([CP])(\d{8})/)
      if (!parts) return null
      const expiry = `20${parts[2].slice(0, 2)}-${parts[2].slice(2, 4)}-${parts[2].slice(4, 6)}`
      const strike = parseInt(parts[4]) / 1000
      const bid = snap?.latestQuote?.bp ?? 0
      const ask = snap?.latestQuote?.ap ?? 0
      const oi = snap?.dailyBar?.v ?? 0
      const volume = snap?.minuteBar?.v ?? 0
      const iv = snap?.impliedVolatility ?? null
      const greeks = snap?.greeks ?? {}
      return {
        symbol: ticker,
        optSymbol,
        expiry,
        strike,
        bid,
        ask,
        oi,
        volume,
        iv: iv ? iv * 100 : null,
        greeks,
        dte: getDTE(expiry),
      }
    }).filter(Boolean).filter(p => p.strike < stockPrice && p.bid > 0)

    if (puts.length === 0) {
      return res.status(200).json({ symbol: ticker, error: 'No valid put options found', stockPrice })
    }

    // ── 4. IV rank from chain ──────────────────────────────────────────────
    const allIVs = puts.map(p => p.iv).filter(Boolean)
    const atmPut = puts.reduce((best, p) =>
      Math.abs(p.strike - stockPrice) < Math.abs(best.strike - stockPrice) ? p : best
    )
    const currentIV = atmPut?.iv ?? (allIVs.length ? allIVs[0] : null)
    const ivRank = currentIV && allIVs.length > 5 ? computeIVRank(currentIV, allIVs) : null
    const ivRVRatio = currentIV && hv20 ? computeIVRVRatio(currentIV, hv20) : null

    // ── 5. Expected move ───────────────────────────────────────────────────
    const dte = config.targetDTE ?? 3
    const expectedMove = currentIV ? computeExpectedMove(stockPrice, currentIV, dte) : null

    // ── 6. Construct spreads ───────────────────────────────────────────────
    const rawSpreads = constructBullPutSpreads(puts, stockPrice, expectedMove ?? 0, {
      minDelta: config.minDelta ?? 0.10,
      maxDelta: config.maxDelta ?? 0.20,
      minWidth: 1,
      maxWidth: 5,
    })

    // ── 7. Gate + score each spread ────────────────────────────────────────
    const scored = rawSpreads.map(spread => {
      const { gates, allPass } = runAllGates(spread, stockPrice, ivRank, config)

      const liq = scoreLiquidity(spread)
      const econ = scoreSpreadEconomics(spread)
      const safety = scoreStrikeSafety(spread, ivRVRatio)
      const volEdge = scoreVolatilityEdge(ivRank, ivRVRatio)
      const total = computeTotalScore(liq, econ, safety, volEdge)

      return {
        ...spread,
        gates,
        allPass,
        scores: { liquidity: liq, economics: econ, strikeSafety: safety, volEdge, total },
        meta: { stockPrice, ivRank, ivRVRatio, hv20, currentIV, expectedMove },
      }
    })

    // Sort: passing spreads by total score desc, then failing ones
    const passing = scored.filter(s => s.allPass).sort((a, b) => b.scores.total - a.scores.total)
    const failing = scored.filter(s => !s.allPass).sort((a, b) => b.scores.total - a.scores.total)
    const results = [...passing, ...failing].slice(0, 10)

    return res.status(200).json({
      symbol: ticker,
      stockPrice,
      ivRank,
      ivRVRatio: ivRVRatio ? parseFloat(ivRVRatio.toFixed(2)) : null,
      hv20: hv20 ? parseFloat(hv20.toFixed(1)) : null,
      currentIV: currentIV ? parseFloat(currentIV.toFixed(1)) : null,
      expectedMove: expectedMove ? parseFloat(expectedMove.toFixed(2)) : null,
      totalCandidates: rawSpreads.length,
      passingCandidates: passing.length,
      results,
    })

  } catch (err) {
    console.error(`Screen error for ${ticker}:`, err)
    return res.status(500).json({ symbol: ticker, error: err.message })
  }
}
