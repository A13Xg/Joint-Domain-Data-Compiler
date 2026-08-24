import { haversineMeters, type TrackPoint } from '../model'

export interface MovementWindow {
  startIndex: number
  endIndex: number
}

export interface MovementWindowConfig {
  speedThresholdMps: number
  displacementFallbackMeters: number
  minSustainedSamples: number
}

function extNumber(point: TrackPoint | undefined, key: string): number | undefined {
  const value = point?.ext?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Per-point ground speed in m/s.
 *
 * Prefers a recorded channel over a derived one, matching the precedence already used by
 * src/core/analytics/segments.ts (`ground_speed_mps` then `speed_mps`), and falls back to
 * haversine distance over the sample interval.
 */
export function derivePointSpeeds(points: readonly TrackPoint[]): (number | undefined)[] {
  const speeds: (number | undefined)[] = new Array<number | undefined>(points.length)
  for (let index = 0; index < points.length; index++) {
    const current = points[index]
    const recorded = extNumber(current, 'ground_speed_mps') ?? extNumber(current, 'speed_mps')
    if (recorded !== undefined) {
      speeds[index] = recorded
      continue
    }
    const previous = points[index - 1]
    if (index > 0 && current && previous && current.time !== undefined && previous.time !== undefined) {
      const durationMs = current.time - previous.time
      if (durationMs > 0) {
        speeds[index] = (haversineMeters(previous.lat, previous.lon, current.lat, current.lon) * 1000) / durationMs
        continue
      }
    }
    speeds[index] = undefined
  }
  return speeds
}

function sustainedFrom(speeds: readonly (number | undefined)[], index: number, step: number, threshold: number, samples: number): boolean {
  let run = 0
  for (let cursor = index; cursor >= 0 && cursor < speeds.length && run < samples; cursor += step) {
    const speed = speeds[cursor]
    if (speed === undefined || speed < threshold) return false
    run++
  }
  return run >= samples
}

/**
 * Bounds of the genuinely-under-way portion of a track, so checks can ignore the parked
 * segments before takeoff and after landing.
 *
 * Returns the whole track when no sample ever crosses the threshold (a stationary fixture
 * degrades gracefully rather than forcing dependent checks to N/A), and null only when the
 * track carries no timestamps at all — the one case where dependent checks genuinely cannot run.
 */
export function detectMovementWindow(points: readonly TrackPoint[], config: MovementWindowConfig): MovementWindow | null {
  if (points.length === 0) return null
  if (!points.some((point) => point.time !== undefined)) return null

  const speeds = derivePointSpeeds(points)
  const samples = Math.max(1, config.minSustainedSamples)

  let startIndex = -1
  for (let index = 0; index < points.length; index++) {
    if (sustainedFrom(speeds, index, 1, config.speedThresholdMps, samples)) { startIndex = index; break }
  }

  let endIndex = -1
  for (let index = points.length - 1; index >= 0; index--) {
    if (sustainedFrom(speeds, index, -1, config.speedThresholdMps, samples)) { endIndex = index; break }
  }

  if (startIndex >= 0 && endIndex >= 0 && startIndex <= endIndex) return { startIndex, endIndex }

  // No sustained speed anywhere: fall back to the span over which the track actually
  // displaces, so a sparse or speed-less source still yields a usable window.
  const displaced = displacementWindow(points, config.displacementFallbackMeters)
  return displaced ?? { startIndex: 0, endIndex: points.length - 1 }
}

function displacementWindow(points: readonly TrackPoint[], thresholdMeters: number): MovementWindow | null {
  const origin = points[0]
  if (!origin) return null
  let startIndex = -1
  let endIndex = -1
  for (let index = 1; index < points.length; index++) {
    const point = points[index]
    if (!point) continue
    if (haversineMeters(origin.lat, origin.lon, point.lat, point.lon) >= thresholdMeters) {
      if (startIndex < 0) startIndex = index - 1
      endIndex = index
    }
  }
  return startIndex >= 0 && endIndex > startIndex ? { startIndex, endIndex } : null
}
