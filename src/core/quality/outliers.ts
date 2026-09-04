import { haversineMeters, type TrackPoint } from '../model'
import { derivePointSpeeds } from './movementWindow'

export type OutlierChannel = 'position' | 'elevation' | 'speed'

export interface OutlierConfig {
  windowSize: number
  scoreThreshold: number
  minPositionScaleMeters: number
  minElevationScaleMeters: number
  minSpeedScaleMps: number
  /**
   * Channels allowed to flag a point. Omitted means all three.
   *
   * `channelByIndex` reports only the channel with the *highest* score, so it
   * cannot be used to filter after the fact: a point whose speed residual
   * dominates may also have broken the position threshold, and dropping it
   * from a position-only selection on that basis would be wrong in both
   * directions. Restricting the channels here scores the subset directly.
   */
  channels?: readonly OutlierChannel[]
}

export interface OutlierResult {
  flaggedIndices: number[]
  scoreByIndex: Map<number, number>
  /** Which channel produced the point's score, for drill-down labels. */
  channelByIndex: Map<number, OutlierChannel>
}

export const ALL_OUTLIER_CHANNELS: readonly OutlierChannel[] = ['position', 'elevation', 'speed']

/** Scales a median absolute deviation to a standard-deviation equivalent for normally distributed data. */
const MAD_TO_SIGMA = 1.4826

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0
  const mid = sorted.length / 2
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : sorted[Math.floor(mid)] ?? 0
}

/**
 * Median absolute deviation.
 *
 * The deviations must be re-sorted before their median is taken: deviations computed over an
 * already-sorted input are V-shaped, so indexing their midpoint without sorting returns the
 * series minimum (usually 0) rather than the median.
 */
export function medianAbsoluteDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const center = median(sorted)
  const deviations = sorted.map((value) => Math.abs(value - center)).sort((left, right) => left - right)
  return median(deviations)
}

/**
 * Median of an unsorted series.
 *
 * The window predictor uses a median rather than a mean so that the very point under test —
 * or another spike sharing its window — cannot drag the prediction toward itself and mask the
 * anomaly, or smear it across the neighbours.
 */
function medianOf(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined
  return median([...values].sort((left, right) => left - right))
}

/** True for a point already synthesized by another operation (a gap fill or a repair), rather than measured. */
export function isSynthesized(point: TrackPoint): boolean {
  const flags = point.provenance?.qualityFlags
  return flags !== undefined && (flags.includes('interpolated') || flags.includes('notional'))
}

/** Robust scale for a residual series, floored so sub-noise residuals can't be amplified. */
function robustScale(residuals: readonly number[], floor: number): number {
  const finite = residuals.filter((value) => Number.isFinite(value))
  return Math.max(medianAbsoluteDeviation(finite) * MAD_TO_SIGMA, floor)
}

/**
 * Estimates the position-channel floor a *legitimate*, sustained turn at
 * `turnRateDps` produces under this detector's own window-median-vs-chord
 * math (see the position residual computed below), by running that same
 * math against a synthetic planar arc at the track's own characteristic
 * speed and sample cadence rather than deriving it in closed form — the
 * discrete median-of-window geometry does not reduce to a clean formula at
 * the turn rates real platforms use, and an approximation risks being wrong
 * in either direction. A MAD-derived scale cannot catch this on its own:
 * residuals across a steady turn are large but nearly constant sample to
 * sample, so their local scatter (what MAD measures) stays near zero even
 * though the absolute deviation from the backward/forward chord is not —
 * every point in the turn ends up scoring as an outlier. A straight track,
 * or one whose speed or cadence isn't known, returns 0 and leaves the
 * caller's own floor in charge.
 */
export function estimateTurnPositionFloorMeters(
  characteristicSpeedMps: number,
  turnRateDps: number,
  windowSize: number,
  sampleIntervalSeconds: number,
): number {
  if (!Number.isFinite(turnRateDps) || turnRateDps <= 0) return 0
  if (!(characteristicSpeedMps > 0) || !(sampleIntervalSeconds > 0) || windowSize < 1) return 0

  const omega = turnRateDps * Math.PI / 180
  const n = windowSize * 2 + 3
  const center = windowSize + 1
  const xs: number[] = []
  const ys: number[] = []
  let x = 0
  let y = 0
  let heading = 0
  for (let i = 0; i < n; i++) {
    xs.push(x)
    ys.push(y)
    heading += omega * sampleIntervalSeconds
    x += characteristicSpeedMps * sampleIntervalSeconds * Math.cos(heading)
    y += characteristicSpeedMps * sampleIntervalSeconds * Math.sin(heading)
  }

  const backX = median([...xs.slice(center - windowSize, center)].sort((a, b) => a - b))
  const backY = median([...ys.slice(center - windowSize, center)].sort((a, b) => a - b))
  const fwdX = median([...xs.slice(center + 1, center + windowSize + 1)].sort((a, b) => a - b))
  const fwdY = median([...ys.slice(center + 1, center + windowSize + 1)].sort((a, b) => a - b))
  const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by)
  const toBack = dist(xs[center]!, ys[center]!, backX, backY)
  const toFwd = dist(xs[center]!, ys[center]!, fwdX, fwdY)
  const chord = dist(backX, backY, fwdX, fwdY)
  return Math.max(0, (toBack + toFwd - chord) / 2)
}

/**
 * The smallest step a channel can actually resolve, estimated as the median gap
 * between its consecutive distinct values. Returns 0 for a channel that is not
 * quantized, which leaves the caller's own floor in charge.
 *
 * Altimeters quantize. A recorder reporting GPS altitude in 4 ft steps puts
 * every sample on a 1.219 m grid, so across a short window most residuals are
 * exactly zero, the median absolute deviation collapses to zero, and
 * `robustScale` silently degenerates into the configured floor — turning a
 * "3 sigma" test into a fixed 3 m bar that sits *inside* the sensor's own
 * resolution, at 2.46 quantization steps. A residual smaller than one step is
 * not evidence of anything, so the step is a lower bound on any honest scale.
 * On a continuous channel the MAD is far above the step and this changes
 * nothing.
 */
function quantizationStep(values: readonly number[]): number {
  const distinct = Array.from(new Set(values.filter((value) => Number.isFinite(value)))).sort((left, right) => left - right)
  if (distinct.length < 2) return 0
  const gaps: number[] = []
  for (let index = 1; index < distinct.length; index++) gaps.push(distinct[index]! - distinct[index - 1]!)
  return median(gaps.sort((left, right) => left - right))
}

/**
 * Flags points that break their local trend in position, elevation, or ground speed.
 *
 * Each channel's residual is the point's departure from what its neighbours predict — for
 * position, the offset from the chord joining the backward and forward window medians; for
 * elevation and speed, the gap from the midpoint of those two window medians. A steady climb, a
 * constant-rate acceleration, or a smooth turn all predict their own midpoint, so they produce
 * near-zero residuals and are not outliers. Residuals are then normalised by a robust
 * (MAD-derived) scale for that channel and compared against a z-score threshold; a point is
 * flagged when any single channel exceeds it.
 *
 * This is deliberately separate from detectQualityEvents' `elevation-spike` rule, which is a
 * single-sample reversal test over one channel feeding the map/chart event markers.
 */
export function detectOutliers(points: readonly TrackPoint[], config: OutlierConfig): OutlierResult {
  const flaggedIndices: number[] = []
  const scoreByIndex = new Map<number, number>()
  const channelByIndex = new Map<number, OutlierChannel>()

  const window = Math.max(1, config.windowSize)
  if (points.length < window * 2 + 1) return { flaggedIndices, scoreByIndex, channelByIndex }

  const speeds = derivePointSpeeds(points)
  const eligible: number[] = []
  const positionResiduals: number[] = []
  const elevationResiduals: (number | undefined)[] = []
  const speedResiduals: (number | undefined)[] = []

  for (let index = window; index < points.length - window; index++) {
    const point = points[index]
    if (!point) continue
    // A point already marked interpolated or notional is a synthesized fit,
    // not a measurement — judging it against the same trend test used on raw
    // samples would score the fit's own small residual (a spline is rarely
    // pixel-perfect through its neighbours) as a fresh anomaly, which is how
    // a repair ends up flagging points right next to the one it just fixed.
    // It still contributes to its real neighbours' backward/forward window
    // medians below; it just cannot be flagged itself.
    if (isSynthesized(point)) continue

    const backward = points.slice(index - window, index)
    const forward = points.slice(index + 1, index + window + 1)

    const backwardLat = medianOf(backward.map((item) => item.lat))
    const backwardLon = medianOf(backward.map((item) => item.lon))
    const forwardLat = medianOf(forward.map((item) => item.lat))
    const forwardLon = medianOf(forward.map((item) => item.lon))
    if (backwardLat === undefined || backwardLon === undefined || forwardLat === undefined || forwardLon === undefined) continue

    // Excess path length over the direct chord: zero on the chord, growing with off-track offset.
    const toBackward = haversineMeters(point.lat, point.lon, backwardLat, backwardLon)
    const toForward = haversineMeters(point.lat, point.lon, forwardLat, forwardLon)
    const chord = haversineMeters(backwardLat, backwardLon, forwardLat, forwardLon)

    eligible.push(index)
    positionResiduals.push(Math.max(0, (toBackward + toForward - chord) / 2))

    const backwardEle = medianOf(backward.map((item) => item.ele).filter((value): value is number => value !== undefined))
    const forwardEle = medianOf(forward.map((item) => item.ele).filter((value): value is number => value !== undefined))
    elevationResiduals.push(
      point.ele !== undefined && backwardEle !== undefined && forwardEle !== undefined
        ? point.ele - (backwardEle + forwardEle) / 2
        : undefined,
    )

    const speed = speeds[index]
    const backwardSpeed = medianOf(speeds.slice(index - window, index).filter((value): value is number => value !== undefined))
    const forwardSpeed = medianOf(speeds.slice(index + 1, index + window + 1).filter((value): value is number => value !== undefined))
    speedResiduals.push(
      speed !== undefined && backwardSpeed !== undefined && forwardSpeed !== undefined
        ? speed - (backwardSpeed + forwardSpeed) / 2
        : undefined,
    )
  }

  const allowed = new Set<OutlierChannel>(config.channels ?? ALL_OUTLIER_CHANNELS)
  const defined = (values: readonly (number | undefined)[]) => values.filter((value): value is number => value !== undefined)
  const positionScale = robustScale(positionResiduals, config.minPositionScaleMeters)
  // Elevation is the one channel that arrives pre-quantized from the instrument,
  // so its floor comes from the data rather than from the config alone. Position
  // (full-precision decimal degrees) and speed (derived) have no such step.
  const elevationValues = points.map((point) => point.ele).filter((value): value is number => value !== undefined)
  const elevationScale = Math.max(
    robustScale(defined(elevationResiduals), config.minElevationScaleMeters),
    quantizationStep(elevationValues),
  )
  const speedScale = robustScale(defined(speedResiduals), config.minSpeedScaleMps)

  for (let slot = 0; slot < eligible.length; slot++) {
    const index = eligible[slot]
    if (index === undefined) continue

    const scores: [OutlierChannel, number][] = []
    if (allowed.has('position')) scores.push(['position', Math.abs(positionResiduals[slot] ?? 0) / positionScale])
    const elevationResidual = elevationResiduals[slot]
    if (allowed.has('elevation') && elevationResidual !== undefined) scores.push(['elevation', Math.abs(elevationResidual) / elevationScale])
    const speedResidual = speedResiduals[slot]
    if (allowed.has('speed') && speedResidual !== undefined) scores.push(['speed', Math.abs(speedResidual) / speedScale])

    let channel: OutlierChannel = scores[0]?.[0] ?? 'position'
    let best = 0
    for (const [name, score] of scores) {
      if (score > best) { best = score; channel = name }
    }

    scoreByIndex.set(index, best)
    channelByIndex.set(index, channel)
    // Any single channel breaking its local trend is enough to flag the point.
    if (best > config.scoreThreshold) flaggedIndices.push(index)
  }

  return { flaggedIndices, scoreByIndex, channelByIndex }
}
