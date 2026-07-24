import type { TrackPoint } from '../core/model'
import { extractChartSeries, type ChartXAxis } from '../visualization/charts/series'
import { fixedRateResampleOperation, type ResampleParams } from '../core/operations/resample'
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

export const PRODUCTION_COMPUTE_TASKS = [chartSeriesTask, fixedRateResampleTask] as const

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

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`)
  return value
}
