// lib/polygon.js
const BASE = 'https://api.polygon.io'

function key() {
  return process.env.POLYGON_API_KEY
}

// Latest stock price — free tier compatible
export async function getStockSnapshot(symbol) {
  const res = await fetch(
    `${BASE}/v2/aggs/ticker/${symbol}/prev?adjusted=true&apiKey=${key()}`
  )
  if (!res.ok) throw new Error(`Stock snapshot failed for ${symbol}: ${res.status}`)
  return res.json()
}

// Daily bars for HV calculation
export async function getDailyBars(symbol, days = 60) {
  const end = new Date().toISOString().split('T')[0]
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const res = await fetch(
    `${BASE}/v2/aggs/ticker/${symbol}/range/1/day/${start}/${end}?adjusted=true&sort=asc&limit=60&apiKey=${key()}`
  )
  if (!res.ok) throw new Error(`Daily bars failed for ${symbol}: ${res.status}`)
  return res.json()
}

// Options chain snapshot — includes greeks and IV
export async function getOptionsChain(symbol, params = {}) {
  const qs = new URLSearchParams({
    limit: 250,
    contract_type: 'put',
    apiKey: key(),
    ...(params.expiration_date_gte && { 'expiration_date.gte': params.expiration_date_gte }),
    ...(params.expiration_date_lte && { 'expiration_date.lte': params.expiration_date_lte }),
    ...(params.strike_lte && { 'strike_price.lte': params.strike_lte }),
  }).toString()

  const res = await fetch(`${BASE}/v3/snapshot/options/${symbol}?${qs}`)
  if (!res.ok) throw new Error(`Options chain failed for ${symbol}: ${res.status}`)
  return res.json()
}
