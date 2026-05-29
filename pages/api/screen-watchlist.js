// Latest stock price — uses previous close which is free tier compatible
export async function getStockSnapshot(symbol) {
  const res = await fetch(
    `${BASE}/v2/aggs/ticker/${symbol}/prev?adjusted=true&apiKey=${key()}`
  )
  if (!res.ok) throw new Error(`Stock snapshot failed for ${symbol}: ${res.status}`)
  return res.json()
}
function getDTE(expiryStr) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expiry = new Date(expiryStr + 'T00:00:00')
  return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24))
}

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

async function screenSymbol(ticker, config) {
  try {
    // ── 1. Stock price ─────────────────────────────────────────────────────
    const snapData = await getStockSnapshot(ticker)
    const stockPrice = snapData?.ticker?.day?.c
      ?? snapData?.ticker?.lastTrade?.p
      ?? snapData?.ticker?.prevDay?.c
      ?? null
    if (!stockPrice) return { symbol: ticker, error: 'No stock price', passingCandidates: 0, results: [] }

    // ── 2. Historical bars for HV ──────────────────────────────────────────
    const barsData = await getDailyBars(ticker, 60)
    const closes = (barsData?.results ?? []).map(b => b.c)
    const hv20 = computeHV(closes, 20)

    // ── 3. Options chain ───────────────────────────────────────────────────
    const expiries = getWeeklyExpiries(3)
    const chainData = await getOptionsChain(ticker, {
      expiration_date_gte: expiries[0],
      expiration_date_lte: expiries[expiries.length - 1],
      strike_lte: stockPrice * 1.05,
    })

    const contracts = chainData?.results ?? []
    if (contracts.length === 0) {
      return { symbol: ticker, error: 'No options contracts found', stockPrice, passingCandidates: 0, results: [] }
    }

    // ── 4. Parse into normalized format ───────────────────────────────────
    const puts = contracts
      .filter(c => c.details?.contract_type === 'put' && c.details?.strike_price < stockPrice)
      .map(c => {
        const bid = c.last_quote?.bid ?? 0
        const ask = c.last_quote?.ask ?? 0
        const iv = c.implied_volatility ? c.implied_volatility * 100 : null
        return {
          symbol: ticker,
          optSymbol: c.details?.ticker ?? '',
          expiry: c.details?.expiration_date ?? '',
          strike: c.details?.strike_price ?? 0,
          bid,
          ask,
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
      .filter(p => p.bid > 0 && p.dte >= (config.minDTE ?? 2))

    if (puts.length === 0) {
      return { symbol: ticker, error: 'No valid puts after filter', stockPrice, passingCandidates: 0, results: [] }
    }

    // ── 5. IV rank + ratios ────────────────────────────────────────────────
    const allIVs = puts.map(p => p.iv).filter(Boolean)
    const atmPut = puts.reduce((best, p) =>
      Math.abs(p.strike - stockPrice) < Math.abs((best?.strike ?? 0) - stockPrice) ? p : best
    , puts[0])
    const currentIV = atmPut?.iv ?? (allIVs.length ? allIVs[0] : null)
    const ivRank = currentIV && allIVs.length > 5 ? computeIVRank(currentIV, allIVs) : null
    const ivRVRatio = currentIV && hv20 ? computeIVRVRatio(currentIV, hv20) : null
    const expectedMove = currentIV ? computeExpectedMove(stockPrice, currentIV, config.targetDTE ?? 3) : null

    // ── 6. Construct + score spreads ───────────────────────────────────────
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
