// lib/alpaca.js
// All Alpaca calls go through here — never expose keys to the client

const ALPACA_DATA_BASE = 'https://data.alpaca.markets/v2'
const ALPACA_OPTIONS_BASE = 'https://data.alpaca.markets/v1beta1'

function headers() {
  return {
    'APCA-API-KEY-ID': process.env.ALPACA_KEY_ID,
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
    'Content-Type': 'application/json',
  }
}

// Latest quote for a stock
export async function getStockQuote(symbol) {
  const res = await fetch(
    `${ALPACA_DATA_BASE}/stocks/${symbol}/quotes/latest`,
    { headers: headers() }
  )
  if (!res.ok) throw new Error(`Quote fetch failed for ${symbol}: ${res.status}`)
  return res.json()
}

// Daily bars for HV calculation (last 30 trading days)
export async function getDailyBars(symbol, limit = 30) {
  const res = await fetch(
    `${ALPACA_DATA_BASE}/stocks/${symbol}/bars?timeframe=1Day&limit=${limit}&adjustment=split`,
    { headers: headers() }
  )
  if (!res.ok) throw new Error(`Bars fetch failed for ${symbol}: ${res.status}`)
  return res.json()
}

// Snapshot — gives latest trade, quote, minute bar, daily bar, prev daily bar
export async function getSnapshot(symbol) {
  const res = await fetch(
    `${ALPACA_DATA_BASE}/stocks/${symbol}/snapshot`,
    { headers: headers() }
  )
  if (!res.ok) throw new Error(`Snapshot fetch failed for ${symbol}: ${res.status}`)
  return res.json()
}

// Options chain for a symbol
// expiration_date_gte / lte in YYYY-MM-DD format
export async function getOptionsChain(symbol, params = {}) {
  const qs = new URLSearchParams({
    underlying_symbols: symbol,
    limit: 100,
    ...params,
  }).toString()

  const res = await fetch(
    ``${ALPACA_OPTIONS_BASE}/options/snapshots?${qs}`
    { headers: headers() }
  )
  if (!res.ok) throw new Error(`Options chain failed for ${symbol}: ${res.status}`)
  return res.json()
}

// Options bars — used for IV history approximation
export async function getOptionsBars(optionSymbol, limit = 10) {
  const res = await fetch(
    `${ALPACA_DATA_BASE}/options/${optionSymbol}/bars?timeframe=1Day&limit=${limit}`,
    { headers: headers() }
  )
  if (!res.ok) throw new Error(`Options bars failed for ${optionSymbol}: ${res.status}`)
  return res.json()
}
