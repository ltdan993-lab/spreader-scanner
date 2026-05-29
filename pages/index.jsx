// pages/index.jsx
import { useState, useCallback } from 'react'
import Head from 'next/head'
import SpreadRow from '../components/SpreadRow'
import FilterPanel from '../components/FilterPanel'

const DEFAULT_WATCHLIST = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'TSLA', 'JPM', 'GS']

const DEFAULT_CONFIG = {
  minPrice: 20, minIVRank: 30, maxBidAsk: 0.10,
  minOI: 1000, minVol: 250, minEMBuffer: 1.0,
  minCreditWidth: 0.18, minDelta: 0.10, maxDelta: 0.20,
  minDTE: 2, maxDTE: 4,
}

export default function Home() {
  const [watchlist, setWatchlist] = useState(DEFAULT_WATCHLIST.join(', '))
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [results, setResults] = useState(null)
  const [symbolMeta, setSymbolMeta] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showFilters, setShowFilters] = useState(false)
  const [lastRun, setLastRun] = useState(null)

  const runScreen = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResults(null)

    const symbols = watchlist.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean)
    if (!symbols.length) {
      setError('Enter at least one ticker symbol')
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/screen-watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols, config }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResults(data.spreads ?? [])
      setSymbolMeta(data.symbols ?? [])
      setLastRun(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [watchlist, config])

  const passingCount = results?.filter(s => s.allPass).length ?? 0

  return (
    <>
      <Head>
        <title>Spread Screener</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <div className="min-h-screen font-mono">
        {/* Header */}
        <header className="border-b border-surface-3 px-6 py-4 flex items-center justify-between sticky top-0 bg-surface-0 z-10">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-sm font-semibold text-gray-100">SPREAD SCREENER</span>
              <span className="ml-3 text-xs text-gray-600">bull put · 2–4 DTE · 50% target</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastRun && (
              <span className="text-xs text-gray-600">
                last run {lastRun.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={() => setShowFilters(f => !f)}
              className="btn-ghost text-xs"
            >
              {showFilters ? '↑ hide filters' : '↓ filters'}
            </button>
          </div>
        </header>

        <main className="max-w-screen-xl mx-auto px-6 py-6 space-y-6">

          {/* Input bar */}
          <div className="flex gap-3 items-start">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1.5 block">Watchlist (comma or space separated)</label>
              <textarea
                className="input-field resize-none h-10 py-2 text-sm"
                value={watchlist}
                onChange={e => setWatchlist(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), runScreen())}
                placeholder="SPY, QQQ, AAPL, MSFT..."
              />
            </div>
            <div className="pt-5">
              <button
                onClick={runScreen}
                disabled={loading}
                className="btn-primary h-10 px-6"
              >
                {loading ? 'Screening...' : 'Run screen'}
              </button>
            </div>
          </div>

          {/* Filter panel */}
          {showFilters && (
            <FilterPanel config={config} onChange={setConfig} />
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-950 border border-red-900 text-red-400 text-sm px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          {/* Loading state */}
          {loading && (
            <div className="text-center py-16 text-gray-600 text-sm">
              <div className="mb-2">Fetching options chains...</div>
              <div className="text-xs text-gray-700">This may take 10–20s for a full watchlist</div>
            </div>
          )}

          {/* Symbol summary pills */}
          {symbolMeta.length > 0 && !loading && (
            <div className="flex flex-wrap gap-2">
              {symbolMeta.map(s => (
                <div
                  key={s.symbol}
                  className={`text-xs px-3 py-1.5 rounded-full border font-mono ${
                    s.error
                      ? 'bg-surface-2 border-surface-4 text-gray-600'
                      : s.passingCandidates > 0
                      ? 'bg-green-950 border-green-900 text-green-400'
                      : 'bg-surface-2 border-surface-4 text-gray-500'
                  }`}
                >
                  {s.symbol}
                  {!s.error && (
                    <span className="ml-1.5 opacity-60">
                      {s.ivRank != null ? `IVR:${s.ivRank}` : ''} {s.passingCandidates > 0 ? `✓${s.passingCandidates}` : ''}
                    </span>
                  )}
                  {s.error && <span className="ml-1 opacity-50">err</span>}
                </div>
              ))}
            </div>
          )}

          {/* Results */}
          {results !== null && !loading && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-gray-500">
                  <span className="text-green-400 font-semibold">{passingCount}</span>
                  {' '}passing spreads · {results.length} total candidates
                </div>
                <div className="text-xs text-gray-600">click row to expand · sorted by score</div>
              </div>

              {results.length === 0 ? (
                <div className="text-center py-12 text-gray-600 text-sm border border-surface-3 rounded-xl">
                  No spreads found. Try adjusting filters or adding more tickers.
                </div>
              ) : (
                <div className="border border-surface-3 rounded-xl overflow-hidden">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-surface-3 bg-surface-1">
                        {['#', 'Symbol / Structure', 'DTE', 'IV Rank', 'IV/RV', 'Credit/W', 'Δ short', 'Dist/EM', '50% tgt', 'Score', 'Gates'].map(h => (
                          <th key={h} className="px-3 py-2.5 text-xs text-gray-600 font-mono font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((spread, i) => (
                        <SpreadRow
                          key={`${spread.symbol}-${spread.shortStrike}-${spread.longStrike}-${spread.expiry}`}
                          spread={spread}
                          rank={i + 1}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {results === null && !loading && !error && (
            <div className="text-center py-20 text-gray-700 text-sm border border-surface-3 rounded-xl border-dashed">
              <div className="text-2xl mb-3">⌥</div>
              <div className="mb-1">Enter tickers and run the screen</div>
              <div className="text-xs text-gray-700">
                Hard gates: IV rank · bid/ask width · dist/EM · credit/width · OI
              </div>
            </div>
          )}

        </main>
      </div>
    </>
  )
}
