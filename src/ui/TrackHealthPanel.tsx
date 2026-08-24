import type { Dataset } from '../core/model'
import type { TrackHealthCheckResult, TrackHealthFlag } from '../core/quality/trackHealthTypes'
import { usePointSelection } from '../state/pointSelection'
import { useTrackHealthScan } from './useTrackHealthScan'
import { ProgressBar, Spinner } from './Spinner'

export interface TrackHealthDrillDownTarget {
  preferredTab: 'map' | 'charts'
}

interface Props {
  dataset: Dataset
  onDrillDown: (target: TrackHealthDrillDownTarget) => void
}

const STATUS_LABEL: Record<TrackHealthCheckResult['status'], string> = { pass: 'Pass', fail: 'Fail', na: 'N/A' }

function scoreColor(score: number): string {
  if (score >= 90) return '#10b981'
  if (score >= 75) return '#3b82f6'
  if (score >= 60) return '#f59e0b'
  return '#ef4444'
}

function scoreLabel(score: number): string {
  if (score >= 90) return 'Excellent'
  if (score >= 75) return 'Good'
  if (score >= 60) return 'Fair'
  return 'Poor'
}

export function TrackHealthPanel({ dataset, onDrillDown }: Props) {
  const scan = useTrackHealthScan(dataset)
  const { selectPoint, selectRange } = usePointSelection(dataset.points)
  const scanning = scan.status === 'scanning'

  // Selecting updates the shared store that MapView/TimeSeriesChart/DataTable all read, so the
  // target highlights immediately; onDrillDown then switches tab and asks that view to recentre.
  const drillDown = (flag: TrackHealthFlag, preferredTab: 'map' | 'charts') => {
    if (flag.range) selectRange(flag.range)
    else if (flag.pointIndex !== undefined) selectPoint(flag.pointIndex)
    else return
    onDrillDown({ preferredTab })
  }

  return (
    <div className="track-health-panel">
      <div className="health-header">
        <h3>Track Health</h3>
        <div className="health-header-right">
          {scan.status === 'ready' && scan.report?.status === 'scored' && scan.report.score !== null && (
            <div className="health-score-badge" style={{ borderColor: scoreColor(scan.report.score) }}>
              <div className="health-number" style={{ color: scoreColor(scan.report.score) }}>{scan.report.score}</div>
              <div className="health-label">{scoreLabel(scan.report.score)}</div>
            </div>
          )}
          <button type="button" className="health-rescan" onClick={scan.rescan} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Re-scan'}
          </button>
        </div>
      </div>

      {scanning && (
        <div className="health-status health-status-scanning">
          <Spinner size={14} label={scan.progress?.message ?? 'Starting scan'} />
          <ProgressBar
            value={scan.progress?.total ? (scan.progress.completed / scan.progress.total) * 100 : undefined}
            indeterminate={!scan.progress?.total}
          />
        </div>
      )}

      {scan.status === 'error' && (
        <div className="health-status health-status-error">
          <span>Scan failed: {scan.error}</span>
          <button type="button" onClick={scan.rescan}>Retry</button>
        </div>
      )}

      {scan.report?.status === 'blocked' && (
        <div className="health-status health-status-blocked">
          <strong>Unreliable — cannot score</strong>
          <span>{scan.report.blockingReason}</span>
        </div>
      )}

      {scan.report?.status === 'scored' && scan.report.score === null && (
        <div className="health-status health-status-blocked">
          <strong>Not enough data to score</strong>
          <span>No weighted check could run against this track.</span>
        </div>
      )}

      {scan.report && (
        <div className={`health-checks${scanning ? ' is-stale' : ''}`}>
          {scan.report.checks.map((check) => (
            <div key={check.id} className={`health-check health-check-${check.status}`}>
              <div className="check-header">
                <span className={`check-badge badge-${check.status}`}>{STATUS_LABEL[check.status]}</span>
                <span className="check-label">{check.label}</span>
                <span className="check-points">
                  {check.status === 'na' ? '—' : check.weight > 0 ? `${check.pointsAwarded}/${check.weight}` : 'gate'}
                </span>
              </div>
              <div className="check-summary">{check.summary}</div>

              {check.details && check.details.length > 0 && (
                <ul className="check-details">
                  {check.details.map((detail, position) => <li key={position}>{detail}</li>)}
                </ul>
              )}

              {check.flags.length > 0 && (
                <div className="check-flags">
                  {check.flags.map((flag, position) => (
                    <button
                      key={position}
                      type="button"
                      className="flag-chip"
                      onClick={() => drillDown(flag, check.preferredTab)}
                      title={`Show on ${check.preferredTab === 'map' ? 'map' : 'chart'}`}
                    >
                      {flag.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="health-meta">
        <span className="meta-item"><strong>{dataset.points.length.toLocaleString()}</strong> points</span>
        {dataset.warnings.length > 0 && (
          <span className="meta-item warn">
            <strong>{dataset.warnings.length}</strong> warning{dataset.warnings.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  )
}
