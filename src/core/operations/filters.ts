// Smoothing operations.
//
// The three elevation filters used to be three separate cards that read as
// near-duplicates. They are genuinely different algorithms — a rolling median
// is phase-neutral and spike-proof, an EMA is causal and lags, a Hampel
// identifier only touches points it judges anomalous — so all three
// implementations survive unchanged. Only the operation and UI surface is
// collapsed, behind an explicit `mode`.

import {
  exponentialMovingAverageElevation, hampelFilterElevation, medianFilterElevation, smooth,
} from '../transforms'
import type { OperationDefinition } from '../recipes/model'
import { runPointPreserving } from './scope'
import { requireBoolean, requireGreaterThan, requireInteger, requireOneOf, requireRecord, rejectUnknownKeys } from './params'

export type ElevationFilterMode = 'median' | 'ema' | 'hampel'
const ELEVATION_FILTER_MODES: readonly ElevationFilterMode[] = ['median', 'ema', 'hampel']

export interface SmoothParams { window: number; coords: boolean; elevation: boolean }
export type ElevationFilterParams =
  | { mode: 'median'; window: number }
  | { mode: 'ema'; alpha: number }
  | { mode: 'hampel'; window: number; sigmaThreshold: number }

export const smoothOperation: OperationDefinition<SmoothParams> = {
  id: 'smooth',
  version: 1,
  label: 'Smooth',
  description: 'Moving-average filter over position and/or elevation to reduce sample-to-sample jitter. Position smoothing runs on ECEF vectors, so it is antimeridian- and pole-safe.',
  validateParams: validateSmoothParams,
  execute: ({ dataset, params, scope }) => runPointPreserving(
    dataset, scope, 'Smooth',
    (points) => smooth(points, params.window, { coords: params.coords, elevation: params.elevation }),
  ),
}

export const elevationFilterOperation: OperationDefinition<ElevationFilterParams> = {
  id: 'elevation-filter',
  version: 1,
  label: 'Elevation filter',
  description: 'Filter the elevation channel without changing the point count: rolling median, causal EMA, or Hampel outlier replacement.',
  validateParams: validateElevationFilterParams,
  execute: ({ dataset, params, scope }) => runPointPreserving(dataset, scope, 'Elevation filter', (points) => {
    if (params.mode === 'median') return medianFilterElevation(points, params.window)
    if (params.mode === 'ema') return exponentialMovingAverageElevation(points, params.alpha)
    return hampelFilterElevation(points, params.sigmaThreshold, params.window)
  }),
}

function validateSmoothParams(value: unknown): SmoothParams {
  const record = requireRecord(value, 'Smooth')
  rejectUnknownKeys(record, 'Smooth', ['window', 'coords', 'elevation'])
  const coords = requireBoolean(record.coords, 'coords')
  const elevation = requireBoolean(record.elevation, 'elevation')
  // A smooth that targets neither channel is a no-op the user did not intend;
  // recording it would put an operation in the history that changes nothing.
  if (!coords && !elevation) throw new Error('Smooth must target position, elevation, or both')
  return { window: requireInteger(record.window, 'window', 2), coords, elevation }
}

function validateElevationFilterParams(value: unknown): ElevationFilterParams {
  const record = requireRecord(value, 'Elevation filter')
  const mode = requireOneOf(record.mode, 'mode', ELEVATION_FILTER_MODES)
  if (mode === 'median') {
    rejectUnknownKeys(record, 'Elevation filter (median)', ['mode', 'window'])
    return { mode, window: requireInteger(record.window, 'window', 3) }
  }
  if (mode === 'ema') {
    rejectUnknownKeys(record, 'Elevation filter (ema)', ['mode', 'alpha'])
    const alpha = requireGreaterThan(record.alpha, 'alpha', 0)
    if (alpha >= 1) throw new Error('alpha must be less than 1')
    return { mode, alpha }
  }
  rejectUnknownKeys(record, 'Elevation filter (hampel)', ['mode', 'window', 'sigmaThreshold'])
  return {
    mode,
    window: requireInteger(record.window, 'window', 5),
    sigmaThreshold: requireGreaterThan(record.sigmaThreshold, 'sigmaThreshold', 0),
  }
}
