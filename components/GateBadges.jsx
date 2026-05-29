// components/GateBadges.jsx
export default function GateBadges({ gates, expanded = false }) {
  if (!gates) return null

  if (!expanded) {
    const failed = gates.filter(g => !g.pass)
    if (failed.length === 0) {
      return <span className="gate-pass">All gates pass</span>
    }
    return (
      <span className="gate-fail">
        {failed.length} gate{failed.length > 1 ? 's' : ''} failed
      </span>
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {gates.map(g => (
        <span key={g.label} className={g.pass ? 'gate-pass' : 'gate-fail'}>
          {g.pass ? '✓' : '✗'} {g.label}
          {!g.pass && typeof g.value === 'number' && (
            <span className="ml-1 opacity-70">
              ({typeof g.value === 'number' ? g.value.toFixed(2) : JSON.stringify(g.value)})
            </span>
          )}
        </span>
      ))}
    </div>
  )
}
