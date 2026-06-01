export default async function handler(req, res) {
  const KEY = process.env.POLYGON_API_KEY
  const symbol = req.query.symbol ?? 'AAPL'
  
  const expiry = new Date()
  const daysUntilFriday = (5 - expiry.getDay() + 7) % 7 || 7
  expiry.setDate(expiry.getDate() + daysUntilFriday)
  const expStr = expiry.toISOString().split('T')[0]

  const url = `https://api.polygon.io/v3/snapshot/options/${symbol}?contract_type=put&expiration_date_gte=${expStr}&expiration_date_lte=${expStr}&limit=3&apiKey=${KEY}`
  
  const r = await fetch(url)
  const data = await r.json()
  
  return res.status(200).json({
    status: r.status,
    url: url.replace(KEY, 'HIDDEN'),
    firstContract: data?.results?.[0] ?? null,
    totalReturned: data?.results?.length ?? 0,
  })
}
