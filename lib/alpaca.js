const ALPACA_DATA_BASE = 'https://data.alpaca.markets/v2'
const ALPACA_OPTIONS_BASE = 'https://data.alpaca.markets/v1beta1'

function headers() {
  return {
    'APCA-API-KEY-ID': process.env.ALPACA_KEY_ID,
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
    'Content-Type': 'application/json',
  }
}

export async function getStockQuote(symbol) {
  const res = await fetch(
    `${ALPACA_DATA_BASE}/stocks/${symbol}/quotes/latest`,
    { headers: headers() }
  )
  if (!res.ok) throw new Error(`Quote fetch failed for ${symbol}: ${res.status}`)
  return res.json()
}

export async function getDailyBars(symbol, limit = 60) {
  const res = await fetch(
    `${ALPACA_DATA_BASE}/stocks/${symbol}/bars?timeframe=1Day&limit=${limit}&adjustment=split`,
    { headers: headers() }
  )
  if (!res.ok) throw new Error(`Bars fetch failed for ${symbol}: ${res.status}`)
  return res.json()
}

export async function getSnapshot(symbol) {
  const res = await fetch(
    `${ALPACA_DATA_BASE}/stocks/${symbol}/snapshot`,
    { headers: headers() }
  )
  if (!res.ok) throw new Error(`Snapshot fetch failed for ${symbol}: ${res.status}`)
  return res.json()
}

export async function getOptionsChain(symbol, params = {}) {
  const { type, expiration_date_gte, expiration_date_lte, limit = 200 } = params
  const qs = new URLSearchParams({
    limit,
    feed: 'indicative',
    ...(type && { type }),
    ...(expiration_date_gte && { expiration_date_gte }),
    ...(expiration_date_lte && { expiration_date_lte }),
  }).toString()

  const res = await fetch(
    `${ALPACA_OPTIONS_BASE}/options/snapshots/${symbol}?${qs}`,
    { headers: headers() }
  )
  if (!res.ok) throw new Error(`Options chain failed for ${symbol}: ${res.status}`)
  return res.json()
}
