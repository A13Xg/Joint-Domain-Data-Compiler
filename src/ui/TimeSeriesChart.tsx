import { useMemo, useRef, useState } from 'react'
import type { TrackPoint } from '../core/model'
import { epochMsToIso } from '../core/format'
import { calculateRangeStatistics } from '../core/analytics/rangeStatistics'
import { detectQualityEvents, type QualityEvent } from '../core/quality/events'
import {
  BUILT_IN_CHART_PRESETS,
  extractChartSeries,
  resolvePresetChannels,
  type ChartXAxis,
} from '../visualization/charts/series'
import { zoomDomain, isFullyZoomedOut, type Domain } from '../visualization/charts/zoom'
import { usePointSelection } from '../state/pointSelection'

/** Non-color patterns per severity so event markers remain distinguishable for colorblind/low-vision users. */
const EVENT_SEVERITY_DASH: Record<QualityEvent['severity'], string> = {
  error: 'none',
  warning: '4 2',
  info: '1 3',
}

interface SeriesValue {
  x: number
  y: number
  sourceIndex: number
}

interface Series {
  key: string
  color: string
  values: SeriesValue[]
  min: number
  max: number
}

const PALETTE = ['#ea4f2f', '#0f8c6f', '#3b82f6', '#eab308', '#a855f7', '#ec4899', '#14b8a6']
const MAX_RENDERED_SAMPLES = 1500

export function TimeSeriesChart({ points, channels }: { points: TrackPoint[]; channels: string[] }) {
  const available = useMemo(() => ['elevation', ...channels], [channels])
  const [selected, setSelected] = useState<string[]>(() => available.includes('elevation') ? ['elevation'] : available.slice(0, 1))
  const [xAxis, setXAxis] = useState<ChartXAxis>('time')
  const [presetId, setPresetId] = useState('altitude-time')
  const [hover, setHover] = useState<number | null>(null)
  const [dragStart, setDragStart] = useState<number | null>(null)
  const [zoomedDomain, setZoomedDomain] = useState<Domain | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const { pointIndex, hoverIndex, indexRange, selectPoint, selectRange, setHoverIndex, clearPointSelection, clearRangeSelection, clearHover } = usePointSelection(points)

  const hasTime = useMemo(() => points.some((point) => point.time !== undefined), [points])
  const hasDistance = useMemo(() => points.some((point) => typeof point.ext?.distance_m === 'number'), [points])
  const effectiveX: ChartXAxis = xAxis === 'time' && !hasTime ? 'index' : xAxis === 'distance' && !hasDistance ? 'index' : xAxis
  const qualityEvents = useMemo(() => detectQualityEvents(points), [points])

  const series = useMemo<Series[]>(() => selected.map((key, index) => {
    const data = extractChartSeries(points, key, effectiveX, MAX_RENDERED_SAMPLES)
    return {
      key,
      color: PALETTE[index % PALETTE.length]!,
      values: data.samples.map((sample) => ({ x: sample.x, y: sample.y, sourceIndex: sample.sourceIndex })),
      min: data.min,
      max: data.max,
    }
  }), [points, selected, effectiveX])

  const xDomain = useMemo(() => {
    let lo = Infinity
    let hi = -Infinity
    for (const item of series) {
      for (const value of item.values) {
        if (value.x < lo) lo = value.x
        if (value.x > hi) hi = value.x
      }
    }
    return Number.isFinite(lo) ? { lo, hi: hi === lo ? lo + 1 : hi } : null
  }, [series])

  const effectiveDomain = zoomedDomain ?? xDomain
  const isZoomed = zoomedDomain !== null && xDomain !== null && !isFullyZoomedOut(zoomedDomain, xDomain)

  const cursorX = useMemo(() => {
    if (hover !== null) return hover
    if (hoverIndex === null) return null
    return pointX(points[hoverIndex], hoverIndex, effectiveX)
  }, [hover, hoverIndex, points, effectiveX])

  const selectedX = useMemo(() => {
    if (pointIndex === null) return null
    return pointX(points[pointIndex], pointIndex, effectiveX)
  }, [pointIndex, points, effectiveX])

  const rangeX = useMemo(() => {
    if (!indexRange) return null
    const start = pointX(points[indexRange.start], indexRange.start, effectiveX)
    const end = pointX(points[indexRange.end], indexRange.end, effectiveX)
    return start !== null && end !== null ? { start, end } : null
  }, [indexRange, points, effectiveX])

  const eventMarkers = useMemo(() => qualityEvents
    .map((event) => ({ event, x: pointX(points[event.endIndex], event.endIndex, effectiveX) }))
    .filter((marker): marker is { event: QualityEvent; x: number } => marker.x !== null),
  [qualityEvents, points, effectiveX])

  const statistics = useMemo(
    () => indexRange ? calculateRangeStatistics(points, indexRange, selected) : null,
    [points, indexRange, selected],
  )

  const width = 900
  const height = 320
  const pad = { top: 16, right: 16, bottom: 34, left: 56 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom

  const applyPreset = (id: string) => {
    const preset = BUILT_IN_CHART_PRESETS.find((item) => item.id === id)
    if (!preset) return
    const resolved = resolvePresetChannels(preset, channels)
    setPresetId(id)
    setXAxis(preset.xAxis)
    setSelected(resolved.length > 0 ? resolved : ['elevation'])
    setZoomedDomain(null)
  }

  const toggle = (key: string) => setSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])

  if (available.length === 0) return <div className="chart-empty">No numeric channels available to plot.</div>

  const xToPx = (x: number) => effectiveDomain ? pad.left + ((x - effectiveDomain.lo) / (effectiveDomain.hi - effectiveDomain.lo)) * plotW : pad.left

  const eventX = (event: React.MouseEvent<SVGSVGElement>): number | null => {
    if (!svgRef.current || !effectiveDomain) return null
    const rect = svgRef.current.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * width
    const fraction = (px - pad.left) / plotW
    return effectiveDomain.lo + Math.max(0, Math.min(1, fraction)) * (effectiveDomain.hi - effectiveDomain.lo)
  }

  const onWheelZoom = (event: React.WheelEvent<SVGSVGElement>) => {
    if (!svgRef.current || !xDomain) return
    event.preventDefault()
    const rect = svgRef.current.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * width
    const fraction = (px - pad.left) / plotW
    const factor = event.deltaY > 0 ? 1.2 : 1 / 1.2
    setZoomedDomain((current) => zoomDomain(current ?? xDomain, xDomain, fraction, factor))
  }

  const onMouseDown = (event: React.MouseEvent<SVGSVGElement>) => setDragStart(eventX(event))
  const onMouseUp = (event: React.MouseEvent<SVGSVGElement>) => {
    const endX = eventX(event)
    const startX = dragStart
    setDragStart(null)
    const reference = series[0]
    if (startX === null || endX === null || !reference) return
    const start = nearestValue(reference.values, startX)
    const end = nearestValue(reference.values, endX)
    if (!start || !end) return
    const pixelSpan = Math.abs(xToPx(endX) - xToPx(startX))
    if (pixelSpan < 5) {
      selectPoint(pointIndex === end.sourceIndex ? null : end.sourceIndex)
      return
    }
    selectRange({ start: start.sourceIndex, end: end.sourceIndex })
  }

  return (
    <div className="chart">
      <div className="chart-toolbar">
        <label className="chart-xaxis">preset<select value={presetId} onChange={(event) => applyPreset(event.target.value)}>{BUILT_IN_CHART_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
        <div className="chart-channels">{available.map((key) => <button key={key} type="button" className={`chip${selected.includes(key) ? ' chip-on' : ''}`} style={selected.includes(key) ? { borderColor: PALETTE[selected.indexOf(key) % PALETTE.length] } : undefined} onClick={() => toggle(key)}><span className="chip-dot" style={{ background: selected.includes(key) ? PALETTE[selected.indexOf(key) % PALETTE.length] : '#475569' }} />{key}</button>)}</div>
        <label className="chart-xaxis">x-axis<select value={effectiveX} onChange={(event) => { setPresetId('custom'); setXAxis(event.target.value as ChartXAxis); setZoomedDomain(null) }}>{hasTime && <option value="time">time</option>}<option value="index">index</option>{hasDistance && <option value="distance">distance</option>}</select></label>
        {pointIndex !== null && <button type="button" className="chip chip-on" onClick={clearPointSelection}>point #{pointIndex} ×</button>}
        {indexRange && <button type="button" className="chip chip-range" onClick={clearRangeSelection}>range {indexRange.start}–{indexRange.end} ×</button>}
        {isZoomed && <button type="button" className="chip" onClick={() => setZoomedDomain(null)}>Reset zoom ×</button>}
      </div>

      <svg ref={svgRef} className="chart-svg" viewBox={`0 0 ${width} ${height}`} onMouseMove={(event) => { const x = eventX(event); setHover(x); const nearest = x === null ? null : nearestValue(series[0]?.values ?? [], x); setHoverIndex(nearest?.sourceIndex ?? null) }} onMouseLeave={() => { setHover(null); setDragStart(null); clearHover() }} onMouseDown={onMouseDown} onMouseUp={onMouseUp} onWheel={onWheelZoom} style={{ cursor: 'crosshair' }}>
        {[0, 0.25, 0.5, 0.75, 1].map((grid) => <line key={grid} x1={pad.left} x2={width - pad.right} y1={pad.top + grid * plotH} y2={pad.top + grid * plotH} className="chart-grid" />)}
        {rangeX && <rect x={Math.min(xToPx(rangeX.start), xToPx(rangeX.end))} y={pad.top} width={Math.abs(xToPx(rangeX.end) - xToPx(rangeX.start))} height={plotH} fill="rgba(234,79,47,0.12)" />}
        {series.map((item) => {
          if (item.values.length < 2) return null
          const span = item.max - item.min || 1
          const path = item.values.map((value, index) => {
            const x = xToPx(value.x)
            const y = pad.top + plotH - ((value.y - item.min) / span) * plotH
            return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
          }).join(' ')
          return <path key={item.key} d={path} className="chart-line" style={{ stroke: item.color }} />
        })}
        {xDomain && eventMarkers.map(({ event, x }) => <line key={event.id} x1={xToPx(x)} x2={xToPx(x)} y1={pad.top} y2={pad.top + plotH} className={`chart-event-marker chart-event-${event.severity}`} strokeDasharray={EVENT_SEVERITY_DASH[event.severity]}><title>{`${event.kind} (${event.severity}): ${event.explanation}`}</title></line>)}
        {cursorX !== null && xDomain && <line x1={xToPx(cursorX)} x2={xToPx(cursorX)} y1={pad.top} y2={pad.top + plotH} className="chart-crosshair" />}
        {dragStart !== null && hover !== null && <rect x={Math.min(xToPx(dragStart), xToPx(hover))} y={pad.top} width={Math.abs(xToPx(hover) - xToPx(dragStart))} height={plotH} fill="rgba(59,130,246,0.14)" />}
        {selectedX !== null && xDomain && <line x1={xToPx(selectedX)} x2={xToPx(selectedX)} y1={pad.top} y2={pad.top + plotH} style={{ stroke: '#ea4f2f', strokeWidth: 2 }} />}
        {series.filter((item) => item.values.length > 1).map((item, row) => <g key={item.key}><text x={4} y={pad.top + 4 + row * 11} className="chart-axis-label" style={{ fill: item.color }}>{item.key} ({channelUnit(item.key)}) max {fmt(item.max)}</text><text x={4} y={pad.top + plotH - row * 11} className="chart-axis-label" style={{ fill: item.color }}>{item.key} ({channelUnit(item.key)}) min {fmt(item.min)}</text></g>)}
        {effectiveDomain && <>
          <text x={pad.left} y={height - 7} className="chart-axis-label chart-axis-label--strong" textAnchor="start">{formatX(effectiveDomain.lo, effectiveX)}</text>
          <text x={width - pad.right} y={height - 7} className="chart-axis-label chart-axis-label--strong" textAnchor="end">{formatX(effectiveDomain.hi, effectiveX)}</text>
        </>}
      </svg>

      <div className="chart-readout chart-readout--persistent mono"><span className="chart-readout-x">{cursorX !== null ? `cursor ${formatX(cursorX, effectiveX)}` : 'Move over the plot for point details'}</span>{series.map((item) => { const nearest = cursorX === null ? null : nearestValue(item.values, cursorX); return <span key={item.key} style={{ color: item.color }}>{item.key} ({channelUnit(item.key)}): {nearest ? fmt(nearest.y) : '—'}</span> })}</div>
      {xDomain && <div className="chart-time-range mono"><span>{effectiveX === 'time' ? 'time range' : `${effectiveX} range`}</span><strong>start {formatX(xDomain.lo, effectiveX)}</strong><strong>end {formatX(xDomain.hi, effectiveX)}</strong>{isZoomed && <span>(zoomed view shown above)</span>}</div>}
      {statistics && <div className="chart-readout mono"><strong>{statistics.pointCount.toLocaleString()} pts</strong><span>{fmt(statistics.distanceMeters)} m</span>{statistics.durationSeconds !== undefined && <span>{fmt(statistics.durationSeconds)} s</span>}{Object.entries(statistics.channels).map(([id, summary]) => <span key={id}>{id}: μ {fmt(summary.mean)} · {fmt(summary.min)}–{fmt(summary.max)}</span>)}</div>}
      {qualityEvents.length > 0 && <div className="muted small chart-event-legend">⚠ {qualityEvents.length} quality event{qualityEvents.length === 1 ? '' : 's'} detected (solid = error, dashed = warning, dotted = info) — hover a marker for details.</div>}
      <div className="muted small">Click to select a point; drag to select a range. Rendering up to {MAX_RENDERED_SAMPLES.toLocaleString()} extrema-preserving samples per channel.</div>
    </div>
  )
}

function pointX(point: TrackPoint | undefined, index: number, axis: ChartXAxis): number | null {
  if (!point) return null
  if (axis === 'time') return point.time ?? null
  if (axis === 'distance') return typeof point.ext?.distance_m === 'number' ? point.ext.distance_m : null
  return index
}

function nearestValue(values: SeriesValue[], x: number): SeriesValue | null {
  if (values.length === 0) return null
  let best = values[0]!
  let bestDistance = Math.abs(best.x - x)
  for (const value of values) {
    const distance = Math.abs(value.x - x)
    if (distance < bestDistance) {
      bestDistance = distance
      best = value
    }
  }
  return best
}

function formatX(value: number, axis: ChartXAxis): string {
  if (axis === 'time') return epochMsToIso(value)
  if (axis === 'distance') return `${fmt(value)} m`
  return `index ${Math.round(value)}`
}

function channelUnit(key: string): string {
  if (key === 'elevation') return 'm'
  if (key.endsWith('_mps')) return 'm/s'
  if (key.endsWith('_mps2')) return 'm/s²'
  if (key.endsWith('_deg')) return '°'
  if (key.endsWith('_dps')) return '°/s'
  if (key.endsWith('_m')) return 'm'
  if (key.endsWith('_hz')) return 'Hz'
  if (key === 'hdop' || key === 'vdop' || key === 'pdop') return 'DOP'
  if (key === 'sat') return 'sats'
  return 'value'
}

function fmt(value: number): string {
  if (Math.abs(value) >= 1000) return value.toFixed(0)
  if (Math.abs(value) >= 1) return value.toFixed(2)
  return value.toFixed(4)
}
