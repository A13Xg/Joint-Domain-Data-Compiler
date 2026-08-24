import type { TrackPoint } from '../core/model'
import { extractChartSeries, type ChartXAxis } from '../visualization/charts/series'
import { fixedRateResampleOperation, type ResampleParams } from '../core/operations/resample'
import { buildGpxChunked } from '../core/compute/gpxExport'
import type { GpxExportOptions } from '../core/exporters/gpx'
import { computeTrackHealth } from '../core/quality/trackHealth'
import { DEFAULT_TRACK_HEALTH_CONFIG, type TrackHealthConfig } from '../core/quality/trackHealthConfig'
import type { TrackHealthReport } from '../core/quality/trackHealthTypes'
import type { SourceFormat } from '../core/model'
import type { ComputeTaskDefinition } from './protocol'

interface ChartSeriesPayload {
  points: TrackPoint[]
  channelId: string
  xAxis: ChartXAxis
  maxSamples: number
}

interface ResamplePayload {
  points: TrackPoint[]
  params: ResampleParams
}

export const chartSeriesTask: ComputeTaskDefinition<ChartSeriesPayload, ReturnType<typeof extractChartSeries>> = {
  id: 'chart-series',
  version: 1,
  validatePayload(payload: unknown): ChartSeriesPayload {
    const value = record(payload, 'chart series payload')
    const xAxis = value.xAxis
    if (xAxis !== 'time' && xAxis !== 'index' && xAxis !== 'distance') throw new Error('xAxis must be time, index, or distance')
    return {
      points: points(value.points),
      channelId: nonEmptyString(value.channelId, 'channelId'),
      xAxis,
      maxSamples: positiveInteger(value.maxSamples, 'maxSamples'),
    }
  },
  run(payload, context) {
    context.reportProgress({ completed: 0, total: 1, message: 'Preparing chart series' })
    const result = extractChartSeries(payload.points, payload.channelId, payload.xAxis, payload.maxSamples)
    context.reportProgress({ completed: 1, total: 1 })
    return result
  },
}

export const fixedRateResampleTask: ComputeTaskDefinition<ResamplePayload, ReturnType<typeof fixedRateResampleOperation.execute>> = {
  id: 'fixed-rate-resample',
  version: 1,
  validatePayload(payload: unknown): ResamplePayload {
    const value = record(payload, 'resample payload')
    return {
      points: points(value.points),
      params: fixedRateResampleOperation.validateParams(value.params),
    }
  },
  run(payload, context) {
    if (context.signal.aborted) throw new Error('Resampling cancelled')
    context.reportProgress({ completed: 0, total: 1, message: 'Resampling timed track' })
    const dataset = {
      id: 'worker-dataset',
      name: 'Worker dataset',
      sourceFormat: 'unknown' as const,
      points: payload.points,
      warnings: [],
      channels: [],
      createdAt: 0,
    }
    const result = fixedRateResampleOperation.execute({ dataset, params: payload.params })
    context.reportProgress({ completed: 1, total: 1 })
    return result
  },
}

interface GpxExportPayload {
  points: TrackPoint[]
  datasetName?: string
  options?: GpxExportOptions
}

export const gpxExportTask: ComputeTaskDefinition<GpxExportPayload, Awaited<ReturnType<typeof buildGpxChunked>>> = {
  id: 'gpx-export',
  version: 1,
  validatePayload(payload: unknown): GpxExportPayload {
    const value = record(payload, 'gpx export payload')
    return {
      points: points(value.points),
      datasetName: value.datasetName === undefined ? undefined : nonEmptyString(value.datasetName, 'datasetName'),
      options: value.options === undefined ? undefined : gpxOptions(value.options),
    }
  },
  async run(payload, context) {
    if (context.signal.aborted) throw new Error('GPX export cancelled')
    const dataset = {
      id: 'worker-dataset',
      name: payload.datasetName ?? 'Worker dataset',
      sourceFormat: 'unknown' as const,
      points: payload.points,
      warnings: [],
      channels: [],
      createdAt: 0,
    }
    return buildGpxChunked(dataset, payload.options ?? {}, {
      signal: context.signal,
      reportProgress: (progress) => context.reportProgress({
        completed: progress.completed,
        total: progress.total,
        message: 'Building GPX',
      }),
    })
  },
}

export interface TrackHealthScanPayload {
  points: TrackPoint[]
  sourceFormat: SourceFormat
  warnings: string[]
  datasetId: string
  config?: TrackHealthConfig
}

export const trackHealthScanTask: ComputeTaskDefinition<TrackHealthScanPayload, TrackHealthReport> = {
  id: 'track-health-scan',
  version: 1,
  validatePayload(payload: unknown): TrackHealthScanPayload {
    const value = record(payload, 'track health scan payload')
    return {
      points: points(value.points),
      sourceFormat: sourceFormat(value.sourceFormat),
      warnings: stringArray(value.warnings, 'warnings'),
      datasetId: nonEmptyString(value.datasetId, 'datasetId'),
      config: value.config === undefined ? undefined : trackHealthConfig(value.config),
    }
  },
  run(payload, context) {
    if (context.signal.aborted) throw new Error('Track health scan cancelled')
    const dataset = {
      id: payload.datasetId,
      name: 'health-scan',
      sourceFormat: payload.sourceFormat,
      points: payload.points,
      warnings: payload.warnings,
      channels: [],
      createdAt: 0,
    }
    return computeTrackHealth(dataset, payload.config ?? DEFAULT_TRACK_HEALTH_CONFIG, (completed, total, message) => {
      if (context.signal.aborted) return
      context.reportProgress({ completed, total, message })
    })
  },
}

export const PRODUCTION_COMPUTE_TASKS = [chartSeriesTask, fixedRateResampleTask, gpxExportTask, trackHealthScanTask] as const

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function points(value: unknown): TrackPoint[] {
  if (!Array.isArray(value)) throw new Error('points must be an array')
  for (const [index, point] of value.entries()) {
    const item = record(point, `points[${index}]`)
    if (typeof item.lat !== 'number' || typeof item.lon !== 'number') throw new Error(`points[${index}] must contain numeric lat/lon`)
  }
  return value as TrackPoint[]
}

function integer(value: unknown, field: string): number {
  if (!Number.isInteger(value)) throw new Error(`${field} must be an integer`)
  return value as number
}

function positiveInteger(value: unknown, field: string): number {
  const result = integer(value, field)
  if (result < 1) throw new Error(`${field} must be positive`)
  return result
}

// Number.prototype.toFixed (used to render coordinates) throws a RangeError
// for values outside [0, 100]; 15 is already far beyond any meaningful
// coordinate precision, so it's used as a generous but safe ceiling.
function boundedInteger(value: unknown, field: string, min: number, max: number): number {
  const result = integer(value, field)
  if (result < min || result > max) throw new Error(`${field} must be between ${min} and ${max}`)
  return result
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`)
  return value
}

function gpxOptions(value: unknown): GpxExportOptions {
  const raw = record(value, 'options')
  const options: GpxExportOptions = {}
  if (raw.creator !== undefined) options.creator = nonEmptyString(raw.creator, 'options.creator')
  if (raw.trackName !== undefined) options.trackName = nonEmptyString(raw.trackName, 'options.trackName')
  if (raw.includeExtensions !== undefined) options.includeExtensions = boolean(raw.includeExtensions, 'options.includeExtensions')
  if (raw.sortByTime !== undefined) options.sortByTime = boolean(raw.sortByTime, 'options.sortByTime')
  if (raw.coordinatePrecision !== undefined) options.coordinatePrecision = boundedInteger(raw.coordinatePrecision, 'options.coordinatePrecision', 0, 15)
  if (raw.bom !== undefined) options.bom = boolean(raw.bom, 'options.bom')
  return options
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean`)
  return value
}

// Accepts a partial override and layers it over the defaults, so a future settings menu can
// send only the values it changed. Every override must be a finite number; anything else is
// rejected rather than silently coerced into the scan's thresholds.
function trackHealthConfig(value: unknown): TrackHealthConfig {
  const raw = record(value, 'config')
  const merged = structuredClone(DEFAULT_TRACK_HEALTH_CONFIG) as unknown as Record<string, Record<string, number>>
  for (const [section, overrides] of Object.entries(raw)) {
    const target = merged[section]
    if (!target) throw new Error(`config.${section} is not a known track health section`)
    for (const [key, override] of Object.entries(record(overrides, `config.${section}`))) {
      if (!(key in target)) throw new Error(`config.${section}.${key} is not a known track health setting`)
      if (typeof override !== 'number' || !Number.isFinite(override)) throw new Error(`config.${section}.${key} must be a finite number`)
      target[key] = override
    }
  }
  return merged as unknown as TrackHealthConfig
}

function sourceFormat(value: unknown): SourceFormat {
  const validFormats = ['csv', 'gpx', 'geojson', 'kml', 'nmea', 'gpb', 'eag', 'unknown']
  if (typeof value !== 'string' || !validFormats.includes(value)) throw new Error(`sourceFormat must be one of ${validFormats.join(', ')}`)
  return value as SourceFormat
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  for (const item of value) {
    if (typeof item !== 'string') throw new Error(`${field} must contain only strings`)
  }
  return value as string[]
}
