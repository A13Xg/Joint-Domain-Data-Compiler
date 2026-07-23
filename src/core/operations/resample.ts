import { collectChannels, inferChannelDefinitions, type Dataset, type TrackPoint } from '../model'
import type { OperationDefinition, OperationExecutionContext, OperationExecutionResult } from '../recipes/model'

export type InterpolationMode = 'linear' | 'step'

export interface ResampleParams {
  rateHz: number
  interpolation: InterpolationMode
  maxGapMs?: number
}

export const fixedRateResampleOperation: OperationDefinition<ResampleParams> = {
  id: 'resample-fixed-rate',
  version: 1,
  label: 'Resample to fixed rate',
  description: 'Resample timed track points at a fixed frequency using linear or step interpolation.',
  validateParams,
  execute: executeResample,
}

function validateParams(value: unknown): ResampleParams {
  if (!isRecord(value)) throw new Error('Resample parameters must be an object')
  const rateHz = value.rateHz
  if (typeof rateHz !== 'number' || !Number.isFinite(rateHz) || rateHz <= 0 || rateHz > 1000) {
    throw new Error('rateHz must be a finite number greater than 0 and no more than 1000')
  }
  const interpolation = value.interpolation
  if (interpolation !== 'linear' && interpolation !== 'step') {
    throw new Error('interpolation must be linear or step')
  }
  const maxGapMs = value.maxGapMs
  if (maxGapMs !== undefined && (typeof maxGapMs !== 'number' || !Number.isFinite(maxGapMs) || maxGapMs <= 0)) {
    throw new Error('maxGapMs must be a positive finite number when provided')
  }
  return { rateHz, interpolation, maxGapMs }
}

function executeResample(context: OperationExecutionContext<ResampleParams>): OperationExecutionResult {
  if (context.scope) throw new Error('Fixed-rate resampling currently requires full-dataset scope')
  const source = context.dataset.points.filter((point): point is TrackPoint & { time: number } => point.time !== undefined)
  if (source.length < 2) throw new Error('Fixed-rate resampling requires at least two timed points')

  const sorted = [...source].sort((a, b) => a.time - b.time)
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index]!.time <= sorted[index - 1]!.time) {
      throw new Error('Fixed-rate resampling requires unique, strictly increasing timestamps')
    }
  }

  const intervalMs = 1000 / context.params.rateHz
  const startMs = sorted[0]!.time
  const endMs = sorted[sorted.length - 1]!.time
  const estimatedCount = Math.floor((endMs - startMs) / intervalMs) + 1
  if (estimatedCount > 5_000_000) throw new Error('Requested resampling would create more than 5,000,000 points')

  const output: TrackPoint[] = []
  let rightIndex = 1
  for (let sampleIndex = 0; sampleIndex < estimatedCount; sampleIndex++) {
    const time = Math.min(endMs, startMs + sampleIndex * intervalMs)
    while (rightIndex < sorted.length - 1 && sorted[rightIndex]!.time < time) rightIndex++
    const left = sorted[rightIndex - 1]!
    const right = sorted[rightIndex]!
    const gapMs = right.time - left.time
    if (context.params.maxGapMs !== undefined && gapMs > context.params.maxGapMs && time !== left.time && time !== right.time) {
      continue
    }
    output.push(interpolatePoint(left, right, time, context.params.interpolation))
  }

  if (output.at(-1)?.time !== endMs) output.push(cloneTimedPoint(sorted.at(-1)!))
  const channels = collectChannels(output)
  const dataset: Dataset = {
    ...context.dataset,
    points: output,
    channels,
    metadata: context.dataset.metadata
      ? { ...context.dataset.metadata, channels: inferChannelDefinitions(output, channels) }
      : undefined,
  }
  const skipped = estimatedCount - output.length
  return {
    dataset,
    summary: `Resampled ${sorted.length.toLocaleString()} timed points to ${output.length.toLocaleString()} points at ${context.params.rateHz} Hz`,
    warnings: skipped > 0 ? [`Skipped ${skipped.toLocaleString()} samples across gaps larger than maxGapMs`] : [],
  }
}

function interpolatePoint(
  left: TrackPoint & { time: number },
  right: TrackPoint & { time: number },
  time: number,
  mode: InterpolationMode,
): TrackPoint {
  if (time <= left.time) return cloneTimedPoint(left)
  if (time >= right.time) return cloneTimedPoint(right)
  if (mode === 'step') return { ...cloneTimedPoint(left), time, provenance: interpolatedProvenance(left, right) }

  const ratio = (time - left.time) / (right.time - left.time)
  const extKeys = new Set([...Object.keys(left.ext ?? {}), ...Object.keys(right.ext ?? {})])
  const ext: Record<string, number | string | boolean> = {}
  for (const key of extKeys) {
    const a = left.ext?.[key]
    const b = right.ext?.[key]
    if (typeof a === 'number' && typeof b === 'number') ext[key] = interpolateNumber(a, b, ratio)
    else if (a !== undefined) ext[key] = a
    else if (b !== undefined) ext[key] = b
  }

  return {
    lat: interpolateNumber(left.lat, right.lat, ratio),
    lon: interpolateLongitude(left.lon, right.lon, ratio),
    ele: interpolateOptionalNumber(left.ele, right.ele, ratio),
    time,
    name: left.name ?? right.name,
    desc: left.desc ?? right.desc,
    ext: Object.keys(ext).length > 0 ? ext : undefined,
    provenance: interpolatedProvenance(left, right),
  }
}

function cloneTimedPoint(point: TrackPoint & { time: number }): TrackPoint {
  return {
    ...point,
    ext: point.ext ? { ...point.ext } : undefined,
    provenance: point.provenance
      ? { ...point.provenance, qualityFlags: point.provenance.qualityFlags ? [...point.provenance.qualityFlags] : undefined }
      : undefined,
  }
}

function interpolatedProvenance(left: TrackPoint, right: TrackPoint): TrackPoint['provenance'] {
  const flags = new Set<string>([
    ...(left.provenance?.qualityFlags ?? []),
    ...(right.provenance?.qualityFlags ?? []),
    'interpolated',
  ])
  return { qualityFlags: [...flags] }
}

function interpolateOptionalNumber(a: number | undefined, b: number | undefined, ratio: number): number | undefined {
  if (a === undefined || b === undefined) return a ?? b
  return interpolateNumber(a, b, ratio)
}

function interpolateNumber(a: number, b: number, ratio: number): number {
  return a + (b - a) * ratio
}

function interpolateLongitude(a: number, b: number, ratio: number): number {
  let delta = b - a
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  const value = a + delta * ratio
  return ((value + 540) % 360) - 180
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
