// Dependency-free SVG line chart for plotting any numeric channel against time
// (or sample index). Multiple channels overlay with independent normalization,
// and a hover crosshair reads out exact values — built for signal inspection.
import { useMemo, useRef, useState } from 'react'
import type { TrackPoint } from '../core/model'
import { epochMsToIso } from '../core/format'

interface Series {
  key: string
  color: string
  values: Array<{ x: number; y: number }>
  min: number
  max: number
}

const PALETTE = ['#ea4f2f', '#0f8c6f', '#3b82f6', '#eab308', '#a855f7', '#ec4899', '#14b8a6']

export function TimeSeriesChart({
  points,
  channels,
}: {
  points: TrackPoint[]
  channels: string[]
}) {
  const available = useMemo(() => ['elevation', ...channels], [channels])
  const [selected, setSelected] = useState<string[]>(() =>
    available.includes('elevation') ? ['elevation'] : available.slice(0, 1),
  )
  const [xAxis, setXAxis] = useState<'time' | 'index'>('time')
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const hasTime = useMemo(() => points.some((p) => p.time !== undefined), [points])
  const effectiveX = hasTime ? xAxis : 'index'

  const series = useMemo<Series[]>(() => {
    return selected.map((key, idx) => {
      const values: Array<{ x: number; y: number }> = []
      let min = Infinity
      let max = -Infinity
      points.forEach((p, i) => {
        const y = key === 'elevation' ? p.ele : toNum(p.ext?.[key])
        if (y === undefined || y === null || !Number.isFinite(y)) return
        const x = effectiveX === 'time' && p.time !== undefined ? p.time : i
        values.push({ x, y })
        if (y < min) min = y
        if (y > max) max = y
      })
      return { key, color: PALETTE[idx % PALETTE.length], values, min, max }
    })
  }, [points, selected, effectiveX])

  const xDomain = useMemo(() => {
    let lo = Infinity
    let hi = -Infinity
    for (const s of series)
      for (const v of s.values) {
        if (v.x < lo) lo = v.x
        if (v.x > hi) hi = v.x
      }
    return Number.isFinite(lo) ? { lo, hi: hi === lo ? lo + 1 : hi } : null
  }, [series])

  const width = 900
  const height = 320
  const pad = { top: 16, right: 16, bottom: 34, left: 56 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom

  const toggle = (key: string) =>
    setSelected((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))

  if (available.length === 0) {
    return <div className="chart-empty">No numeric channels available to plot.</div>
  }

  const xToPx = (x: number) =>
    xDomain ? pad.left + ((x - xDomain.lo) / (xDomain.hi - xDomain.lo)) * plotW : pad.left

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || !xDomain) return
    const rect = svgRef.current.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * width
    const frac = (px - pad.left) / plotW
    setHover(xDomain.lo + Math.max(0, Math.min(1, frac)) * (xDomain.hi - xDomain.lo))
  }

  return (
    <div className="chart">
      <div className="chart-toolbar">
        <div className="chart-channels">
          {available.map((key) => (
            <button
              key={key}
              type="button"
              className={`chip${selected.includes(key) ? ' chip-on' : ''}`}
              style={selected.includes(key) ? { borderColor: PALETTE[selected.indexOf(key) % PALETTE.length] } : undefined}
              onClick={() => toggle(key)}
            >
              <span className="chip-dot" style={{ background: selected.includes(key) ? PALETTE[selected.indexOf(key) % PALETTE.length] : '#475569' }} />
              {key}
            </button>
          ))}
        </div>
        {hasTime && (
          <label className="chart-xaxis">
            x-axis
            <select value={xAxis} onChange={(e) => setXAxis(e.target.value as 'time' | 'index')}>
              <option value="time">time</option>
              <option value="index">index</option>
            </select>
          </label>
        )}
      </div>

      <svg
        ref={svgRef}
        className="chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <line
            key={g}
            x1={pad.left}
            x2={width - pad.right}
            y1={pad.top + g * plotH}
            y2={pad.top + g * plotH}
            className="chart-grid"
          />
        ))}
        {series.map((s) => {
          if (s.values.length < 2) return null
          const span = s.max - s.min || 1
          const d = s.values
            .map((v, i) => {
              const x = xToPx(v.x)
              const y = pad.top + plotH - ((v.y - s.min) / span) * plotH
              return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
            })
            .join(' ')
          return <path key={s.key} d={d} className="chart-line" style={{ stroke: s.color }} />
        })}

        {hover !== null && xDomain && (
          <line x1={xToPx(hover)} x2={xToPx(hover)} y1={pad.top} y2={pad.top + plotH} className="chart-crosshair" />
        )}

        {/* y-axis labels for the first series */}
        {series[0] && series[0].values.length > 1 && (
          <>
            <text x={4} y={pad.top + 4} className="chart-axis-label">{fmt(series[0].max)}</text>
            <text x={4} y={pad.top + plotH} className="chart-axis-label">{fmt(series[0].min)}</text>
          </>
        )}
      </svg>

      {hover !== null && (
        <div className="chart-readout mono">
          <span className="chart-readout-x">
            {effectiveX === 'time' ? epochMsToIso(hover) : `index ${Math.round(hover)}`}
          </span>
          {series.map((s) => {
            const nearest = nearestValue(s.values, hover)
            return nearest ? (
              <span key={s.key} style={{ color: s.color }}>
                {s.key}: {fmt(nearest.y)}
              </span>
            ) : null
          })}
        </div>
      )}
    </div>
  )
}

function nearestValue(values: Array<{ x: number; y: number }>, x: number) {
  if (values.length === 0) return null
  let best = values[0]
  let bestDist = Math.abs(values[0].x - x)
  for (const v of values) {
    const d = Math.abs(v.x - x)
    if (d < bestDist) {
      bestDist = d
      best = v
    }
  }
  return best
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1000) return n.toFixed(0)
  if (Math.abs(n) >= 1) return n.toFixed(2)
  return n.toFixed(4)
}
