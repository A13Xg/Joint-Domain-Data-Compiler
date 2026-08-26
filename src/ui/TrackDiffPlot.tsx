// The original track and a proposed repair drawn on one frame.
//
// Deliberately not a Leaflet map: the decision belongs next to the button the
// user pressed, it has to render with no network, and a basemap would put tiles
// between the user and the only thing that matters here — where the two paths
// disagree. The original is drawn muted and dashed underneath, the repair solid
// on top, and the samples the repair added, removed, or moved are marked.
//
// Dense tracks are thinned for display only (non-negotiable #1); the sample
// count actually drawn is always stated on the plot.

import { useMemo } from 'react'
import type { TrackPoint } from '../core/model'
import type { PointDiffEntry, TrackDiff } from '../core/repair/diff'
import { epochMsToIso } from '../core/format'
import {
  MAX_PLAN_SAMPLES, buildPlanFrame, formatScaleBar, isPlottable, niceScaleBarMeters, planStride, projectPoint, projectTrack,
  type PlanFrame, type PlanPoint,
} from '../visualization/diff/planProjection'

const VIEW_WIDTH = 720
const VIEW_HEIGHT = 420
const PLAN_PADDING = 28
const PROFILE_PADDING = { left: 62, right: 16, top: 18, bottom: 34 }

// Every flagged sample is a marker, and a repair can flag thousands. Beyond
// this the markers stop being readable and start costing frames, so they are
// evenly sampled — and the plot says so rather than quietly showing a subset.
const MAX_DIFF_MARKERS = 300

export type DiffPlotView = 'plan' | 'profile'

interface Props {
  before: readonly TrackPoint[]
  after: readonly TrackPoint[]
  diff: TrackDiff
  view: DiffPlotView
  /** Highlights one sample, used by the point visualizer. */
  focusIndex?: number
}

export function TrackDiffPlot({ before, after, diff, view, focusIndex }: Props) {
  return view === 'plan'
    ? <PlanDiff before={before} after={after} diff={diff} focusIndex={focusIndex} />
    : <ProfileDiff before={before} after={after} diff={diff} focusIndex={focusIndex} />
}

function PlanDiff({ before, after, diff, focusIndex }: Omit<Props, 'view'>) {
  const frame = useMemo(() => buildPlanFrame([before, after], VIEW_WIDTH, VIEW_HEIGHT, PLAN_PADDING), [before, after])
  const beforePath = useMemo(() => (frame ? projectTrack(before, frame) : []), [before, frame])
  const afterPath = useMemo(() => (frame ? projectTrack(after, frame) : []), [after, frame])
  const markers = useMemo(() => (frame ? planMarkers(before, after, diff, frame) : []), [before, after, diff, frame])

  if (!frame) {
    return <EmptyPlot message="No plottable coordinates in either track — compare the profile view or the counts below." />
  }

  const barMeters = niceScaleBarMeters(frame)
  const barPixels = barMeters * frame.scale
  const stride = Math.max(planStride(before.length), planStride(after.length))

  return (
    <figure className="diff-plot">
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Plan view: original track and proposed repair, ${diff.beforeCount.toLocaleString()} points before and ${diff.afterCount.toLocaleString()} after`}
      >
        <rect className="diff-plot-bg" x={0} y={0} width={VIEW_WIDTH} height={VIEW_HEIGHT} />
        <polyline className="diff-line diff-line-before" points={toPointsAttribute(beforePath)} />
        <polyline className="diff-line diff-line-after" points={toPointsAttribute(afterPath)} />
        {markers.map((marker) => <DiffMarker key={`${marker.kind}-${marker.key}`} marker={marker} />)}
        {focusIndex !== undefined && <FocusRing path={afterPath} focusIndex={focusIndex} />}
        <g className="diff-scalebar" transform={`translate(${PLAN_PADDING}, ${VIEW_HEIGHT - 16})`}>
          <line x1={0} y1={0} x2={barPixels} y2={0} />
          <line x1={0} y1={-4} x2={0} y2={4} />
          <line x1={barPixels} y1={-4} x2={barPixels} y2={4} />
          <text x={barPixels / 2} y={-8}>{formatScaleBar(barMeters)}</text>
        </g>
      </svg>
      <figcaption className="diff-plot-caption muted small">
        Equal-aspect local plan view.{' '}
        {stride > 1
          ? `Paths drawn from every ${ordinal(stride)} sample (display only — the full track is what gets applied).`
          : 'Every sample drawn.'}
      </figcaption>
    </figure>
  )
}

function ProfileDiff({ before, after, diff, focusIndex }: Omit<Props, 'view'>) {
  const profile = useMemo(() => buildProfile(before, after), [before, after])

  if (!profile) {
    return <EmptyPlot message="Neither track carries elevation or timestamps, so there is no profile to compare." />
  }

  const { beforeSamples, afterSamples, xLabel, yLabel, xMin, xMax, yMin, yMax } = profile
  const plotWidth = VIEW_WIDTH - PROFILE_PADDING.left - PROFILE_PADDING.right
  const plotHeight = VIEW_HEIGHT - PROFILE_PADDING.top - PROFILE_PADDING.bottom
  const toX = (value: number) => PROFILE_PADDING.left + ((value - xMin) / Math.max(xMax - xMin, 1e-9)) * plotWidth
  const toY = (value: number) => PROFILE_PADDING.top + plotHeight - ((value - yMin) / Math.max(yMax - yMin, 1e-9)) * plotHeight
  const project = (samples: ProfileSample[]) => samples.map((sample) => ({ sourceIndex: sample.sourceIndex, x: toX(sample.x), y: toY(sample.y) }))

  return (
    <figure className="diff-plot">
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Profile view: ${yLabel} against ${xLabel}, original track and proposed repair`}
      >
        <rect className="diff-plot-bg" x={0} y={0} width={VIEW_WIDTH} height={VIEW_HEIGHT} />
        <g className="diff-axis">
          <line x1={PROFILE_PADDING.left} y1={PROFILE_PADDING.top} x2={PROFILE_PADDING.left} y2={PROFILE_PADDING.top + plotHeight} />
          <line x1={PROFILE_PADDING.left} y1={PROFILE_PADDING.top + plotHeight} x2={PROFILE_PADDING.left + plotWidth} y2={PROFILE_PADDING.top + plotHeight} />
          <text className="diff-axis-label" x={PROFILE_PADDING.left} y={PROFILE_PADDING.top - 6}>{formatAxisValue(yMax, yLabel)}</text>
          <text className="diff-axis-label" x={PROFILE_PADDING.left} y={PROFILE_PADDING.top + plotHeight + 14}>{formatAxisValue(yMin, yLabel)}</text>
          <text className="diff-axis-label diff-axis-x" x={PROFILE_PADDING.left + plotWidth} y={PROFILE_PADDING.top + plotHeight + 26}>{xLabel}</text>
        </g>
        <polyline className="diff-line diff-line-before" points={toPointsAttribute(project(beforeSamples))} />
        <polyline className="diff-line diff-line-after" points={toPointsAttribute(project(afterSamples))} />
        {focusIndex !== undefined && <FocusRing path={project(afterSamples)} focusIndex={focusIndex} />}
      </svg>
      <figcaption className="diff-plot-caption muted small">
        {yLabel} against {xLabel}.{' '}
        {diff.alignment === 'rebuilt'
          ? 'The repair resynthesized the samples, so the two lines share only the axes.'
          : 'The original is dashed beneath the proposed repair.'}
      </figcaption>
    </figure>
  )
}

function DiffMarker({ marker }: { marker: PlanMarker }) {
  const size = marker.kind === 'modified' ? 3 : 4
  if (marker.kind === 'removed') {
    return (
      <g className="diff-marker diff-marker-removed">
        <line x1={marker.x - size} y1={marker.y - size} x2={marker.x + size} y2={marker.y + size} />
        <line x1={marker.x - size} y1={marker.y + size} x2={marker.x + size} y2={marker.y - size} />
      </g>
    )
  }
  if (marker.kind === 'added') {
    return (
      <g className="diff-marker diff-marker-added">
        <line x1={marker.x - size} y1={marker.y} x2={marker.x + size} y2={marker.y} />
        <line x1={marker.x} y1={marker.y - size} x2={marker.x} y2={marker.y + size} />
      </g>
    )
  }
  return <circle className="diff-marker diff-marker-modified" cx={marker.x} cy={marker.y} r={size} />
}

function FocusRing({ path, focusIndex }: { path: PlanPoint[]; focusIndex: number }) {
  const target = path.find((point) => point.sourceIndex === focusIndex)
    ?? path.reduce<PlanPoint | null>((closest, point) => (
      !closest || Math.abs(point.sourceIndex - focusIndex) < Math.abs(closest.sourceIndex - focusIndex) ? point : closest
    ), null)
  if (!target) return null
  return <circle className="diff-focus-ring" cx={target.x} cy={target.y} r={7} />
}

function EmptyPlot({ message }: { message: string }) {
  return <p className="diff-plot-empty muted">{message}</p>
}

interface PlanMarker {
  kind: 'added' | 'removed' | 'modified'
  key: number
  x: number
  y: number
}

interface ProfileSample {
  sourceIndex: number
  x: number
  y: number
}

interface ProfileData {
  beforeSamples: ProfileSample[]
  afterSamples: ProfileSample[]
  xLabel: string
  yLabel: string
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

function planMarkers(
  before: readonly TrackPoint[],
  after: readonly TrackPoint[],
  diff: TrackDiff,
  frame: PlanFrame,
): PlanMarker[] {
  let flaggedCount = 0
  for (const entry of diff.entries) if (entry.kind !== 'unchanged') flaggedCount++
  if (flaggedCount === 0) return []

  // Two passes over `entries` rather than one filtered copy: a repair that
  // touches every sample of a half-million-point track would otherwise
  // allocate a second half-million-entry array to keep 300 of them.
  const stride = Math.max(1, Math.ceil(flaggedCount / MAX_DIFF_MARKERS))
  const markers: PlanMarker[] = []
  let flaggedSeen = 0

  for (const entry of diff.entries) {
    if (entry.kind === 'unchanged') continue
    const position = flaggedSeen++
    if (position % stride !== 0) continue
    const source = markerSource(entry, before, after)
    if (!source || !isPlottable(source)) continue
    const placed = projectPoint(source, frame)
    if (!placed) continue
    markers.push({ kind: entry.kind, key: position, x: placed.x, y: placed.y })
  }
  return markers
}

function markerSource(entry: PointDiffEntry, before: readonly TrackPoint[], after: readonly TrackPoint[]): TrackPoint | undefined {
  // A modified sample is marked where the repair put it, not where it was: the
  // original position is already on the dashed path underneath.
  if (entry.kind === 'removed') return entry.beforeIndex === undefined ? undefined : before[entry.beforeIndex]
  return entry.afterIndex === undefined ? undefined : after[entry.afterIndex]
}

/**
 * Picks the most informative profile the two tracks can both support:
 * elevation where it exists, otherwise the timestamps themselves — which is
 * what makes a pure retiming repair (de-jitter, shift time) visible at all.
 */
function buildProfile(before: readonly TrackPoint[], after: readonly TrackPoint[]): ProfileData | null {
  const hasElevation = before.some((point) => point.ele !== undefined) || after.some((point) => point.ele !== undefined)
  const hasTime = before.some((point) => point.time !== undefined) || after.some((point) => point.time !== undefined)
  if (!hasElevation && !hasTime) return null

  const yLabel = hasElevation ? 'Elevation (m)' : 'Timestamp'
  const xLabel = hasElevation ? (hasTime ? 'Time' : 'Sample index') : 'Sample index'
  const readY = (point: TrackPoint) => (hasElevation ? point.ele : point.time)
  const readX = (point: TrackPoint, index: number) => (hasElevation && hasTime ? point.time : index)

  const beforeSamples = collectProfile(before, readX, readY)
  const afterSamples = collectProfile(after, readX, readY)
  if (beforeSamples.length === 0 && afterSamples.length === 0) return null

  const all = [...beforeSamples, ...afterSamples]
  const xMin = Math.min(...all.map((sample) => sample.x))
  const xMax = Math.max(...all.map((sample) => sample.x))
  const yMin = Math.min(...all.map((sample) => sample.y))
  const yMax = Math.max(...all.map((sample) => sample.y))

  return { beforeSamples, afterSamples, xLabel, yLabel, xMin, xMax, yMin, yMax }
}

function collectProfile(
  points: readonly TrackPoint[],
  readX: (point: TrackPoint, index: number) => number | undefined,
  readY: (point: TrackPoint) => number | undefined,
): ProfileSample[] {
  const stride = planStride(points.length, MAX_PLAN_SAMPLES)
  const samples: ProfileSample[] = []
  for (let index = 0; index < points.length; index += stride) {
    const point = points[index]!
    const x = readX(point, index)
    const y = readY(point)
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue
    samples.push({ sourceIndex: index, x, y })
  }
  return samples
}

function toPointsAttribute(path: readonly { x: number; y: number }[]): string {
  return path.map((point) => `${round(point.x)},${round(point.y)}`).join(' ')
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function formatAxisValue(value: number, label: string): string {
  if (label === 'Timestamp') return epochMsToIso(value)
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function ordinal(value: number): string {
  const suffix = value % 100 >= 11 && value % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'
  return `${value}${suffix}`
}
