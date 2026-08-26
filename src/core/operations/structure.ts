// Validity & structure operations: the cheap, mechanical repairs that put a
// track into a shape the rest of the toolset can reason about.

import {
  clipTimeRange, dejitterTimestamps, dropInvalid, sortByTime, swapLatLon, withPoints,
  type DuplicateTimestampPolicy, type UntimedPointPolicy,
} from '../transforms'
import type { OperationDefinition } from '../recipes/model'
import { rejectScope, runPointPreserving } from './scope'
import { requireGreaterThan, requireFinite, requireOneOf, requireRecord, rejectUnknownKeys } from './params'

const DUPLICATE_POLICIES: readonly DuplicateTimestampPolicy[] = ['nudge', 'drop', 'average']
const UNTIMED_POLICIES: readonly UntimedPointPolicy[] = ['keep', 'drop']

export interface DejitterParams { duplicatePolicy: DuplicateTimestampPolicy; epsilonMs: number }
export interface ClipTimeRangeParams { startMs: number; endMs: number; untimedPolicy: UntimedPointPolicy }

export const sortByTimeOperation: OperationDefinition<Record<string, never>> = {
  id: 'sort-by-time',
  version: 1,
  label: 'Sort by time',
  description: 'Order points chronologically. Untimed points are kept and sorted to the end.',
  validateParams: (value) => validateNoParams(value, 'Sort by time'),
  execute: ({ dataset, scope }) => {
    rejectScope(scope, 'Sort by time')
    const result = sortByTime(dataset.points)
    return { dataset: withPoints(dataset, result.points), summary: result.summary }
  },
}

export const swapLatLonOperation: OperationDefinition<Record<string, never>> = {
  id: 'swap-lat-lon',
  version: 1,
  label: 'Swap latitude / longitude',
  description: 'Exchange the latitude and longitude of every point to correct transposed coordinate columns.',
  validateParams: (value) => validateNoParams(value, 'Swap latitude / longitude'),
  execute: ({ dataset, scope }) => runPointPreserving(dataset, scope, 'Swap latitude / longitude', (points) => swapLatLon(points)),
}

export const dropInvalidOperation: OperationDefinition<Record<string, never>> = {
  id: 'drop-invalid',
  version: 1,
  label: 'Drop invalid coordinates',
  description: 'Remove points whose latitude or longitude falls outside the valid range.',
  validateParams: (value) => validateNoParams(value, 'Drop invalid coordinates'),
  execute: ({ dataset, scope }) => {
    rejectScope(scope, 'Drop invalid coordinates')
    const result = dropInvalid(dataset.points)
    return { dataset: withPoints(dataset, result.points), summary: result.summary }
  },
}

export const dejitterTimestampsOperation: OperationDefinition<DejitterParams> = {
  id: 'dejitter-timestamps',
  version: 1,
  label: 'De-jitter timestamps',
  description: 'Enforce strictly-increasing timestamps, resolving duplicates and backward drift by nudge, drop, or average.',
  validateParams: validateDejitterParams,
  // 'drop' and 'average' change the point count, so a scoped run of either is
  // rejected by applyTransformToRange rather than silently falling back to a
  // whole-dataset run.
  execute: ({ dataset, params, scope }) => runPointPreserving(
    dataset, scope, 'De-jitter timestamps',
    (points) => dejitterTimestamps(points, { duplicatePolicy: params.duplicatePolicy, epsilonMs: params.epsilonMs }),
  ),
}

export const clipTimeRangeOperation: OperationDefinition<ClipTimeRangeParams> = {
  id: 'clip-time-range',
  version: 1,
  label: 'Clip to time window',
  description: 'Keep only points inside an inclusive timestamp window. Untimed points are kept or dropped by policy.',
  validateParams: validateClipParams,
  execute: ({ dataset, params, scope }) => {
    rejectScope(scope, 'Clip to time window')
    const result = clipTimeRange(dataset.points, params.startMs, params.endMs, params.untimedPolicy)
    return { dataset: withPoints(dataset, result.points), summary: result.summary }
  },
}

function validateNoParams(value: unknown, label: string): Record<string, never> {
  if (value === undefined) return {}
  const record = requireRecord(value, label)
  rejectUnknownKeys(record, label, [])
  return {}
}

function validateDejitterParams(value: unknown): DejitterParams {
  const record = requireRecord(value, 'De-jitter timestamps')
  rejectUnknownKeys(record, 'De-jitter timestamps', ['duplicatePolicy', 'epsilonMs'])
  return {
    duplicatePolicy: requireOneOf(record.duplicatePolicy, 'duplicatePolicy', DUPLICATE_POLICIES),
    epsilonMs: requireGreaterThan(record.epsilonMs, 'epsilonMs', 0),
  }
}

function validateClipParams(value: unknown): ClipTimeRangeParams {
  const record = requireRecord(value, 'Clip to time window')
  rejectUnknownKeys(record, 'Clip to time window', ['startMs', 'endMs', 'untimedPolicy'])
  const startMs = requireFinite(record.startMs, 'startMs')
  const endMs = requireFinite(record.endMs, 'endMs')
  if (endMs < startMs) throw new Error('endMs must be greater than or equal to startMs')
  return { startMs, endMs, untimedPolicy: requireOneOf(record.untimedPolicy, 'untimedPolicy', UNTIMED_POLICIES) }
}
