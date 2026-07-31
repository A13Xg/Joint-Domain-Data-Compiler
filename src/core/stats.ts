// Statistics & data-quality profiling for a Dataset. Powers the overview cards,
// the quality report, and the per-channel inspector.
import { computeBounds, haversineMeters, isValidLat, isValidLon, type Dataset, type TrackPoint } from './model'

export interface ChannelStats {
  key: string
  count: number
  numericCount: number
  min: number | null
  max: number | null
  mean: number | null
  stddev: number | null
  unit?: string
}

export interface DatasetStats {
  pointCount: number
  validCoordCount: number
  invalidCoordCount: number
  withElevation: number
  withTime: number
  withName: number
  bounds: ReturnType<typeof computeBounds>
  distanceMeters: number
  durationMs: number | null
  startTime: number | null
  endTime: number | null
  elevation: { min: number; max: number; gain: number; loss: number } | null
  speed: { maxMps: number; meanMps: number } | null
  sampleRateHz: number | null
  channels: ChannelStats[]
  timeMonotonic: boolean
  duplicateCoords: number
}

export function computeStats(dataset: Dataset): DatasetStats {
  const points = dataset.points
  let validCoord = 0
  let withElevation = 0
  let withTime = 0
  let withName = 0
  let distance = 0
  let gain = 0
  let loss = 0
  let eleMin = Infinity
  let eleMax = -Infinity
  let duplicateCoords = 0
  let timeMonotonic = true

  let startTime: number | null = null
  let endTime: number | null = null
  let prevTime: number | null = null
  let prevEle: number | null = null
  let prev: TrackPoint | null = null

  let speedCount = 0
  let speedSum = 0
  let speedMax = -Infinity

  for (const p of points) {
    const coordOk = isValidLat(p.lat) && isValidLon(p.lon)
    if (coordOk) validCoord++
    if (p.name) withName++

    if (p.ele !== undefined) {
      withElevation++
      if (p.ele < eleMin) eleMin = p.ele
      if (p.ele > eleMax) eleMax = p.ele
      if (prevEle !== null) {
        const delta = p.ele - prevEle
        if (delta > 0) gain += delta
        else loss -= delta
      }
      prevEle = p.ele
    }

    if (p.time !== undefined) {
      withTime++
      if (startTime === null) startTime = p.time
      endTime = p.time
      if (prevTime !== null && p.time < prevTime) timeMonotonic = false
      prevTime = p.time
    }

    if (prev && coordOk) {
      const d = haversineMeters(prev.lat, prev.lon, p.lat, p.lon)
      distance += d
      if (d === 0) duplicateCoords++
      if (p.time !== undefined && prev.time !== undefined) {
        const dt = (p.time - prev.time) / 1000
        if (dt > 0) {
          const speed = d / dt
          speedCount++
          speedSum += speed
          speedMax = Math.max(speedMax, speed)
        }
      }
    }
    if (coordOk) prev = p
  }

  const durationMs = startTime !== null && endTime !== null ? endTime - startTime : null
  const sampleRateHz =
    durationMs && durationMs > 0 && withTime > 1 ? (withTime - 1) / (durationMs / 1000) : null

  const speedStats =
    speedCount > 0
      ? {
          maxMps: speedMax,
          meanMps: speedSum / speedCount,
        }
      : null

  return {
    pointCount: points.length,
    validCoordCount: validCoord,
    invalidCoordCount: points.length - validCoord,
    withElevation,
    withTime,
    withName,
    bounds: computeBounds(points),
    distanceMeters: distance,
    durationMs,
    startTime,
    endTime,
    elevation:
      withElevation > 0 ? { min: eleMin, max: eleMax, gain, loss } : null,
    speed: speedStats,
    sampleRateHz,
    channels: computeChannelStats(dataset),
    timeMonotonic,
    duplicateCoords,
  }
}

function computeChannelStats(dataset: Dataset): ChannelStats[] {
  return dataset.channels.map((key) => {
    let count = 0
    let numericCount = 0
    let min = Infinity
    let max = -Infinity
    let sum = 0
    const nums: number[] = []
    for (const p of dataset.points) {
      const v = p.ext?.[key]
      if (v === undefined) continue
      count++
      const n = typeof v === 'number' ? v : Number(v)
      if (Number.isFinite(n)) {
        numericCount++
        nums.push(n)
        sum += n
        if (n < min) min = n
        if (n > max) max = n
      }
    }
    const mean = numericCount > 0 ? sum / numericCount : null
    const stddev =
      numericCount > 1 && mean !== null
        ? Math.sqrt(nums.reduce((a, n) => a + (n - mean) ** 2, 0) / (numericCount - 1))
        : null
    return {
      key,
      count,
      numericCount,
      min: numericCount > 0 ? min : null,
      max: numericCount > 0 ? max : null,
      mean,
      stddev,
      unit: unitForChannel(key),
    }
  })
}

function unitForChannel(key: string): string | undefined {
  if (key.endsWith('_mps')) return 'm/s'
  if (key.endsWith('_deg')) return '°'
  if (key.endsWith('_m')) return 'm'
  if (key === 'hdop' || key === 'vdop' || key === 'pdop') return 'DOP'
  if (key === 'sat') return 'sats'
  return undefined
}

export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—'
  const totalSec = Math.round(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`
  return `${meters.toFixed(1)} m`
}
