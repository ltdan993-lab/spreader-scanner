// components/FilterPanel.jsx
import { useState } from 'react'

const PRESETS = {
  conservative: {
    minPrice: 30, minIVRank: 40, maxBidAsk: 0.05,
    minOI: 2000, minVol: 500, minEMBuffer: 1.2,
    minCreditWidth: 0.18, minDelta: 0.08, maxDelta: 0.12,
    minDTE: 2, maxDTE: 4,
  },
  balanced: {
    minPrice: 20, minIVRank: 30, maxBidAsk: 0.10,
    minOI: 1000, minVol: 250, minEMBuffer: 1.0,
    minCreditWidth: 0.18, minDelta: 0.10, maxDelta: 0.20,
    minDTE: 2, maxDTE: 4,
  },
  aggressive: {
    minPrice: 15, minIVRank: 20, maxBidAsk: 0.15,
    minOI: 500, minVol: 100, minEMBuffer: 0.85,
    minCreditWidth: 0.12, minDelta: 0.15, maxDelta: 0.30,
    minDTE: 2, maxDTE: 5,
  },
}

export default function FilterPanel({ config, onChange }) {
  const [mode, setMode] = useState('balanced')

  function applyPreset(preset) {
    setMode(preset)
    onChange(PRESETS[preset])
  }

  function update(key, value) {
    onChange({ ...config, [key]: parseFloat(value) })
  }

  const Field = ({ label, field, min, max, step, suffix = '' }) => (
    <div>
      <label className="text-xs text-gray-500 font-mono block mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          className="input-field"
          value={config[field] ?? ''}
          min={min} max={max} step={step}
          onChange={e => update(field, e.target.value)}
        />
        {suffix && <span className="text-xs text-gray-500 whitespace-nowrap">{suffix}</span>}
      </div>
    </div>
  )

  return (
    <div className="bg-surface-1 border border-surface-4 rounded-xl p-5 space-y-5">
      {/* Mode presets */}
      <div>
        <div className="text-xs text-gray-500 font-mono uppercase tracking-wider mb-2">Mode</div>
        <div className="flex gap-2">
          {['conservative', 'balanced', 'aggressive'].map(p => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className={`flex-1 py-1.5 text-xs font-mono rounded border transition-colors capitalize ${
                mode === p
                  ? 'bg-blue-900 border-blue-600 text-blue-300'
                  : 'border-surface-4 text-gray-500 hover:text-gray-300 hover:border-surface-3'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Underlying */}
      <div>
        <div className="text-xs text-gray-500 font-mono uppercase tracking-wider mb-2">Underlying</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Min price" field="minPrice" min={5} max={500} step={5} suffix="$" />
          <Field label="Min DTE" field="minDTE" min={1} max={10} step={1} suffix="days" />
        </div>
      </div>

      {/* Volatility gates */}
      <div>
        <div className="text-xs text-gray-500 font-mono uppercase tracking-wider mb-2">Volatility gates</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Min IV rank" field="minIVRank" min={0} max={100} step={5} />
          <Field label="Min IV/RV ratio" field="minIVRV" min={0.8} max={2.0} step={0.05} suffix="×" />
        </div>
      </div>

      {/* Spread structure */}
      <div>
        <div className="text-xs text-gray-500 font-mono uppercase tracking-wider mb-2">Spread structure</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Min delta" field="minDelta" min={0.05} max={0.30} step={0.01} />
          <Field label="Max delta" field="maxDelta" min={0.10} max={0.40} step={0.01} />
          <Field label="Min credit/width" field="minCreditWidth" min={0.08} max={0.45} step={0.01} />
          <Field label="Min dist/EM" field="minEMBuffer" min={0.75} max={1.75} step={0.05} suffix="×" />
        </div>
      </div>

      {/* Liquidity gates */}
      <div>
        <div className="text-xs text-gray-500 font-mono uppercase tracking-wider mb-2">Liquidity gates</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Min OI per leg" field="minOI" min={100} max={10000} step={100} />
          <Field label="Min daily volume" field="minVol" min={50} max={2000} step={50} />
          <Field label="Max bid/ask" field="maxBidAsk" min={0.02} max={0.30} step={0.01} suffix="$" />
        </div>
      </div>
    </div>
  )
}
