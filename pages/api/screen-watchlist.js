// pages/api/screen-watchlist.js
import {
  computeHV, computeExpectedMove, computeIVRank, computeIVRVRatio,
  constructBullPutSpreads, runAllGates,
  scoreLiquidity, scoreSpreadEconomics, scoreStrikeSafety, scoreVolatilityEdge,
  computeTotalScore,
} from '../../lib/scoring'

const BASE = 'https://api.polygon.io'
const KEY = () => process.env.POLYGON_API_KEY

async function getStockSnapshot(symbol) {
  const res = await fetch(
    `${BASE}/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}?apiKey=${KEY()}`
  )
  if (!res.ok) throw new Error(`Stock snapshot failed for ${symbol}: ${res.status}`)
  const data = await res.json()
  return data?.ticker?.day?.c
    ?? data?.ticker?.lastTrade?.p
    ?? data?.ticker?.prevDay?.c
    ?? null
}

async function getDailyBars(symbol) {
  const end = new Date().toISOString().split('T')[0]
  const start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const res = await fetch(
    `${BASE}/v2/aggs/ticker/${symbol}/range/1/day/${start}/${end}?adjusted=true&sort=asc&limit=90&apiKey=${KEY()}`
  )
  if (!res.ok) throw new Error(`Bars failed for ${symbol}: ${res.status}`)
  const data = await res.json()
  return (data?.results ?? []).map(b => b.c)
}

async function getOptionsChain(symbol, expGte, expLte, strikeLte) {
  const qs = new URLSearchParams({
    contract_type: 'put',
    expiration_date_gte: expGte,
    expiration_date_lte: expLte,
    strike_price_lte: strikeLte,
    limit: 250,
    apiKey: KEY(),
  }).toString()
  const res = await fetch(`${BASE}/v3/snapshot/options/${symbol}?${qs}`)
  if (!res.ok) throw new Error(`Options chain failed for ${symbol}: ${res.status}`)
  const data = await res.json()
  return data?.results ?? []
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

async function screenSymbol(ticker, config) {
  try {
    const stockPrice = await getStockSnapshot(ticker)
    if (!stockPrice) return { symbol: ticker, error: 'No stock price', passingCandidates: 0, results: [] }

    const closes = await getDailyBars(ticker)
    const hv20 = computeHV(closes, 20)

    const expiries = getWeeklyExpiries(3)
    const contracts = await getOptionsChain(
      ticker,
      expiries[0],
      expiries[expiries.length - 1],
      stockPrice * 1.02
    )

    if (contracts.length === 0) {
      return { symbol: ticker, error: 'No options contracts returned', stockPrice, passingCandidates: 0, results: [] }
    }

    // Use day.close as price proxy since Options Basic doesn't include live quotes
    const puts = contracts
      .filter(c => {
        const strike = c.details?.strike_price ?? 0
        const price = (c.day?.close > 0 ? c.day.close : null) ?? (c.day?.vwap > 0 ? c.day.vwap : null) ?? 0
        const dte = getDTE(c.details?.expiration_date ?? '')
        return strike < stockPrice && price > 0 && dte >= (config.minDTE ?? 2)
      })
      .map(c => {
        const price = c.day?.close ?? c.day?.vwap ?? 0
        // IV from Polygon is already in decimal form (0.25 = 25%)
        const iv = c.implied_volatility ? parseFloat((c.implied_volatility * 100).toFixed(2)) : null
        return {
          symbol: ticker,
          optSymbol: c.details?.ticker ?? '',
          expiry: c.details?.expiration_date ?? '',
          strike: c.details?.strike_price ?? 0,
          bid: price * 0.95,
          ask: price * 1.05,
          oi: c.open_interest ?? 0,
          volume: c.day?.volume ?? 0,
          iv,
          greeks: {
            delta: c.greeks?.delta ?? null,
            gamma: c.greeks?.gamma ?? null,
            theta: c.greeks?.theta ?? null,
            vega: c.greeks?.vega ?? null,
          },
          dte: getDTE(c.details?.expiration_date ?? ''),
        }
      })

    if (puts.length === 0) {
      return { symbol: ticker, error: 'No valid puts after filter', stockPrice, passingCandidates: 0, results: [] }
    }

    const allIVs = puts.map(p => p.iv).filter(Boolean)
    const atmPut = puts.reduce((best, p) =>
      Math.abs(p.strike - stockPrice) < Math.abs((best?.strike ?? 0) - stockPrice) ? p : best
    , puts[0])
    const currentIV = atmPut?.iv ?? null
    const ivRank = currentIV && allIVs.length > 5 ? computeIVRank(currentIV, allIVs) : null
    const ivRVRatio = currentIV && hv20 ? computeIVRVRatio(currentIV, hv20) : null
    const expectedMove = currentIV
      ? computeExpectedMove(stockPrice, currentIV, config.targetDTE ?? 3)
      : stockPrice * 0.02

    const rawSpreads = constructBullPutSpreads(puts, stockPrice, expectedMove, {
      minDelta: config.minDelta ?? 0.10,
      maxDelta: config.maxDelta ?? 0.20,
      minWidth: 1,
      maxWidth: 5,
    })

    const relaxedConfig = { ...config, maxBidAsk: 999, minIVRank: 0 }

    const scored = rawSpreads.map(spread => {
      const { gates, allPass } = runAllGates(spread, stockPrice, ivRank, relaxedConfig)
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
      hv20: hv20 ? parseFloat(hv20.toFixed(1)) : null,
      currentIV,
      passingCandidates: passing.length,
      results: [...passing, ...failing].slice(0, 10),
    }
  } catch (err) {
    console.error(`screenSymbol error for ${ticker}:`, err.message)
    return { symbol: ticker, error: err.message, passingCandidates: 0, results: [] }
  }
}
