import { haversineMeters, isValidLat, isValidLon, type TrackPoint } from '../model'

export type QualityEventKind =
  | 'gap'
  | 'duplicate-timestamp'
  | 'coordinate-jump'
  | 'invalid-coordinate'
  | 'elevation-spike'
  | 'elevation-flatline'
export type QualityEventSeverity = 'info' | 'warning' | 'error'

export interface QualityEvent {
  id: string
  kind: QualityEventKind
  severity: QualityEventSeverity
  startIndex: number
  endIndex: number
  startTime?: number
  endTime?: number
  explanation: string
  measurements?: Readonly<Record<string, number>>
}

export interface QualityEventConfig {
  gapMs: number
  coordinateJumpMeters: number
  coordinateJumpMaxIntervalMs: number
  /** Minimum round-trip deviation (up then down, or down then up) to flag a single-sample elevation spike. */
  elevationSpikeMeters: number
  /** Minimum number of consecutive bit-identical elevation samples to flag a flatline (frozen sensor reading). */
  flatlineMinRun: number
}

export interface IndexRange {
  start: number
  end: number
}

export interface TimeRange {
  startMs: number
  endMs: number
}

export const DEFAULT_QUALITY_EVENT_CONFIG: QualityEventConfig = {
  gapMs: 5_000,
  coordinateJumpMeters: 10_000,
  coordinateJumpMaxIntervalMs: 5_000,
  elevationSpikeMeters: 100,
  flatlineMinRun: 5,
}

export function detectQualityEvents(points: TrackPoint[], config: QualityEventConfig = DEFAULT_QUALITY_EVENT_CONFIG): QualityEvent[] {
  validateConfig(config)
  const events: QualityEvent[] = []

  for (let index = 0; index < points.length; index++) {
    const point = points[index]!
    if (!isValidLat(point.lat) || !isValidLon(point.lon)) {
      events.push({
        id: `invalid-coordinate:${index}`,
        kind: 'invalid-coordinate',
        severity: 'error',
        startIndex: index,
        endIndex: index,
        startTime: point.time,
        endTime: point.time,
        explanation: 'Point has latitude or longitude outside normalized WGS84 bounds.',
      })
      continue
    }

    const previous = points[index - 1]
    if (!previous || previous.time === undefined || point.time === undefined) continue

    const durationMs = point.time - previous.time
    if (durationMs === 0) {
      events.push({
        id: `duplicate-timestamp:${index}`,
        kind: 'duplicate-timestamp',
        severity: 'warning',
        startIndex: index,
        endIndex: index,
        startTime: point.time,
        endTime: point.time,
        explanation: 'Point has the same timestamp as its preceding source point.',
        measurements: { timestampMs: point.time },
      })
    }
    if (durationMs > config.gapMs) {
      events.push({
        id: `gap:${index - 1}:${index}`,
        kind: 'gap',
        severity: 'warning',
        startIndex: index - 1,
        endIndex: index,
        startTime: previous.time,
        endTime: point.time,
        explanation: `Observed sample interval of ${(durationMs / 1000).toFixed(3)} seconds exceeds the configured gap threshold.`,
        measurements: { durationMs },
      })
    }

    if (!isValidLat(previous.lat) || !isValidLon(previous.lon) || durationMs < 0 || durationMs > config.coordinateJumpMaxIntervalMs) continue
    const distanceMeters = haversineMeters(previous.lat, previous.lon, point.lat, point.lon)
    if (distanceMeters > config.coordinateJumpMeters) {
      events.push({
        id: `coordinate-jump:${index - 1}:${index}`,
        kind: 'coordinate-jump',
        severity: 'error',
        startIndex: index - 1,
        endIndex: index,
        startTime: previous.time,
        endTime: point.time,
        explanation: `Adjacent points moved ${distanceMeters.toFixed(1)} meters inside the configured time window.`,
        measurements: { distanceMeters, durationMs },
      })
    }
  }

  detectElevationSpikes(points, config, events)
  detectElevationFlatlines(points, config, events)

  return sortQualityEvents(events)
}

/** Single-sample elevation spikes: a sharp deviation that reverses on the next sample. */
function detectElevationSpikes(points: TrackPoint[], config: QualityEventConfig, events: QualityEvent[]): void {
  for (let index = 1; index < points.length - 1; index++) {
    const prevEle = points[index - 1]!.ele
    const curEle = points[index]!.ele
    const nextEle = points[index + 1]!.ele
    if (prevEle === undefined || curEle === undefined || nextEle === undefined) continue

    const upJump = curEle - prevEle
    const downJump = nextEle - curEle
    const netDrift = Math.abs(nextEle - prevEle)
    const isReversal = (upJump > 0) !== (downJump > 0)

    if (isReversal && Math.abs(upJump) > config.elevationSpikeMeters && Math.abs(downJump) > config.elevationSpikeMeters && netDrift < config.elevationSpikeMeters) {
      events.push({
        id: `elevation-spike:${index}`,
        kind: 'elevation-spike',
        severity: 'warning',
        startIndex: index,
        endIndex: index,
        startTime: points[index]!.time,
        endTime: points[index]!.time,
        explanation: `Elevation deviates ${Math.abs(upJump).toFixed(1)} m from neighbors then returns on the next sample, suggesting a single-sample spike.`,
        measurements: { deviationMeters: Math.abs(upJump) },
      })
    }
  }
}

/** Runs of bit-identical elevation values, suggesting a frozen sensor reading. */
function detectElevationFlatlines(points: TrackPoint[], config: QualityEventConfig, events: QualityEvent[]): void {
  let runStart = -1
  let runValue: number | undefined

  const closeRun = (endExclusive: number) => {
    if (runStart < 0) return
    const runLength = endExclusive - runStart
    if (runLength >= config.flatlineMinRun) {
      events.push({
        id: `elevation-flatline:${runStart}:${endExclusive - 1}`,
        kind: 'elevation-flatline',
        severity: 'info',
        startIndex: runStart,
        endIndex: endExclusive - 1,
        startTime: points[runStart]!.time,
        endTime: points[endExclusive - 1]!.time,
        explanation: `Elevation held constant at ${runValue} m for ${runLength} consecutive samples, suggesting a frozen sensor reading.`,
        measurements: { value: runValue!, runLength },
      })
    }
  }

  for (let index = 0; index < points.length; index++) {
    const ele = points[index]!.ele
    if (ele !== undefined && ele === runValue) continue
    closeRun(index)
    runStart = ele !== undefined ? index : -1
    runValue = ele
  }
  closeRun(points.length)
}

export function eventsOverlappingIndexRange(events: readonly QualityEvent[], range: IndexRange): QualityEvent[] {
  const start = Math.min(range.start, range.end)
  const end = Math.max(range.start, range.end)
  return events.filter((event) => event.startIndex <= end && event.endIndex >= start)
}

export function eventsOverlappingTimeRange(events: readonly QualityEvent[], range: TimeRange): QualityEvent[] {
  const startMs = Math.min(range.startMs, range.endMs)
  const endMs = Math.max(range.startMs, range.endMs)
  return events.filter((event) => event.startTime !== undefined && event.endTime !== undefined && event.startTime <= endMs && event.endTime >= startMs)
}

export function eventSourceIndices(events: readonly QualityEvent[]): Set<number> {
  const indices = new Set<number>()
  for (const event of events) {
    for (let index = event.startIndex; index <= event.endIndex; index++) indices.add(index)
  }
  return indices
}

export function sortQualityEvents(events: readonly QualityEvent[]): QualityEvent[] {
  const severityOrder: Record<QualityEventSeverity, number> = { error: 0, warning: 1, info: 2 }
  return [...events].sort((left, right) => left.startIndex - right.startIndex || severityOrder[left.severity] - severityOrder[right.severity] || left.endIndex - right.endIndex || left.id.localeCompare(right.id))
}

function validateConfig(config: QualityEventConfig): void {
  for (const [name, value] of Object.entries(config)) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number`)
  }
}
