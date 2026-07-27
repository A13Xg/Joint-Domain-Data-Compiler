import { haversineMeters, isValidLat, isValidLon, type TrackPoint } from '../model'

export type QualityEventKind = 'gap' | 'duplicate-timestamp' | 'coordinate-jump' | 'invalid-coordinate'
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

  return sortQualityEvents(events)
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
