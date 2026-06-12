// Dataset overview: headline metric cards, a data-quality report, and a
// per-channel statistics table. This is the engineer's "at a glance" surface.
import { useMemo } from 'react'
import type { Dataset } from '../core/model'
import { computeStats, formatDistance, formatDuration } from '../core/stats'
import { epochMsToIso } from '../core/format'

export function StatsPanel({ dataset }: { dataset: Dataset }) {
  const stats = useMemo(() => computeStats(dataset), [dataset])

  const quality = useMemo(() => {
    const checks: Array<{ label: string; ok: boolean; detail: string }> = [
      {
        label: 'Coordinate validity',
        ok: stats.invalidCoordCount === 0,
        detail: `${stats.validCoordCount.toLocaleString()} valid / ${stats.invalidCoordCount.toLocaleString()} invalid`,
      },
      {
        label: 'Timestamps present',
        ok: stats.withTime > 0,
        detail: `${stats.withTime.toLocaleString()} of ${stats.pointCount.toLocaleString()} points timed`,
      },
      {
        label: 'Time monotonic',
        ok: stats.timeMonotonic,
        detail: stats.timeMonotonic ? 'ascending' : 'out-of-order timestamps detected (sort recommended)',
      },
      {
        label: 'Elevation present',
        ok: stats.withElevation > 0,
        detail: `${stats.withElevation.toLocaleString()} points with elevation`,
      },
      {
        label: 'Duplicate coordinates',
        ok: stats.duplicateCoords === 0,
        detail: `${stats.duplicateCoords.toLocaleString()} consecutive duplicates`,
      },
    ]
    return checks
  }, [stats])

  return (
    <div className="stats-panel">
      <div className="metric-grid">
        <Metric label="Points" value={stats.pointCount.toLocaleString()} />
        <Metric label="Valid coords" value={stats.validCoordCount.toLocaleString()} />
        <Metric label="Distance" value={formatDistance(stats.distanceMeters)} />
        <Metric label="Duration" value={formatDuration(stats.durationMs)} />
        <Metric
          label="Avg rate"
          value={stats.sampleRateHz ? `${stats.sampleRateHz.toFixed(2)} Hz` : '—'}
        />
        <Metric
          label="Max speed"
          value={stats.speed ? `${stats.speed.maxMps.toFixed(1)} m/s` : '—'}
        />
        <Metric
          label="Elev gain"
          value={stats.elevation ? `${stats.elevation.gain.toFixed(0)} m` : '—'}
        />
        <Metric
          label="Elev range"
          value={stats.elevation ? `${stats.elevation.min.toFixed(0)}–${stats.elevation.max.toFixed(0)} m` : '—'}
        />
      </div>

      <div className="stats-columns">
        <section className="stats-block">
          <h3>Data quality</h3>
          <ul className="quality-list">
            {quality.map((q) => (
              <li key={q.label} className={q.ok ? 'q-ok' : 'q-warn'}>
                <span className="q-icon">{q.ok ? '✓' : '!'}</span>
                <span className="q-label">{q.label}</span>
                <span className="q-detail">{q.detail}</span>
              </li>
            ))}
          </ul>
          {stats.startTime !== null && (
            <p className="muted mono small">
              {epochMsToIso(stats.startTime)} → {epochMsToIso(stats.endTime ?? undefined)}
            </p>
          )}
          {stats.bounds && (
            <p className="muted mono small">
              bbox [{stats.bounds.minLat.toFixed(5)}, {stats.bounds.minLon.toFixed(5)}] →
              [{stats.bounds.maxLat.toFixed(5)}, {stats.bounds.maxLon.toFixed(5)}]
            </p>
          )}
          {dataset.warnings.length > 0 && (
            <div className="stats-warnings">
              {dataset.warnings.map((w, i) => (
                <p key={i} className="warn-line small">⚠ {w}</p>
              ))}
            </div>
          )}
        </section>

        <section className="stats-block">
          <h3>Channels ({stats.channels.length})</h3>
          {stats.channels.length === 0 && <p className="muted small">No extension channels.</p>}
          {stats.channels.length > 0 && (
            <table className="channel-table mono">
              <thead>
                <tr>
                  <th>channel</th>
                  <th>n</th>
                  <th>min</th>
                  <th>max</th>
                  <th>mean</th>
                  <th>σ</th>
                </tr>
              </thead>
              <tbody>
                {stats.channels.map((c) => (
                  <tr key={c.key}>
                    <td>{c.key}{c.unit ? <span className="unit"> {c.unit}</span> : null}</td>
                    <td>{c.numericCount}</td>
                    <td>{fmt(c.min)}</td>
                    <td>{fmt(c.max)}</td>
                    <td>{fmt(c.mean)}</td>
                    <td>{fmt(c.stddev)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  )
}

function fmt(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  if (Number.isInteger(n)) return String(n)
  if (Math.abs(n) >= 1000) return n.toFixed(0)
  if (Math.abs(n) >= 1) return n.toFixed(2)
  return n.toFixed(4)
}
