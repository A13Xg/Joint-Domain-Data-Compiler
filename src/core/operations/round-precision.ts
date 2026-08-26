// Decimal-place reduction.
//
// Parsers happily carry through whatever precision a source file declared, and
// several formats emit far more digits than the sensor could justify — 14
// decimal places of latitude is sub-micron, which is noise dressed as signal.
// Rounding here rather than at export time means the displayed data, the
// statistics, and the exported file all agree on the same precision.

import { clonePoint } from '../model'
import { trimNumber } from '../format'
import type { OperationDefinition } from '../recipes/model'
import { withPoints } from '../transforms'
import { requireInteger, requireRecord, rejectUnknownKeys } from './params'

export interface RoundPrecisionParams {
  coordinateDecimals: number
  elevationDecimals?: number
  channelDecimals?: number
}

export const roundPrecisionOperation: OperationDefinition<RoundPrecisionParams> = {
  id: 'round-precision',
  version: 1,
  label: 'Round precision',
  description: 'Reduce the stored decimal places of coordinates, elevation, and numeric channels to a precision the source can actually justify.',
  validateParams: validateRoundPrecisionParams,
  execute: ({ dataset, params, scope }) => {
    if (scope?.timeRange) throw new Error('Round precision does not support time-range scope')
    const range = scope?.indexRange
    const lower = range ? Math.min(range.start, range.end) : 0
    const upper = range ? Math.max(range.start, range.end) : dataset.points.length - 1

    let changed = 0
    const points = dataset.points.map((point, index) => {
      if (index < lower || index > upper) return clonePoint(point)
      const next = clonePoint(point)
      let touched = false

      const lat = round(next.lat, params.coordinateDecimals)
      const lon = round(next.lon, params.coordinateDecimals)
      if (lat !== next.lat) { next.lat = lat; touched = true }
      if (lon !== next.lon) { next.lon = lon; touched = true }

      if (next.ele !== undefined && params.elevationDecimals !== undefined) {
        const ele = round(next.ele, params.elevationDecimals)
        if (ele !== next.ele) { next.ele = ele; touched = true }
      }

      if (next.ext && params.channelDecimals !== undefined) {
        for (const key of Object.keys(next.ext)) {
          const value = next.ext[key]
          if (typeof value !== 'number') continue
          const rounded = round(value, params.channelDecimals)
          if (rounded !== value) { next.ext[key] = rounded; touched = true }
        }
      }

      if (touched) changed++
      return next
    })

    const targets = ['coordinates']
    if (params.elevationDecimals !== undefined) targets.push('elevation')
    if (params.channelDecimals !== undefined) targets.push('channels')
    return {
      dataset: withPoints(dataset, points),
      summary: `Rounded ${targets.join(', ')} to ${params.coordinateDecimals} coordinate decimal(s); ${changed} point(s) changed`,
    }
  },
}

/**
 * Rounds through the same formatter the exporters use, so the in-memory value
 * is exactly the value a file written at this precision would round-trip to.
 * Non-finite values are left alone — `trimNumber` maps them to '0', and
 * turning a NaN elevation into a real 0 m would be fabricating data.
 */
function round(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value
  return Number(trimNumber(value, decimals))
}

function validateRoundPrecisionParams(value: unknown): RoundPrecisionParams {
  const record = requireRecord(value, 'Round precision')
  rejectUnknownKeys(record, 'Round precision', ['coordinateDecimals', 'elevationDecimals', 'channelDecimals'])
  return {
    coordinateDecimals: requireInteger(record.coordinateDecimals, 'coordinateDecimals', 0),
    elevationDecimals: record.elevationDecimals === undefined ? undefined : requireInteger(record.elevationDecimals, 'elevationDecimals', 0),
    channelDecimals: record.channelDecimals === undefined ? undefined : requireInteger(record.channelDecimals, 'channelDecimals', 0),
  }
}
