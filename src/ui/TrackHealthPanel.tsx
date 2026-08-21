import { useMemo } from 'react'
import type { Dataset, TrackPoint } from '../core/model'
import { detectQualityEvents } from '../core/quality/events'

interface HealthMetric {
  name: string
  value: number
  unit: string
  weight: number
  threshold: number
}

interface TrackHealthScore {
  overall: number
  metrics: HealthMetric[]
}

function calculateTrackHealth(points: TrackPoint[]): TrackHealthScore {
  if (points.length === 0) return { overall: 0, metrics: [] }

  const qualityEvents = detectQualityEvents(points)
  const hasTimestamps = points.some((p) => p.time !== undefined)
  const hasElevation = points.some((p) => p.ele !== undefined)

  // Calculate metrics
  const pointCount = points.length
  const timespan = hasTimestamps && points[0]?.time && points[points.length - 1]?.time
    ? (points[points.length - 1].time - points[0].time) / 1000 // seconds
    : 0

  const invalidPoints = points.filter((p) => !Number.isFinite(p.lat) || !Number.isFinite(p.lon)).length
  const duplicateTimestamps = qualityEvents.filter((e) => e.type === 'duplicate-timestamp').length
  const gapEvents = qualityEvents.filter((e) => e.type === 'gap').length
  const jumpEvents = qualityEvents.filter((e) => e.type === 'jump').length

  // Metrics with weights (0-1 scale, 0 = good, 1 = bad)
  const metrics: HealthMetric[] = [
    {
      name: 'Completeness',
      value: Math.max(0, Math.min(100, 100 - (invalidPoints / pointCount) * 100)),
      unit: '%',
      weight: 0.2,
      threshold: 95,
    },
    {
      name: 'Temporal',
      value: hasTimestamps ? 100 : 0,
      unit: '%',
      weight: 0.15,
      threshold: 100,
    },
    {
      name: 'Duplicates',
      value: Math.max(0, 100 - (duplicateTimestamps / Math.max(1, pointCount)) * 100),
      unit: '%',
      weight: 0.15,
      threshold: 95,
    },
    {
      name: 'Continuity',
      value: Math.max(0, 100 - (gapEvents / Math.max(1, timespan / 60)) * 10),
      unit: '%',
      weight: 0.2,
      threshold: 80,
    },
    {
      name: 'Trajectory',
      value: Math.max(0, 100 - (jumpEvents / Math.max(1, pointCount)) * 100),
      unit: '%',
      weight: 0.15,
      threshold: 85,
    },
    {
      name: 'Elevation',
      value: hasElevation ? 100 : 50,
      unit: '%',
      weight: 0.15,
      threshold: 100,
    },
  ]

  // Calculate weighted overall score
  const totalWeight = metrics.reduce((sum, m) => sum + m.weight, 0)
  const overall = Math.round(metrics.reduce((sum, m) => sum + (m.value * m.weight), 0) / totalWeight)

  return { overall: Math.max(0, Math.min(100, overall)), metrics }
}

function getHealthStatus(score: number): { label: string; color: string } {
  if (score >= 90) return { label: 'Excellent', color: '#10b981' } // green
  if (score >= 75) return { label: 'Good', color: '#3b82f6' } // blue
  if (score >= 60) return { label: 'Fair', color: '#f59e0b' } // amber
  return { label: 'Poor', color: '#ef4444' } // red
}

export function TrackHealthPanel({ dataset }: { dataset: Dataset }) {
  const health = useMemo(() => calculateTrackHealth(dataset.points), [dataset.points])
  const status = getHealthStatus(health.overall)

  return (
    <div className="track-health-panel">
      <div className="health-header">
        <h3>Track Health</h3>
        <div className="health-score-badge" style={{ borderColor: status.color }}>
          <div className="health-number" style={{ color: status.color }}>{health.overall}</div>
          <div className="health-label">{status.label}</div>
        </div>
      </div>

      <div className="health-grid">
        {health.metrics.map((metric) => (
          <div key={metric.name} className="health-metric">
            <div className="metric-name">{metric.name}</div>
            <div className="metric-bar">
              <div
                className="metric-fill"
                style={{
                  width: `${metric.value}%`,
                  backgroundColor: metric.value >= metric.threshold ? '#10b981' : '#ef4444',
                }}
              />
            </div>
            <div className="metric-value">{Math.round(metric.value)}{metric.unit}</div>
          </div>
        ))}
      </div>

      <div className="health-meta">
        <span className="meta-item">
          <strong>{dataset.points.length.toLocaleString()}</strong> points
        </span>
        {dataset.warnings && dataset.warnings.length > 0 && (
          <span className="meta-item warn">
            <strong>{dataset.warnings.length}</strong> warning{dataset.warnings.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  )
}
