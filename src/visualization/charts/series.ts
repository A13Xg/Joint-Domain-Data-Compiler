import type { TrackPoint } from '../../core/model'

export type ChartXAxis = 'time' | 'index' | 'distance'

export interface ChartSample {
  sourceIndex: number
  x: number
  y: number
}

export interface ChartSeriesData {
  channelId: string
  unit?: string
  samples: ChartSample[]
  min: number
  max: number
  /** True when the visible window held more raw points than `maxSamples`, so `samples` is a min/max-bucketed reduction rather than every point. */
  downsampled: boolean
}

export interface XDomain { lo: number; hi: number }

export interface ChartPreset {
  id: string
  label: string
  channelIds: string[]
  xAxis: ChartXAxis
}

export const BUILT_IN_CHART_PRESETS: ChartPreset[] = [
  { id: 'altitude-time', label: 'Altitude over time', channelIds: ['elevation'], xAxis: 'time' },
  { id: 'speed-time', label: 'Ground speed over time', channelIds: ['ground_speed_mps', 'speed_mps'], xAxis: 'time' },
  { id: 'vertical-speed-time', label: 'Vertical speed over time', channelIds: ['vertical_speed_mps'], xAxis: 'time' },
  { id: 'heading-turn-rate', label: 'Heading and turn rate', channelIds: ['heading_deg', 'turn_rate_dps'], xAxis: 'time' },
  { id: 'sample-quality', label: 'Sample timing', channelIds: ['sample_interval_s', 'sample_frequency_hz'], xAxis: 'time' },
  { id: 'altitude-distance', label: 'Altitude over distance', channelIds: ['elevation'], xAxis: 'distance' },
]

/**
 * Full x-value extent across every point, independent of any channel's y-availability or
 * downsampling. The single source of truth for the chart's zoom bounds — computed once from raw
 * data so it never depends on however a channel's series happens to be reduced.
 */
export function computeXDomain(points: readonly TrackPoint[], xAxis: ChartXAxis): XDomain | null {
  let lo = Infinity
  let hi = -Infinity
  for (let sourceIndex = 0; sourceIndex < points.length; sourceIndex++) {
    const x = xValue(points[sourceIndex]!, sourceIndex, xAxis)
    if (x === null) continue
    if (x < lo) lo = x
    if (x > hi) hi = x
  }
  return Number.isFinite(lo) ? { lo, hi: hi === lo ? lo + 1 : hi } : null
}

export function extractChartSeries(
  points: readonly TrackPoint[],
  channelId: string,
  xAxis: ChartXAxis,
  maxSamples = 1500,
  domain?: XDomain | null,
): ChartSeriesData {
  if (!Number.isInteger(maxSamples) || maxSamples < 2) throw new Error('maxSamples must be an integer of at least 2')
  const raw: ChartSample[] = []
  let min = Infinity
  let max = -Infinity
  // One retained sample just outside each edge of `domain`, so the polyline still reaches the
  // plot's edges instead of visibly stopping short at the last in-window sample.
  let pendingBefore: ChartSample | null = null
  let afterAdded = false

  const push = (sample: ChartSample) => {
    raw.push(sample)
    if (sample.y < min) min = sample.y
    if (sample.y > max) max = sample.y
  }

  for (let sourceIndex = 0; sourceIndex < points.length; sourceIndex++) {
    const point = points[sourceIndex]!
    const y = numericChannelValue(point, channelId)
    const x = xValue(point, sourceIndex, xAxis)
    if (y === null || x === null) continue
    const sample: ChartSample = { sourceIndex, x, y }
    if (!domain) { push(sample); continue }
    if (x < domain.lo) { pendingBefore = sample; continue }
    if (x > domain.hi) {
      if (!afterAdded) { push(sample); afterAdded = true }
      continue
    }
    if (pendingBefore) { push(pendingBefore); pendingBefore = null }
    push(sample)
  }

  return {
    channelId,
    samples: minMaxDownsample(raw, maxSamples),
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
    downsampled: raw.length > maxSamples,
  }
}

export function minMaxDownsample(samples: readonly ChartSample[], maxSamples: number): ChartSample[] {
  if (samples.length <= maxSamples) return [...samples]
  if (maxSamples < 4) return [samples[0]!, samples[samples.length - 1]!]

  const output: ChartSample[] = [samples[0]!]
  const interior = samples.slice(1, -1)
  const bucketCount = Math.max(1, Math.floor((maxSamples - 2) / 2))
  const bucketSize = interior.length / bucketCount

  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = Math.floor(bucket * bucketSize)
    const end = Math.min(interior.length, Math.floor((bucket + 1) * bucketSize))
    if (end <= start) continue
    let minSample = interior[start]!
    let maxSample = interior[start]!
    for (let index = start + 1; index < end; index++) {
      const sample = interior[index]!
      if (sample.y < minSample.y) minSample = sample
      if (sample.y > maxSample.y) maxSample = sample
    }
    if (minSample.sourceIndex <= maxSample.sourceIndex) {
      output.push(minSample)
      if (maxSample !== minSample) output.push(maxSample)
    } else {
      output.push(maxSample)
      if (maxSample !== minSample) output.push(minSample)
    }
  }

  output.push(samples[samples.length - 1]!)
  return output.slice(0, maxSamples)
}

export function resolvePresetChannels(preset: ChartPreset, availableChannels: readonly string[]): string[] {
  const available = new Set(availableChannels)
  const resolved: string[] = []
  for (const channelId of preset.channelIds) {
    if (channelId === 'elevation' || available.has(channelId)) {
      if (!resolved.includes(channelId)) resolved.push(channelId)
      if (preset.id === 'speed-time') break
    }
  }
  return resolved
}

function numericChannelValue(point: TrackPoint, channelId: string): number | null {
  const value = channelId === 'elevation' ? point.ele : point.ext?.[channelId]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function xValue(point: TrackPoint, sourceIndex: number, xAxis: ChartXAxis): number | null {
  if (xAxis === 'index') return sourceIndex
  if (xAxis === 'time') return point.time ?? null
  const distance = point.ext?.distance_m
  return typeof distance === 'number' && Number.isFinite(distance) ? distance : null
}
