// Read-only SVG chart for the Graph app: no zoom/pan/selection/delete, unlike
// TimeSeriesChart.tsx (which is a Workbench-editing surface tightly coupled
// to point-selection/confirm/settings context this standalone app doesn't
// provide). Reuses the same series-extraction utilities (`extractChartSeries`
// from src/visualization/charts/series.ts) so the underlying data prep is
// identical to Workbench's charts — only the rendering is simpler, per the
// design doc's "reuse src/visualization/charts, don't add Recharts" decision.
import { useMemo } from 'react'

export interface GraphSeries {
  label: string
  color: string
  kind: 'line' | 'scatter'
  points: Array<{ x: number; y: number }>
}

interface Props {
  title: string
  xLabel: string
  yLabel: string
  series: readonly GraphSeries[]
  /** Formats an X tick value; defaults to the raw number. */
  formatX?: (x: number) => string
  height?: number
}

const MARGIN = { top: 12, right: 16, bottom: 28, left: 48 }

export function GraphChart({ title, xLabel, yLabel, series, formatX, height = 220 }: Props) {
  const width = 480
  const domain = useMemo(() => computeDomains(series), [series])

  const plotWidth = width - MARGIN.left - MARGIN.right
  const plotHeight = height - MARGIN.top - MARGIN.bottom

  const toScreenX = (x: number) => MARGIN.left + normalize(x, domain.xLo, domain.xHi) * plotWidth
  const toScreenY = (y: number) => MARGIN.top + (1 - normalize(y, domain.yLo, domain.yHi)) * plotHeight

  const hasData = series.some((s) => s.points.length > 0)

  return (
    <div className="graph-chart">
      <div className="graph-chart-title">{title}</div>
      {!hasData ? (
        <p className="muted small">No data for this channel.</p>
      ) : (
        <svg width={width} height={height} role="img" aria-label={title}>
          <rect x={MARGIN.left} y={MARGIN.top} width={plotWidth} height={plotHeight} className="graph-chart-plot-bg" />
          {series.map((s) => (
            <g key={s.label}>
              {s.kind === 'line' && s.points.length > 1 && (
                <polyline
                  fill="none"
                  stroke={s.color}
                  strokeWidth={1.5}
                  points={s.points.map((p) => `${toScreenX(p.x)},${toScreenY(p.y)}`).join(' ')}
                />
              )}
              {s.kind === 'scatter' && s.points.map((p, index) => (
                <circle key={index} cx={toScreenX(p.x)} cy={toScreenY(p.y)} r={2} fill={s.color} />
              ))}
            </g>
          ))}
          <text x={MARGIN.left + plotWidth / 2} y={height - 4} textAnchor="middle" className="graph-chart-axis-label">{xLabel}</text>
          <text x={4} y={MARGIN.top + 8} className="graph-chart-axis-label">{yLabel}</text>
          <text x={MARGIN.left} y={MARGIN.top + plotHeight + 12} textAnchor="start" className="graph-chart-tick">
            {formatX ? formatX(domain.xLo) : domain.xLo.toFixed(1)}
          </text>
          <text x={width - MARGIN.right} y={MARGIN.top + plotHeight + 12} textAnchor="end" className="graph-chart-tick">
            {formatX ? formatX(domain.xHi) : domain.xHi.toFixed(1)}
          </text>
        </svg>
      )}
      <div className="graph-chart-legend">
        {series.map((s) => (
          <span key={s.label} className="graph-chart-legend-item">
            <span className="graph-chart-swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function computeDomains(series: readonly GraphSeries[]): { xLo: number; xHi: number; yLo: number; yHi: number } {
  let xLo = Infinity, xHi = -Infinity, yLo = Infinity, yHi = -Infinity
  for (const s of series) {
    for (const p of s.points) {
      if (p.x < xLo) xLo = p.x
      if (p.x > xHi) xHi = p.x
      if (p.y < yLo) yLo = p.y
      if (p.y > yHi) yHi = p.y
    }
  }
  if (!Number.isFinite(xLo)) return { xLo: 0, xHi: 1, yLo: 0, yHi: 1 }
  if (xLo === xHi) { xLo -= 1; xHi += 1 }
  if (yLo === yHi) { yLo -= 1; yHi += 1 }
  return { xLo, xHi, yLo, yHi }
}

function normalize(value: number, lo: number, hi: number): number {
  if (hi === lo) return 0.5
  return (value - lo) / (hi - lo)
}
