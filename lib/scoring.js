// lib/scoring.js
// All gate logic and scoring — pure functions, no API calls

// ─── HARD GATES ───────────────────────────────────────────────────────────────

export function gateMinPrice(stockPrice, min = 20) {
  return { pass: stockPrice >= min, value: stockPrice, threshold: min, label: 'Min price' }
}

export function gateIVRank(ivRank, min = 30) {
  return { pass: ivRank >= min, value: ivRank, threshold: min, label: 'IV rank' }
}

export function gateBidAskWidth(bidAskPct, max = 0.10) {
  return { pass: bidAskPct <= max, value: bidAskPct, threshold: max, label: 'Bid/ask width' }
}

export function gateLiquidity(oi, volume, minOI = 1000, minVol = 250) {
  const pass = oi >= minOI && volume >= minVol
  return { pass, value: { oi, volume }, threshold: { minOI, minVol }, label: 'Liquidity' }
}

export function gateExpectedMoveBuffer(distToShort, expectedMove, minRatio = 1.0) {
  const ratio = expectedMove > 0 ? distToShort / expectedMove : 0
  return { pass: ratio >= minRatio, value: ratio, threshold: minRatio, label: 'Dist/EM buffer' }
}

export function gateCreditWidth(creditWidthRatio, min = 0.18) {
  return { pass: creditWidthRatio >= min, value: creditWidthRatio, threshold: min, label: 'Credit/width' }
}

export function gateDTE(dte, min = 2, max = 4) {
  return { pass: dte >= min && dte <= max, value: dte, threshold: { min, max }, label: 'DTE' }
}

// ─── CALCULATIONS ─────────────────────────────────────────────────────────────

export function computeHV(closes, window = 20) {
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

export function computeExpectedMove(stockPrice, iv, dte) {
  return stockPrice * (iv / 100) * Math.sqrt(dte / 365)
}

export function computeIVRank(currentIV, ivHistory) {
  if (!ivHistory || ivHistory.length === 0) return null
  const low = Math.min(...ivHistory)
  const high = Math.max(...ivHistory)
  if (high === low) return 50
  return Math.round(((currentIV - low) / (high - low)) * 100)
}

export function computeIVRVRatio(currentIV, hv20) {
  if (!hv20 || hv20 === 0) return null
  return currentIV / hv20
}

export function computeStraddleEM(callMid, putMid) {
  return callMid + putMid
}

// ─── SPREAD CONSTRUCTION ──────────────────────────────────────────────────────

export function constructBullPutSpreads(puts, stockPrice, expectedMove, config) {
  const { minDelta = 0.10, maxDelta = 0.20, minWidth = 1, maxWidth = 5 } = config
  const spreads = []

  const shortLegs = puts.filter(p => {
    const absDelta = Math.abs(p.greeks?.delta ?? 0)
    return absDelta >= minDelta && absDelta <= maxDelta && p.strike < stockPrice
  })

  shortLegs.forEach(shortLeg => {
    const longLegs = puts.filter(p =>
      p.strike < shortLeg.strike &&
      p.expiry === shortLeg.expiry &&
      shortLeg.strike - p.strike >= minWidth &&
      shortLeg.strike - p.strike <= maxWidth
    )

    longLegs.forEach(longLeg => {
      const width = shortLeg.strike - longLeg.strike
      const shortMid = (shortLeg.bid + shortLeg.ask) / 2
      const longMid = (longLeg.bid + longLeg.ask) / 2
      const credit = shortMid - longMid
      if (credit <= 0) return

      const creditWidthRatio = credit / width
      const maxLoss = width - credit
      const breakeven = shortLeg.strike - credit
      const distToShort = stockPrice - shortLeg.strike
      const emRatio = expectedMove > 0 ? distToShort / expectedMove : 0
      const shortBidAskPct = shortLeg.ask > 0
        ? (shortLeg.ask - shortLeg.bid) / ((shortLeg.ask + shortLeg.bid) / 2)
        : 1
      const profitTarget50 = credit * 0.5
      const returnOnRisk = maxLoss > 0 ? (credit / maxLoss) * 100 : 0

      spreads.push({
        symbol: shortLeg.symbol,
        expiry: shortLeg.expiry,
        dte: shortLeg.dte,
        shortStrike: shortLeg.strike,
        longStrike: longLeg.strike,
        width,
        credit: parseFloat(credit.toFixed(2)),
        creditWidthRatio: parseFloat(creditWidthRatio.toFixed(3)),
        maxLoss: parseFloat(maxLoss.toFixed(2)),
        breakeven: parseFloat(breakeven.toFixed(2)),
        distToShort: parseFloat(distToShort.toFixed(2)),
        emRatio: parseFloat(emRatio.toFixed(2)),
        shortDelta: Math.abs(shortLeg.greeks?.delta ?? 0),
        shortIV: shortLeg.iv,
        shortOI: shortLeg.oi,
        shortVol: shortLeg.volume,
        shortBidAskPct: parseFloat(shortBidAskPct.toFixed(3)),
        profitTarget50: parseFloat(profitTarget50.toFixed(2)),
        returnOnRisk: parseFloat(returnOnRisk.toFixed(1)),
      })
    })
  })

  return spreads
}

// ─── SCORING ──────────────────────────────────────────────────────────────────

export function scoreLiquidity(spread) {
  const oiScore = Math.min(spread.shortOI / 5000, 1)
  const volScore = Math.min(spread.shortVol / 1000, 1)
  const widthScore = Math.max(0, 1 - spread.shortBidAskPct / 0.15)
  return parseFloat(((oiScore * 0.40 + volScore * 0.35 + widthScore * 0.25) * 100).toFixed(1))
}

export function scoreSpreadEconomics(spread) {
  const cwScore = Math.min(Math.max((spread.creditWidthRatio - 0.12) / 0.23, 0), 1)
  const rorScore = Math.min(spread.returnOnRisk / 30, 1)
  return parseFloat(((cwScore * 0.50 + rorScore * 0.50) * 100).toFixed(1))
}

export function scoreStrikeSafety(spread, ivRVRatio) {
  const deltaScore = Math.max(0, 1 - spread.shortDelta / 0.25)
  const emScore = Math.min(Math.max((spread.emRatio - 0.85) / 0.65, 0), 1)
  const ivrvScore = ivRVRatio ? Math.min(Math.max((ivRVRatio - 0.9) / 0.9, 0), 1) : 0.5
  return parseFloat(((deltaScore * 0.40 + emScore * 0.40 + ivrvScore * 0.20) * 100).toFixed(1))
}

export function scoreVolatilityEdge(ivRank, ivRVRatio) {
  const rankScore = ivRank != null ? Math.min(ivRank / 80, 1) : 0.5
  const ivrvScore = ivRVRatio ? Math.min(Math.max((ivRVRatio - 1.0) / 0.8, 0), 1) : 0
  return parseFloat(((rankScore * 0.55 + ivrvScore * 0.45) * 100).toFixed(1))
}

export function computeTotalScore(liquidity, economics, strikeSafety, volEdge) {
  return Math.round(
    liquidity * 0.30 +
    economics * 0.20 +
    strikeSafety * 0.25 +
    volEdge * 0.25
  )
}

export function runAllGates(spread, stockPrice, ivRank, config = {}) {
  const gates = [
    gateDTE(spread.dte, config.minDTE ?? 2, config.maxDTE ?? 4),
    gateMinPrice(stockPrice, config.minPrice ?? 20),
    gateBidAskWidth(spread.shortBidAskPct, config.maxBidAsk ?? 0.10),
    gateLiquidity(spread.shortOI, spread.shortVol, config.minOI ?? 1000, config.minVol ?? 250),
    gateCreditWidth(spread.creditWidthRatio, config.minCreditWidth ?? 0.18),
    gateExpectedMoveBuffer(spread.distToShort, spread.distToShort / (spread.emRatio || 1), config.minEMBuffer ?? 1.0),
  ]
  const allPass = gates.every(g => g.pass)
  return { gates, allPass }
}
