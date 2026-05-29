// pages/manual.jsx
// Manual input credit spread screener — no API required
import { useState } from 'react'
import Head from 'next/head'

// ─── GATE + SCORING LOGIC ─────────────────────────────────────────────────────

function runGates(spread, stockPrice, ivRank, config) {
  const gates = []

  const minDTE = config.minDTE ?? 2
  const maxDTE = config.maxDTE ?? 4
  gates.push({
    label: 'DTE',
    pass: spread.dte >= minDTE && spread.dte <= maxDTE,
    value: spread.dte,
  })

  const bidAskPct = spread.shortAsk > 0
    ? (spread.shortAsk - spread.shortBid) / ((spread.shortAsk + spread.shortBid) / 2)
    : 1
  gates.push({
    label: 'Bid/ask width',
    pass: bidAskPct <= (config.maxBidAsk ?? 0.10),
    value: parseFloat(bidAskPct.toFixed(3)),
  })

  gates.push({
    label: 'OI / Volume',
    pass: spread.shortOI >= (config.minOI ?? 1000) && spread.shortVol >= (config.minVol ?? 250),
    value: `OI:${spread.shortOI} Vol:${spread.shortVol}`,
  })

  gates.push({
    label: 'Credit/width',
    pass: spread.creditWidthRatio >= (config.minCreditWidth ?? 0.18),
    value: parseFloat(spread.creditWidthRatio.toFixed(3)),
  })

  gates.push({
    label: 'Dist/EM',
    pass: spread.emRatio >= (config.minEMBuffer ?? 1.0),
    value: parseFloat(spread.emRatio.toFixed(2)),
  })

  if (ivRank !== null && ivRank !== undefined && ivRank !== '') {
    gates.push({
      label: 'IV rank',
      pass: parseFloat(ivRank) >= (config.minIVRank ?? 30),
      value: parseFloat(ivRank),
    })
  }

  const allPass = gates.every(g => g.pass)
  return { gates, allPass }
}

function scoreLiquidity(spread) {
  const bidAskPct = spread.shortAsk > 0
    ? (spread.shortAsk - spread.shortBid) / ((spread.shortAsk + spread.shortBid) / 2)
    : 1
  const oiScore = Math.min(spread.shortOI / 5000, 1)
  const volScore = Math.min(spread.shortVol / 1000, 1)
  const widthScore = Math.max(0, 1 - bidAskPct / 0.15)
  return parseFloat(((oiScore * 0.40 + volScore * 0.35 + widthScore * 0.25) * 100).toFixed(1))
}

function scoreEconomics(spread) {
  const cwScore = Math.min(Math.max((spread.creditWidthRatio - 0.12) / 0.23, 0), 1)
  const rorScore = Math.min(spread.returnOnRisk / 30, 1)
  return parseFloat(((cwScore * 0.50 + rorScore * 0.50) * 100).toFixed(1))
}

function scoreStrikeSafety(spread, ivRVRatio) {
  const deltaScore = Math.max(0, 1 - Math.abs(spread.shortDelta) / 0.25)
  const emScore = Math.min(Math.max((spread.emRatio - 0.85) / 0.65, 0), 1)
  const ivrvScore = ivRVRatio ? Math.min(Math.max((ivRVRatio - 0.9) / 0.9, 0), 1) : 0.5
  return parseFloat(((deltaScore * 0.40 + emScore * 0.40 + ivrvScore * 0.20) * 100).toFixed(1))
}

function scoreVolEdge(ivRank, ivRVRatio) {
  const rankScore = ivRank ? Math.min(parseFloat(ivRank) / 80, 1) : 0.5
  const ivrvScore = ivRVRatio ? Math.min(Math.max((ivRVRatio - 1.0) / 0.8, 0), 1) : 0
  return parseFloat(((rankScore * 0.55 + ivrvScore * 0.45) * 100).toFixed(1))
}

function buildSpreads(puts, stockPrice, expectedMove, config) {
  const spreads = []
  const minDelta = config.minDelta ?? 0.10
  const maxDelta = config.maxDelta ?? 0.20

  const shortLegs = puts.filter(p => {
    const d = Math.abs(parseFloat(p.delta) || 0)
    return d >= minDelta && d <= maxDelta && parseFloat(p.strike) < stockPrice
  })

  shortLegs.forEach(short => {
    const longLegs = puts.filter(p =>
      parseFloat(p.strike) < parseFloat(short.strike) &&
      p.expiry === short.expiry &&
      parseFloat(short.strike) - parseFloat(p.strike) >= 1 &&
      parseFloat(short.strike) - parseFloat(p.strike) <= 5
    )

    longLegs.forEach(long => {
      const width = parseFloat(short.strike) - parseFloat(long.strike)
      const shortMid = (parseFloat(short.bid) + parseFloat(short.ask)) / 2
      const longMid = (parseFloat(long.bid) + parseFloat(long.ask)) / 2
      const credit = parseFloat((shortMid - longMid).toFixed(2))
      if (credit <= 0) return

      const creditWidthRatio = parseFloat((credit / width).toFixed(3))
      const maxLoss = parseFloat((width - credit).toFixed(2))
      const breakeven = parseFloat((parseFloat(short.strike) - credit).toFixed(2))
      const distToShort = parseFloat((stockPrice - parseFloat(short.strike)).toFixed(2))
      const emRatio = expectedMove > 0 ? parseFloat((distToShort / expectedMove).toFixed(2)) : 0
      const returnOnRisk = maxLoss > 0 ? parseFloat(((credit / maxLoss) * 100).toFixed(1)) : 0
      const profitTarget50 = parseFloat((credit * 0.5).toFixed(2))

      spreads.push({
        shortStrike: parseFloat(short.strike),
        longStrike: parseFloat(long.strike),
        expiry: short.expiry,
        dte: parseInt(short.dte),
        width, credit, creditWidthRatio, maxLoss, breakeven,
        distToShort, emRatio, returnOnRisk, profitTarget50,
        shortDelta: Math.abs(parseFloat(short.delta) || 0),
        shortBid: parseFloat(short.bid),
        shortAsk: parseFloat(short.ask),
        shortOI: parseInt(short.oi) || 0,
        shortVol: parseInt(short.volume) || 0,
        shortIV: parseFloat(short.iv) || null,
      })
    })
  })

  return spreads
}

const emptyRow = () => ({
  id: Date.now() + Math.random(),
  strike: '', bid: '', ask: '', delta: '',
  gamma: '', theta: '', vega: '', iv: '',
  oi: '', volume: '', dte: '', expiry: '',
})export default function ManualScreener() {
  const [stock, setStock] = useState({
    ticker: '', price: '', expectedMove: '', hv20: '', ivRank: '',
  })
  const [rows, setRows] = useState([emptyRow(), emptyRow(), emptyRow()])
  const [config, setConfig] = useState({
    minDTE: 2, maxDTE: 4, minDelta: 0.10, maxDelta: 0.20,
    minCreditWidth: 0.18, minEMBuffer: 1.0, maxBidAsk: 0.10,
    minOI: 1000, minVol: 250, minIVRank: 30,
  })
  const [results, setResults] = useState(null)
  const [showConfig, setShowConfig] = useState(false)

  function updateRow(id, field, value) {
    setRows(rows => rows.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  function addRow() {
    setRows(rows => [...rows, emptyRow()])
  }

  function removeRow(id) {
    setRows(rows => rows.filter(r => r.id !== id))
  }

  function analyze() {
    const stockPrice = parseFloat(stock.price)
    const expectedMove = parseFloat(stock.expectedMove) || stockPrice * 0.02
    const hv20 = parseFloat(stock.hv20) || null
    const ivRank = stock.ivRank !== '' ? parseFloat(stock.ivRank) : null
    const currentIV = rows.find(r => r.iv !== '')?.iv
    const ivRVRatio = currentIV && hv20 ? parseFloat(currentIV) / hv20 : null

    const validPuts = rows.filter(r =>
      r.strike !== '' && r.bid !== '' && r.ask !== '' && r.dte !== ''
    )

    if (validPuts.length < 2) {
      alert('Add at least 2 put contracts to build spreads')
      return
    }

    const rawSpreads = buildSpreads(validPuts, stockPrice, expectedMove, config)

    if (rawSpreads.length === 0) {
      setResults({ spreads: [], message: 'No spreads constructed — check delta range and strike spacing' })
      return
    }

    const scored = rawSpreads.map(spread => {
      const { gates, allPass } = runGates(spread, stockPrice, ivRank, config)
      const liq = scoreLiquidity(spread)
      const econ = scoreEconomics(spread)
      const safety = scoreStrikeSafety(spread, ivRVRatio)
      const volEdge = scoreVolEdge(ivRank, ivRVRatio)
      const total = Math.round(liq * 0.30 + econ * 0.20 + safety * 0.25 + volEdge * 0.25)
      return { ...spread, gates, allPass, scores: { liq, econ, safety, volEdge, total } }
    })

    const passing = scored.filter(s => s.allPass).sort((a, b) => b.scores.total - a.scores.total)
    const failing = scored.filter(s => !s.allPass).sort((a, b) => b.scores.total - a.scores.total)
    setResults({ spreads: [...passing, ...failing], passing: passing.length })
  }

  function clearAll() {
    setRows([emptyRow(), emptyRow(), emptyRow()])
    setStock({ ticker: '', price: '', expectedMove: '', hv20: '', ivRank: '' })
    setResults(null)
  }

  const INPUT = "bg-surface-2 border border-surface-4 rounded px-2 py-1 text-xs font-mono text-gray-200 focus:outline-none focus:border-blue-600 w-full"
  const LABEL = "text-xs text-gray-500 font-mono mb-1 block"

  return (
    <>
      <Head>
        <title>Manual Spread Screener</title>
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <div className="min-h-screen font-mono">
        <header className="border-b border-surface-3 px-6 py-4 flex items-center justify-between sticky top-0 bg-surface-0 z-10">
          <div>
            <span className="text-sm font-semibold text-gray-100">SPREAD SCREENER</span>
            <span className="ml-3 text-xs text-gray-600">manual input · bull put · 50% target</span>
          </div>
          <div className="flex gap-3">
            <a href="/" className="text-xs text-gray-500 hover:text-gray-300 border border-surface-4 px-3 py-1.5 rounded">← API screener</a>
            <button onClick={() => setShowConfig(c => !c)} className="text-xs text-gray-500 hover:text-gray-300 border border-surface-4 px-3 py-1.5 rounded">
              {showConfig ? '↑ hide config' : '↓ config'}
            </button>
            <button onClick={clearAll} className="text-xs text-gray-500 hover:text-gray-300 border border-surface-4 px-3 py-1.5 rounded">Clear</button>
          </div>
        </header>

        <main className="max-w-screen-xl mx-auto px-6 py-6 space-y-6">

          {showConfig && (
            <div className="bg-surface-1 border border-surface-4 rounded-xl p-5">
              <div className="text-xs text-gray-500 font-mono uppercase tracking-wider mb-4">Gate configuration</div>
              <div className="grid grid-cols-5 gap-4">
                {[
                  { label: 'Min DTE', field: 'minDTE', step: 1 },
                  { label: 'Max DTE', field: 'maxDTE', step: 1 },
                  { label: 'Min delta', field: 'minDelta', step: 0.01 },
                  { label: 'Max delta', field: 'maxDelta', step: 0.01 },
                  { label: 'Min credit/width', field: 'minCreditWidth', step: 0.01 },
                  { label: 'Min dist/EM', field: 'minEMBuffer', step: 0.05 },
                  { label: 'Max bid/ask', field: 'maxBidAsk', step: 0.01 },
                  { label: 'Min OI', field: 'minOI', step: 100 },
                  { label: 'Min volume', field: 'minVol', step: 50 },
                  { label: 'Min IV rank', field: 'minIVRank', step: 5 },
                ].map(({ label, field, step }) => (
                  <div key={field}>
                    <label className={LABEL}>{label}</label>
                    <input type="number" className={INPUT} value={config[field]} step={step}
                      onChange={e => setConfig(c => ({ ...c, [field]: parseFloat(e.target.value) }))} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-surface-1 border border-surface-4 rounded-xl p-5">
            <div className="text-xs text-gray-500 font-mono uppercase tracking-wider mb-4">Stock info</div>
            <div className="grid grid-cols-5 gap-4">
              <div>
                <label className={LABEL}>Ticker</label>
                <input className={INPUT} placeholder="AAPL" value={stock.ticker}
                  onChange={e => setStock(s => ({ ...s, ticker: e.target.value.toUpperCase() }))} />
              </div>
              <div>
                <label className={LABEL}>Stock price ($)</label>
                <input className={INPUT} type="number" placeholder="195.50" value={stock.price}
                  onChange={e => setStock(s => ({ ...s, price: e.target.value }))} />
              </div>
              <div>
                <label className={LABEL}>Expected move ($)</label>
                <input className={INPUT} type="number" placeholder="4.20" value={stock.expectedMove}
                  onChange={e => setStock(s => ({ ...s, expectedMove: e.target.value }))} />
              </div>
              <div>
                <label className={LABEL}>HV20 (%)</label>
                <input className={INPUT} type="number" placeholder="22.5" value={stock.hv20}
                  onChange={e => setStock(s => ({ ...s, hv20: e.target.value }))} />
              </div>
              <div>
                <label className={LABEL}>IV rank (0–100)</label>
                <input className={INPUT} type="number" placeholder="45" value={stock.ivRank}
                  onChange={e => setStock(s => ({ ...s, ivRank: e.target.value }))} />
              </div>
            </div>
          </div>

          <div className="bg-surface-1 border border-surface-4 rounded-xl overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between border-b border-surface-3">
              <div className="text-xs text-gray-500 font-mono uppercase tracking-wider">Put contracts</div>
              <div className="text-xs text-gray-600">Copy from your broker · focus on 0.10–0.20 delta range</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-surface-3 bg-surface-2">
                    {['Strike','Expiry','DTE','Bid','Ask','Delta','Gamma','Theta','Vega','IV %','OI','Volume',''].map(h => (
                      <th key={h} className="px-3 py-2 text-xs text-gray-600 font-mono whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id} className="border-b border-surface-3">
                      {[
                        { field: 'strike', placeholder: '190' },
                        { field: 'expiry', placeholder: '2026-06-06' },
                        { field: 'dte', placeholder: '3' },
                        { field: 'bid', placeholder: '0.45' },
                        { field: 'ask', placeholder: '0.50' },
                        { field: 'delta', placeholder: '0.15' },
                        { field: 'gamma', placeholder: '0.02' },
                        { field: 'theta', placeholder: '-0.08' },
                        { field: 'vega', placeholder: '0.12' },
                        { field: 'iv', placeholder: '28.5' },
                        { field: 'oi', placeholder: '2500' },
                        { field: 'volume', placeholder: '450' },
                      ].map(({ field, placeholder }) => (
                        <td key={field} className="px-2 py-1.5">
                          <input className={INPUT} style={{ minWidth: field === 'expiry' ? 90 : 56 }}
                            placeholder={placeholder} value={row[field]}
                            onChange={e => updateRow(row.id, field, e.target.value)} />
                        </td>
                      ))}
                      <td className="px-2 py-1.5">
                        <button onClick={() => removeRow(row.id)} className="text-gray-600 hover:text-red-400 text-xs px-2">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-3 flex items-center gap-3 border-t border-surface-3">
              <button onClick={addRow} className="text-xs text-gray-500 hover:text-gray-300 border border-surface-4 px-3 py-1.5 rounded">+ Add row</button>
              <button onClick={analyze} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-6 py-2 rounded transition-colors">
                Analyze spreads
              </button>
            </div>
          </div>{results && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-gray-500">
                  <span className="text-green-400 font-semibold">{results.passing ?? 0}</span> passing ·{' '}
                  {results.spreads.length} total spreads constructed
                  {results.message && <span className="ml-2 text-amber-400">{results.message}</span>}
                </div>
                <div className="text-xs text-gray-600">click row to expand · sorted by score</div>
              </div>

              {results.spreads.length === 0 ? (
                <div className="text-center py-12 text-gray-600 text-sm border border-surface-3 rounded-xl">
                  No spreads constructed. Check that you have puts with matching expiries and adjacent strikes.
                </div>
              ) : (
                <div className="border border-surface-3 rounded-xl overflow-hidden">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-surface-3 bg-surface-1">
                        {['#','Structure','DTE','Credit','C/W','Δ','Dist/EM','50% tgt','ROR','Score','Gates'].map(h => (
                          <th key={h} className="px-3 py-2.5 text-xs text-gray-600 font-mono">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.spreads.map((s, i) => (
                        <ResultRow key={`${s.shortStrike}-${s.longStrike}-${s.expiry}`} spread={s} rank={i + 1} ticker={stock.ticker} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

        </main>
      </div>
    </>
  )
}

function ResultRow({ spread, rank, ticker }) {
  const [expanded, setExpanded] = useState(false)
  const { scores, gates, allPass } = spread
  const scoreColor = scores.total >= 70 ? 'text-green-400' : scores.total >= 50 ? 'text-amber-400' : 'text-red-400'
  const failedGates = gates.filter(g => !g.pass)

  return (
    <>
      <tr
        onClick={() => setExpanded(e => !e)}
        className={`border-b border-surface-3 cursor-pointer transition-colors ${allPass ? 'hover:bg-surface-2' : 'opacity-40 hover:opacity-60'}`}
      >
        <td className="px-3 py-2.5 text-xs text-gray-500 font-mono">{allPass ? rank : '—'}</td>
        <td className="px-3 py-2.5">
          <div className="text-sm font-mono font-semibold text-gray-100">{ticker} {spread.shortStrike}P / {spread.longStrike}P</div>
          <div className="text-xs text-gray-500 font-mono">{spread.expiry}</div>
        </td>
        <td className="px-3 py-2.5 text-xs font-mono text-gray-300">{spread.dte}d</td>
        <td className="px-3 py-2.5 text-xs font-mono text-green-400">${spread.credit}</td>
        <td className="px-3 py-2.5 text-xs font-mono text-gray-300">{spread.creditWidthRatio.toFixed(2)}</td>
        <td className="px-3 py-2.5 text-xs font-mono text-gray-300">{spread.shortDelta.toFixed(2)}</td>
        <td className="px-3 py-2.5 text-xs font-mono">
          <span className={spread.emRatio >= 1.1 ? 'text-green-400' : spread.emRatio >= 1.0 ? 'text-amber-400' : 'text-red-400'}>
            {spread.emRatio}×
          </span>
        </td>
        <td className="px-3 py-2.5 text-xs font-mono text-blue-400">${spread.profitTarget50}</td>
        <td className="px-3 py-2.5 text-xs font-mono text-gray-300">{spread.returnOnRisk}%</td>
        <td className="px-3 py-2.5">
          <span className={`text-sm font-mono font-semibold ${scoreColor}`}>{scores.total}</span>
        </td>
        <td className="px-3 py-2.5">
          {allPass
            ? <span className="text-xs font-mono px-2 py-0.5 rounded bg-green-950 text-green-400 border border-green-900">All pass</span>
            : <span className="text-xs font-mono px-2 py-0.5 rounded bg-red-950 text-red-400 border border-red-900">{failedGates.length} failed</span>
          }
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-surface-3 bg-surface-1">
          <td colSpan={11} className="px-5 py-4">
            <div className="grid grid-cols-3 gap-6">
              <div>
                <div className="text-xs text-gray-500 font-mono uppercase tracking-wider mb-3">Score breakdown</div>
                {[
                  { label: 'Liquidity', val: scores.liq, color: '#22c55e' },
                  { label: 'Economics', val: scores.econ, color: '#3b82f6' },
                  { label: 'Strike safety', val: scores.safety, color: '#a78bfa' },
                  { label: 'Vol edge', val: scores.volEdge, color: '#f59e0b' },
                ].map(b => (
                  <div key={b.label} className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs text-gray-500 w-24 font-mono">{b.label}</span>
                    <div className="flex-1 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                      <div style={{ width: `${b.val}%`, backgroundColor: b.color }} className="h-full rounded-full" />
                    </div>
                    <span className="text-xs font-mono text-gray-400 w-6 text-right">{b.val}</span>
                  </div>
                ))}
              </div>

              <div>
                <div className="text-xs text-gray-500 font-mono uppercase tracking-wider mb-3">Spread details</div>
                <div className="space-y-1.5 text-xs font-mono">
                  {[
                    ['Width', `$${spread.width}`],
                    ['Credit (mid)', `$${spread.credit}`],
                    ['50% target exit', `$${spread.profitTarget50}`],
                    ['Max loss', `$${spread.maxLoss}`],
                    ['Return on risk', `${spread.returnOnRisk}%`],
                    ['Breakeven', `$${spread.breakeven}`],
                    ['Short IV', spread.shortIV ? `${spread.shortIV}%` : '—'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span className="text-gray-500">{k}</span>
                      <span className="text-gray-200">{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-500 font-mono uppercase tracking-wider mb-3">Gate results</div>
                <div className="flex flex-wrap gap-1.5">
                  {gates.map(g => (
                    <span key={g.label} className={`text-xs px-2 py-0.5 rounded border font-mono ${
                      g.pass ? 'bg-green-950 text-green-400 border-green-900' : 'bg-red-950 text-red-400 border-red-900'
                    }`}>
                      {g.pass ? '✓' : '✗'} {g.label}{!g.pass && ` (${g.value})`}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
