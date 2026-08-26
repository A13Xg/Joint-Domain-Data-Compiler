// Animated loading indicators used across async flows (parse, export, analyze).

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <span className="spinner-wrap" role="status" aria-live="polite">
      <span
        className="spinner"
        style={{ width: size, height: size, borderWidth: Math.max(2, size / 8) }}
      />
      {label && <span className="spinner-label">{label}</span>}
    </span>
  )
}

export function ProgressBar({
  value,
  label,
  indeterminate,
}: {
  value?: number
  label?: string
  indeterminate?: boolean
}) {
  const pct = Math.max(0, Math.min(100, value ?? 0))
  return (
    <div className="progress-track-wrap">
      {label && (
        <div className="progress-label-row">
          <span>{label}</span>
          {!indeterminate && <span className="progress-pct">{pct.toFixed(0)}%</span>}
        </div>
      )}
      <div className={`progress-track${indeterminate ? ' indeterminate' : ''}`}>
        <div className="progress-fill" style={{ width: indeterminate ? '40%' : `${pct}%` }} />
      </div>
    </div>
  )
}
