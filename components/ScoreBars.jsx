// components/ScoreBars.jsx
export default function ScoreBars({ scores, compact = false }) {
  const bars = [
    { label: 'Liq', value: scores.liquidity, color: '#22c55e' },
    { label: 'Econ', value: scores.economics, color: '#3b82f6' },
    { label: 'Safety', value: scores.strikeSafety, color: '#a78bfa' },
    { label: 'Vol', value: scores.volEdge, color: '#f59e0b' },
  ]

  if (compact) {
    return (
      <div className="flex gap-0.5 items-end h-4">
        {bars.map(b => (
          <div
            key={b.label}
            title={`${b.label}: ${b.value}`}
            style={{
              width: 8,
              height: `${Math.max(2, (b.value / 100) * 16)}px`,
              backgroundColor: b.color,
              borderRadius: 1,
              opacity: 0.85,
            }}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {bars.map(b => (
        <div key={b.label} className="flex items-center gap-2">
          <span className="text-xs text-gray-500 w-10 font-mono">{b.label}</span>
          <div className="flex-1 h-1.5 bg-surface-3 rounded-full overflow-hidden">
            <div
              style={{ width: `${b.value}%`, backgroundColor: b.color }}
              className="h-full rounded-full"
            />
          </div>
          <span className="text-xs font-mono text-gray-400 w-6 text-right">{b.value}</span>
        </div>
      ))}
    </div>
  )
}
