// components/SpreadRow.jsx
import { useState } from 'react'
import ScoreBars from './ScoreBars'
import GateBadges from './GateBadges'

export default function SpreadRow({ spread, rank }) {
  const [expanded, setExpanded] = useState(false)
  const { scores, gates, meta, allPass } = spread

  const scoreColor = scores.total >= 70
    ? 'text-green-400'
    : scores.total >= 50
    ? 'text-amber-400'
    : 'text-red-400'

  return (
    <>
      <tr
        onClick={() => setExpanded(e => !e)}
        className={`border-b border-surface-3 cursor-pointer transition-colors ${
          allPass ? 'hover:bg-surface-2' : 'opacity-40 hover:opacity-60'
        }`}
      >
        {/* Rank */}
        <td className="px-3 py-2.5 text-xs text-gray-500 font-mono w-8">
          {allPass ? rank : '—'}
        </td>

        {/* Ticker + structure */}
        <td className="px-3 py-2.5">
          <div className="text-sm font-mono font-semibold text-gray-100">{spread.symbol}</div>
          <div className="text-xs text-gray-500 font-mono mt-0.5">
            {spread.shortStrike}P / {spread.longStrike}P · {spread.expiry}
          </div>
        </td>

        {/* DTE */}
        <td className="px-3 py-2.5 text-center">
          <span className="text-xs font-mono text-gray-300">{spread.dte}d</span>
        </td>

        {/* IV rank */}
        <td className="px-3 py-2.5 text-center">
          <span className={`text-xs font-mono ${
            meta.ivRank >= 50 ? 'text-green-400' :
            meta.ivRank >= 30 ? 'text-amber-400' : 'text-red-400'
          }`}>
            {meta.ivRank ?? '—'}
          </span>
        </td>

        {/* IV/RV */}
        <td className="px-3 py-2.5 text-center">
          <span className={`text-xs font-mono ${
            meta.ivRVRatio >= 1.2 ? 'text-green-400' :
            meta.ivRVRatio >= 1.0 ? 'text-amber-400' : 'text-red-400'
          }`}>
            {meta.ivRVRatio ? `${meta.ivRVRatio}×` : '—'}
          </span>
        </td>

        {/* Credit / width */}
        <td className="px-3 py-2.5 text-center">
          <div className="text-xs font-mono text-gray-200">${spread.credit}</div>
          <div className="text-xs font-mono text-gray-500">/{spread.creditWidthRatio.toFixed(2)}</div>
        </td>

        {/* Delta */}
        <td className="px-3 py-2.5 text-center">
          <span className="text-xs font-mono text-gray-300">
            {spread.shortDelta ? spread.shortDelta.toFixed(2) : '—'}
          </span>
        </td>

        {/* Dist/EM */}
        <td className="px-3 py-2.5 text-center">
          <span className={`text-xs font-mono ${
            spread.emRatio >= 1.1 ? 'text-green-400' :
            spread.emRatio >= 1.0 ? 'text-amber-400' : 'text-red-400'
          }`}>
            {spread.emRatio}×
          </span>
        </td>

        {/* 50% target */}
        <td className="px-3 py-2.5 text-center">
          <span className="text-xs font-mono text-blue-400">${spread.profitTarget50}</span>
        </td>

        {/* Score + sparkline */}
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-mono font-semibold ${scoreColor}`}>
              {scores.total}
            </span>
            <ScoreBars scores={scores} compact />
          </div>
        </td>

        {/* Gates */}
        <td className="px-3 py-2.5">
          <GateBadges gates={gates} />
        </td>
      </tr>

      {/* Expanded detail row */}
      {expanded && (
        <tr className="border-b border-surface-3 bg-surface-1">
          <td colSpan={11} className="px-4 py-4">
            <div className="grid grid-cols-3 gap-6">

              {/* Score breakdown */}
              <div>
                <div className="text-xs text-gray-500 font-mono mb-3 uppercase tracking-wider">Score breakdown</div>
                <ScoreBars scores={scores} compact={false} />
              </div>

              {/* Spread details */}
              <div>
                <div className="text-xs text-gray-500 font-mono mb-3 uppercase tracking-wider">Spread details</div>
                <div className="space-y-1.5 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Structure</span>
                    <span className="text-gray-200">{spread.shortStrike}P / {spread.longStrike}P</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Width</span>
                    <span className="text-gray-200">${spread.width}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Credit (mid)</span>
                    <span className="text-green-400">${spread.credit}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">50% target exit</span>
                    <span className="text-blue-400">${spread.profitTarget50}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Max loss</span>
                    <span className="text-red-400">${spread.maxLoss}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Return on risk</span>
                    <span className="text-gray-200">{spread.returnOnRisk}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Breakeven</span>
                    <span className="text-gray-200">${spread.breakeven}</span>
                  </div>
                </div>
              </div>

              {/* Vol + gate details */}
              <div>
                <div className="text-xs text-gray-500 font-mono mb-3 uppercase tracking-wider">Volatility + gates</div>
                <div className="space-y-1.5 text-xs font-mono mb-4">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Stock price</span>
                    <span className="text-gray-200">${meta.stockPrice?.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">IV rank</span>
                    <span className="text-gray-200">{meta.ivRank ?? '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">IV / RV20</span>
                    <span className="text-gray-200">{meta.ivRVRatio ? `${meta.ivRVRatio}×` : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">HV20</span>
                    <span className="text-gray-200">{meta.hv20 ? `${meta.hv20}%` : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Expected move</span>
                    <span className="text-gray-200">{meta.expectedMove ? `$${meta.expectedMove}` : '—'}</span>
                  </div>
                </div>
                <div className="text-xs text-gray-500 font-mono mb-2 uppercase tracking-wider">Gate results</div>
                <GateBadges gates={gates} expanded />
              </div>

            </div>
          </td>
        </tr>
      )}
    </>
  )
}
