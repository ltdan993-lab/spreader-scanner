// pages/api/screen-watchlist.js
// Screens multiple tickers in parallel, returns aggregated ranked results

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { symbols = [], config = {} } = req.body
  if (!symbols.length) return res.status(400).json({ error: 'symbols array required' })

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

  // Screen all symbols in parallel (cap at 10 to avoid rate limits)
  const limited = symbols.slice(0, 10)
  const results = await Promise.allSettled(
    limited.map(symbol =>
      fetch(`${baseUrl}/api/screen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, config }),
      }).then(r => r.json())
    )
  )

  const screenResults = results
    .map((r, i) => r.status === 'fulfilled' ? r.value : { symbol: limited[i], error: 'fetch failed' })
    .filter(r => !r.error || r.stockPrice)

  // Flatten all passing spreads into one ranked list
  const allSpreads = screenResults.flatMap(r =>
    (r.results ?? [])
      .filter(s => s.allPass)
      .map(s => ({ ...s, meta: { ...s.meta, ...{ stockPrice: r.stockPrice, ivRank: r.ivRank } } }))
  ).sort((a, b) => b.scores.total - a.scores.total)

  return res.status(200).json({
    screened: screenResults.length,
    totalPassingCandidates: allSpreads.length,
    symbols: screenResults.map(r => ({
      symbol: r.symbol,
      stockPrice: r.stockPrice,
      ivRank: r.ivRank,
      ivRVRatio: r.ivRVRatio,
      passingCandidates: r.passingCandidates ?? 0,
      error: r.error ?? null,
    })),
    spreads: allSpreads.slice(0, 20),
  })
}
