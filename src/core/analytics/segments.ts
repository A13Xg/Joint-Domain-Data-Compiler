import type { TrackPoint } from '../model'

export type SegmentKind = 'stationary' | 'climb' | 'level' | 'descent' | 'gap' | 'unknown'

export interface SegmentConfig {
  stationarySpeedMps: number
  verticalSpeedThresholdMps: number
  gapSeconds: number
  minSegmentPoints: number
}

export interface TrackSegment {
  id: string
  kind: SegmentKind
  startIndex: number
  endIndex: number
  startTime?: number
  endTime?: number
  pointCount: number
  durationSeconds?: number
  distanceMeters?: number
  meanGroundSpeedMps?: number
  meanVerticalSpeedMps?: number
}

export const DEFAULT_SEGMENT_CONFIG: SegmentConfig = {
  stationarySpeedMps: 1,
  verticalSpeedThresholdMps: 1,
  gapSeconds: 10,
  minSegmentPoints: 2,
}

export function segmentTrack(points: readonly TrackPoint[], config: SegmentConfig = DEFAULT_SEGMENT_CONFIG): TrackSegment[] {
  validateConfig(config)
  if (points.length === 0) return []

  const classified = points.map((point) => classifyPoint(point, config))
  const raw: TrackSegment[] = []
  let startIndex = 0
  let currentKind = classified[0]!

  for (let index = 1; index <= points.length; index++) {
    const nextKind = index < points.length ? classified[index]! : null
    if (nextKind === currentKind) continue
    raw.push(buildSegment(points, currentKind, startIndex, index - 1, raw.length))
    startIndex = index
    currentKind = nextKind ?? currentKind
  }

  return mergeShortSegments(points, raw, config.minSegmentPoints)
}

function classifyPoint(point: TrackPoint, config: SegmentConfig): SegmentKind {
  const dt = numeric(point.ext?.sample_interval_s)
  if (dt !== null && dt > config.gapSeconds) return 'gap'

  const speed = numeric(point.ext?.ground_speed_mps ?? point.ext?.speed_mps)
  const verticalSpeed = numeric(point.ext?.vertical_speed_mps)
  if (speed !== null && speed <= config.stationarySpeedMps) return 'stationary'
  if (verticalSpeed === null) return speed === null ? 'unknown' : 'level'
  if (verticalSpeed >= config.verticalSpeedThresholdMps) return 'climb'
  if (verticalSpeed <= -config.verticalSpeedThresholdMps) return 'descent'
  return 'level'
}

function buildSegment(
  points: readonly TrackPoint[],
  kind: SegmentKind,
  startIndex: number,
  endIndex: number,
  ordinal: number,
): TrackSegment {
  const slice = points.slice(startIndex, endIndex + 1)
  const startTime = slice[0]?.time
  const endTime = slice.at(-1)?.time
  const startDistance = numeric(slice[0]?.ext?.distance_m)
  const endDistance = numeric(slice.at(-1)?.ext?.distance_m)
  const speeds = slice.map((point) => numeric(point.ext?.ground_speed_mps ?? point.ext?.speed_mps)).filter(isNumber)
  const verticalSpeeds = slice.map((point) => numeric(point.ext?.vertical_speed_mps)).filter(isNumber)

  return {
    id: `segment-${ordinal + 1}`,
    kind,
    startIndex,
    endIndex,
    startTime,
    endTime,
    pointCount: endIndex - startIndex + 1,
    durationSeconds: startTime !== undefined && endTime !== undefined ? Math.max(0, (endTime - startTime) / 1000) : undefined,
    distanceMeters: startDistance !== null && endDistance !== null ? Math.max(0, endDistance - startDistance) : undefined,
    meanGroundSpeedMps: average(speeds),
    meanVerticalSpeedMps: average(verticalSpeeds),
  }
}

function mergeShortSegments(points: readonly TrackPoint[], segments: TrackSegment[], minPoints: number): TrackSegment[] {
  if (minPoints <= 1 || segments.length < 2) return segments
  const kinds = segments.map((segment) => segment.kind)

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!
    if (segment.pointCount >= minPoints || segment.kind === 'gap') continue
    const previous = index > 0 ? segments[index - 1] : undefined
    const next = index + 1 < segments.length ? segments[index + 1] : undefined
    if (previous && next && previous.kind === next.kind) kinds[index] = previous.kind
    else if (previous && next) kinds[index] = previous.pointCount >= next.pointCount ? previous.kind : next.kind
    else if (previous) kinds[index] = previous.kind
    else if (next) kinds[index] = next.kind
  }

  const merged: TrackSegment[] = []
  let start = segments[0]!.startIndex
  let kind = kinds[0]!
  for (let index = 1; index <= segments.length; index++) {
    const nextKind = index < segments.length ? kinds[index]! : null
    if (nextKind === kind) continue
    const end = segments[index - 1]!.endIndex
    merged.push(buildSegment(points, kind, start, end, merged.length))
    if (index < segments.length) {
      start = segments[index]!.startIndex
      kind = nextKind!
    }
  }
  return merged
}

function validateConfig(config: SegmentConfig): void {
  if (!Number.isFinite(config.stationarySpeedMps) || config.stationarySpeedMps < 0) throw new Error('stationarySpeedMps must be non-negative')
  if (!Number.isFinite(config.verticalSpeedThresholdMps) || config.verticalSpeedThresholdMps <= 0) throw new Error('verticalSpeedThresholdMps must be positive')
  if (!Number.isFinite(config.gapSeconds) || config.gapSeconds <= 0) throw new Error('gapSeconds must be positive')
  if (!Number.isInteger(config.minSegmentPoints) || config.minSegmentPoints < 1) throw new Error('minSegmentPoints must be a positive integer')
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isNumber(value: number | null): value is number {
  return value !== null
}

function average(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
