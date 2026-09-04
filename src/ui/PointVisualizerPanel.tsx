// The point visualizer: one sample at a time, seen in its own neighbourhood.
//
// The Table tab already lists every field of every point. What it cannot show
// is *shape* — whether a sample sits on the line its neighbours describe or off
// to one side of it, and by how many metres. That is what this view is for, so
// the local plan view is the centre of it and the field list is support.
//
// Selection is the shared store, so stepping through samples here moves the
// map, the charts, and the table with it.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dataset, TrackPoint } from '../core/model'
import { haversineMeters } from '../core/model'
import { epochMsToIso } from '../core/format'
import { formatAltitude, formatDistance, formatSpeed, type UnitSystem } from '../core/units'
import { useAppSettings } from '../state/settings'
import { initialBearingDegrees } from '../core/operations/angular'
import { DEFAULT_QUALITY_EVENT_CONFIG, detectQualityEvents, type QualityEvent } from '../core/quality/events'
import { usePointSelection } from '../state/pointSelection'
import {
  buildPlanFrame, formatScaleBar, isPlottable, niceScaleBarMeters, projectPoint, projectTrack,
} from '../visualization/diff/planProjection'

const NEIGHBOURHOOD_SIZES = [5, 10, 25, 50, 100] as const
const PLAN_WIDTH = 460
const PLAN_HEIGHT = 320
const PLAN_PADDING = 26
const PROFILE_WIDTH = 460
const PROFILE_HEIGHT = 120

// The strip is one column per pixel of a fixed-width SVG; a long track shares
// columns between many samples, and the caption says so rather than implying
// every sample has its own tick.
const STRIP_WIDTH = 960
const STRIP_HEIGHT = 34

const SEVERITY_NONE = 0
const SEVERITY_INFO = 1
const SEVERITY_WARNING = 2
const SEVERITY_ERROR = 3

interface Props {
  dataset: Dataset
}

export function PointVisualizerPanel({ dataset }: Props) {
  const points = dataset.points
  const { pointIndex, hoverIndex, selectPoint, setHoverIndex } = usePointSelection(points)
  const [neighbourhood, setNeighbourhood] = useState<number>(10)
  const { unitSystem } = useAppSettings()
  const indexInputRef = useRef<HTMLInputElement>(null)

  const events = useMemo(() => detectQualityEvents([...points], DEFAULT_QUALITY_EVENT_CONFIG), [points])
  const severity = useMemo(() => severityByIndex(points.length, events), [points.length, events])

  // Nothing selected yet still has to show something, or the tab reads as
  // broken; the first sample is the honest default and the caption says so.
  const focus = pointIndex ?? hoverIndex ?? (points.length > 0 ? 0 : null)
  const following = pointIndex !== null || hoverIndex !== null

  useEffect(() => {
    if (indexInputRef.current && document.activeElement !== indexInputRef.current) {
      indexInputRef.current.value = focus === null ? '' : String(focus)
    }
  }, [focus])

  if (points.length === 0) {
    return <div className="point-visualizer"><p className="muted pad">This dataset has no points to visualize.</p></div>
  }

  const index = focus ?? 0
  const point = points[index]!
  const range = neighbourhoodSlice(points, index, neighbourhood)
  const overlapping = events.filter((event) => event.startIndex <= index && index <= event.endIndex)

  const step = (delta: number) => selectPoint(clamp(index + delta, 0, points.length - 1))

  return (
    <div className="point-visualizer">
      <header className="point-visualizer-head analysis-toolbar">
        <h3>Point visualizer</h3>
        <button type="button" onClick={() => step(-1)} disabled={index === 0} aria-label="Previous point">← Prev</button>
        <label className="num-field">
          <span>index</span>
          <input
            ref={indexInputRef}
            type="number"
            min={0}
            max={points.length - 1}
            defaultValue={index}
            aria-label="Point index"
            onChange={(event) => {
              const requested = Number(event.target.value)
              if (Number.isInteger(requested) && requested >= 0 && requested < points.length) selectPoint(requested)
            }}
          />
        </label>
        <button type="button" onClick={() => step(1)} disabled={index === points.length - 1} aria-label="Next point">Next →</button>
        <span className="muted small">of {points.length.toLocaleString()}</span>
        <label className="num-field">
          <span>neighbours</span>
          <select value={neighbourhood} onChange={(event) => setNeighbourhood(Number(event.target.value))}>
            {NEIGHBOURHOOD_SIZES.map((size) => <option key={size} value={size}>±{size}</option>)}
          </select>
        </label>
        {!following && <span className="muted small">Showing the first sample — select a point anywhere in the workspace to follow it here.</span>}
      </header>

      <PointStrip
        count={points.length}
        severity={severity}
        index={index}
        onSelect={selectPoint}
        onHover={setHoverIndex}
      />

      <div className="point-visualizer-body">
        <section className="point-neighbourhood">
          <h4>Neighbourhood</h4>
          <NeighbourhoodPlan points={points} range={range} index={index} onSelect={selectPoint} />
          <NeighbourhoodProfile points={points} range={range} index={index} unitSystem={unitSystem} />
        </section>

        <section className="point-detail">
          <h4>Sample {index.toLocaleString()}</h4>
          <dl className="point-fields">
            <Field label="Latitude" value={formatDegrees(point.lat, 'lat')} />
            <Field label="Longitude" value={formatDegrees(point.lon, 'lon')} />
            <Field label="Elevation" value={point.ele === undefined ? '—' : formatAltitude(point.ele, unitSystem, 3)} />
            <Field label="Time" value={point.time === undefined ? 'untimed' : epochMsToIso(point.time)} />
            <Field label="Epoch ms" value={point.time === undefined ? '—' : String(point.time)} />
            {point.name && <Field label="Name" value={point.name} />}
            {point.desc && <Field label="Description" value={point.desc} />}
            <Field label="Source record" value={point.provenance?.sourceRecord === undefined ? '—' : String(point.provenance.sourceRecord)} />
            <Field label="Source segment" value={point.provenance?.sourceSegment ?? '—'} />
            <Field label="Geometry index" value={point.provenance?.sourceFeatureIndex === undefined ? '—' : String(point.provenance.sourceFeatureIndex)} />
          </dl>

          {point.provenance?.qualityFlags && point.provenance.qualityFlags.length > 0 && (
            <div className="point-flags">
              {point.provenance.qualityFlags.map((flag) => <span key={flag} className="badge point-flag">{flag}</span>)}
            </div>
          )}

          {overlapping.length > 0 && (
            <ul className="point-events small">
              {overlapping.map((event) => (
                <li key={event.id} className={`point-event severity-${event.severity}`}>
                  <strong>{event.kind}</strong> {event.explanation}
                </li>
              ))}
            </ul>
          )}

          <NeighbourDeltas points={points} index={index} unitSystem={unitSystem} />

          <ChannelValues point={point} />
        </section>
      </div>
    </div>
  )
}

function PointStrip({ count, severity, index, onSelect, onHover }: {
  count: number
  severity: Uint8Array
  index: number
  onSelect: (index: number) => void
  onHover: (index: number | null) => void
}) {
  const columns = Math.min(STRIP_WIDTH, count)
  const perColumn = count / columns
  const bars = useMemo(() => {
    const worst = new Uint8Array(columns)
    for (let sample = 0; sample < count; sample++) {
      const column = Math.min(columns - 1, Math.floor(sample / perColumn))
      const value = severity[sample] ?? SEVERITY_NONE
      if (value > worst[column]!) worst[column] = value
    }
    return worst
  }, [columns, count, perColumn, severity])

  const indexAt = (clientRatio: number) => clamp(Math.floor(clientRatio * count), 0, count - 1)
  const markerX = (index / Math.max(count - 1, 1)) * STRIP_WIDTH

  return (
    <figure className="point-strip">
      <svg
        viewBox={`0 0 ${STRIP_WIDTH} ${STRIP_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Sample quality strip across ${count.toLocaleString()} points`}
        onMouseLeave={() => onHover(null)}
        onMouseMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          if (bounds.width > 0) onHover(indexAt((event.clientX - bounds.left) / bounds.width))
        }}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          if (bounds.width > 0) onSelect(indexAt((event.clientX - bounds.left) / bounds.width))
        }}
      >
        <rect className="strip-bg" x={0} y={0} width={STRIP_WIDTH} height={STRIP_HEIGHT} />
        {Array.from(bars, (value, column) => (
          value === SEVERITY_NONE ? null : (
            <rect
              key={column}
              className={`strip-bar strip-${severityName(value)}`}
              x={(column / columns) * STRIP_WIDTH}
              y={0}
              width={Math.max(STRIP_WIDTH / columns, 1)}
              height={STRIP_HEIGHT}
            />
          )
        ))}
        <line className="strip-marker" x1={markerX} y1={0} x2={markerX} y2={STRIP_HEIGHT} />
      </svg>
      <figcaption className="muted small">
        Quality events across the track; click to jump. {perColumn > 1 ? `Each column covers ${Math.ceil(perColumn).toLocaleString()} samples and shows the worst of them.` : 'One column per sample.'}
      </figcaption>
    </figure>
  )
}

function NeighbourhoodPlan({ points, range, index, onSelect }: {
  points: readonly TrackPoint[]
  range: { start: number; end: number }
  index: number
  onSelect: (index: number) => void
}) {
  const slice = useMemo(() => points.slice(range.start, range.end + 1), [points, range.start, range.end])
  const frame = useMemo(() => buildPlanFrame([slice], PLAN_WIDTH, PLAN_HEIGHT, PLAN_PADDING), [slice])

  if (!frame) return <p className="muted small">No plottable coordinates near this sample.</p>

  const path = projectTrack(slice, frame)
  const focused = projectPoint(points[index]!, frame)
  const barMeters = niceScaleBarMeters(frame)
  const barPixels = barMeters * frame.scale

  return (
    <figure className="diff-plot point-plan">
      <svg viewBox={`0 0 ${PLAN_WIDTH} ${PLAN_HEIGHT}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Local plan view of samples ${range.start} to ${range.end}`}>
        <rect className="diff-plot-bg" x={0} y={0} width={PLAN_WIDTH} height={PLAN_HEIGHT} />
        <polyline className="diff-line diff-line-after" points={path.map((node) => `${node.x},${node.y}`).join(' ')} />
        {path.map((node) => (
          <circle
            key={node.sourceIndex}
            className="point-node"
            cx={node.x}
            cy={node.y}
            r={2.5}
            onClick={() => onSelect(range.start + node.sourceIndex)}
          />
        ))}
        {focused && <circle className="diff-focus-ring" cx={focused.x} cy={focused.y} r={7} />}
        <g className="diff-scalebar" transform={`translate(${PLAN_PADDING}, ${PLAN_HEIGHT - 14})`}>
          <line x1={0} y1={0} x2={barPixels} y2={0} />
          <line x1={0} y1={-4} x2={0} y2={4} />
          <line x1={barPixels} y1={-4} x2={barPixels} y2={4} />
          <text x={barPixels / 2} y={-8}>{formatScaleBar(barMeters)}</text>
        </g>
      </svg>
      <figcaption className="muted small">Samples {range.start.toLocaleString()}–{range.end.toLocaleString()}, equal aspect. Click a node to select it.</figcaption>
    </figure>
  )
}

function NeighbourhoodProfile({ points, range, index, unitSystem }: {
  points: readonly TrackPoint[]
  range: { start: number; end: number }
  index: number
  unitSystem: UnitSystem
}) {
  const samples: { index: number; ele: number }[] = []
  for (let cursor = range.start; cursor <= range.end; cursor++) {
    const value = points[cursor]?.ele
    if (value !== undefined && Number.isFinite(value)) samples.push({ index: cursor, ele: value })
  }
  if (samples.length < 2) return <p className="muted small">No elevation profile near this sample.</p>

  const min = Math.min(...samples.map((sample) => sample.ele))
  const max = Math.max(...samples.map((sample) => sample.ele))
  const toX = (value: number) => ((value - range.start) / Math.max(range.end - range.start, 1)) * (PROFILE_WIDTH - 8) + 4
  const toY = (value: number) => PROFILE_HEIGHT - 12 - ((value - min) / Math.max(max - min, 1e-9)) * (PROFILE_HEIGHT - 28)
  const focused = samples.find((sample) => sample.index === index)

  return (
    <figure className="diff-plot point-profile">
      <svg viewBox={`0 0 ${PROFILE_WIDTH} ${PROFILE_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label="Local elevation profile">
        <rect className="diff-plot-bg" x={0} y={0} width={PROFILE_WIDTH} height={PROFILE_HEIGHT} />
        <polyline className="diff-line diff-line-after" points={samples.map((sample) => `${toX(sample.index)},${toY(sample.ele)}`).join(' ')} />
        {focused && <circle className="diff-focus-ring" cx={toX(focused.index)} cy={toY(focused.ele)} r={5} />}
      </svg>
      <figcaption className="muted small">
        Elevation {formatAltitude(min, unitSystem, 1)} – {formatAltitude(max, unitSystem, 1)} across the neighbourhood.
      </figcaption>
    </figure>
  )
}

function NeighbourDeltas({ points, index, unitSystem }: { points: readonly TrackPoint[]; index: number; unitSystem: UnitSystem }) {
  const previous = index > 0 ? points[index - 1] : undefined
  const next = index < points.length - 1 ? points[index + 1] : undefined
  const point = points[index]!

  return (
    <table className="point-deltas">
      <caption className="muted small">Legs to the neighbouring samples</caption>
      <thead>
        <tr><th scope="col">Leg</th><th scope="col">Δt</th><th scope="col">Distance</th><th scope="col">Implied speed</th><th scope="col">Δ elevation</th><th scope="col">Bearing</th></tr>
      </thead>
      <tbody>
        <LegRow label="from previous" from={previous} to={point} unitSystem={unitSystem} />
        <LegRow label="to next" from={point} to={next} unitSystem={unitSystem} />
      </tbody>
    </table>
  )
}

function LegRow({ label, from, to, unitSystem }: { label: string; from?: TrackPoint; to?: TrackPoint; unitSystem: UnitSystem }) {
  if (!from || !to) return <tr><th scope="row">{label}</th><td colSpan={5} className="muted">no neighbouring sample</td></tr>

  const deltaMs = from.time !== undefined && to.time !== undefined ? to.time - from.time : undefined
  const plottable = isPlottable(from) && isPlottable(to)
  const meters = plottable ? haversineMeters(from.lat, from.lon, to.lat, to.lon) : undefined
  // An implied speed over a zero or backward interval is not a speed; the cell
  // stays empty rather than reporting an infinity the user has to decode.
  const speed = meters !== undefined && deltaMs !== undefined && deltaMs > 0 ? meters / (deltaMs / 1000) : undefined
  const deltaEle = from.ele !== undefined && to.ele !== undefined ? to.ele - from.ele : undefined
  const bearing = plottable ? initialBearingDegrees(from.lat, from.lon, to.lat, to.lon) : undefined

  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="mono">{deltaMs === undefined ? '—' : `${(deltaMs / 1000).toFixed(3)} s`}</td>
      <td className="mono">{meters === undefined ? '—' : formatDistance(meters, unitSystem)}</td>
      <td className="mono">{speed === undefined ? '—' : formatSpeed(speed, unitSystem, 2)}</td>
      <td className="mono">{deltaEle === undefined ? '—' : formatAltitude(deltaEle, unitSystem, 2)}</td>
      <td className="mono">{bearing === undefined ? '—' : `${bearing.toFixed(1)}°`}</td>
    </tr>
  )
}

function ChannelValues({ point }: { point: TrackPoint }) {
  const entries = Object.entries(point.ext ?? {})
  if (entries.length === 0) return <p className="muted small">This sample carries no additional channels.</p>
  const staleChannels = new Set(point.provenance?.staleChannels ?? [])
  return (
    <details className="point-channels" open>
      <summary>Channels ({entries.length})</summary>
      <dl className="point-fields">
        {entries.map(([name, value]) => (
          <Field key={name} label={name} value={value === undefined || value === null ? '—' : String(value)} stale={staleChannels.has(name)} />
        ))}
      </dl>
    </details>
  )
}

function Field({ label, value, stale }: { label: string; value: string; stale?: boolean }) {
  return <><dt>{label}{stale && <StaleBadge />}</dt><dd className="mono">{value}</dd></>
}

function StaleBadge() {
  return (
    <span
      className="badge stale-badge"
      title="Computed before a manual edit changed one of its inputs. Re-run Derive kinematics to refresh it."
    >
      stale
    </span>
  )
}

function neighbourhoodSlice(points: readonly TrackPoint[], index: number, radius: number): { start: number; end: number } {
  return { start: Math.max(0, index - radius), end: Math.min(points.length - 1, index + radius) }
}

function severityByIndex(count: number, events: readonly QualityEvent[]): Uint8Array {
  const severity = new Uint8Array(count)
  for (const event of events) {
    const rank = event.severity === 'error' ? SEVERITY_ERROR : event.severity === 'warning' ? SEVERITY_WARNING : SEVERITY_INFO
    const start = Math.max(0, event.startIndex)
    const end = Math.min(count - 1, event.endIndex)
    for (let cursor = start; cursor <= end; cursor++) if (severity[cursor]! < rank) severity[cursor] = rank
  }
  return severity
}

function severityName(value: number): string {
  if (value === SEVERITY_ERROR) return 'error'
  if (value === SEVERITY_WARNING) return 'warning'
  return 'info'
}

function formatDegrees(value: number, axis: 'lat' | 'lon'): string {
  if (!Number.isFinite(value)) return 'invalid'
  const hemisphere = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W')
  const absolute = Math.abs(value)
  const degrees = Math.floor(absolute)
  const minutesFull = (absolute - degrees) * 60
  const minutes = Math.floor(minutesFull)
  const seconds = (minutesFull - minutes) * 60
  return `${value.toFixed(6)}°  (${degrees}° ${String(minutes).padStart(2, '0')}′ ${seconds.toFixed(3).padStart(6, '0')}″ ${hemisphere})`
}

/** Metres up to 10 km, kilometres beyond it — a ten-thousand-kilometre leg in metres is unreadable. */
function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}
