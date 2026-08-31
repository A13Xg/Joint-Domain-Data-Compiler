import { ensureBuiltinDerivationsRegistered } from '../analytics/bootstrap'
import { runDerivation } from '../analytics/registry'
import { offsetElevation, shiftTime, withPoints } from '../transforms'
import { distanceResampleMonotoneOperation } from './distance-resample'
import { dropOutliersOperation } from './drop-outliers'
import { editPointOperation } from './edit-point'
import { fillGapsOperation } from './fill-gaps'
import { elevationFilterOperation, smoothOperation } from './filters'
import { reducePointsOperation } from './reduce'
import { fixedRateResampleOperation } from './resample'
import { roundPrecisionOperation } from './round-precision'
import {
  clipTimeRangeOperation, dejitterTimestampsOperation, dropInvalidOperation, sortByTimeOperation, swapLatLonOperation,
} from './structure'
import type { OperationDefinition } from '../recipes/model'
import { getOperation, registerOperation } from '../recipes/registry'

interface OffsetElevationParams { meters: number }
interface ShiftTimeParams { seconds: number }

export const offsetElevationOperation: OperationDefinition<OffsetElevationParams> = {
  id: 'offset-elevation',
  version: 1,
  label: 'Offset elevation',
  description: 'Add a fixed elevation offset to all points with elevation.',
  validateParams: validateMeters,
  execute: ({ dataset, params }) => {
    const result = offsetElevation(dataset.points, params.meters)
    return { dataset: withPoints(dataset, result.points), summary: result.summary }
  },
}

export const shiftTimeOperation: OperationDefinition<ShiftTimeParams> = {
  id: 'shift-time',
  version: 1,
  label: 'Shift time',
  description: 'Add a fixed timestamp offset to all timed points.',
  validateParams: validateSeconds,
  execute: ({ dataset, params }) => {
    const result = shiftTime(dataset.points, params.seconds)
    return { dataset: withPoints(dataset, result.points), summary: result.summary }
  },
}

export const standardKinematicsOperation: OperationDefinition<Record<string, never>> = {
  id: 'standard-kinematics',
  version: 1,
  label: 'Derive kinematics',
  description: 'Derive standard distance, speed, heading, and timing channels.',
  validateParams: validateEmptyParams,
  execute: ({ dataset }) => {
    ensureBuiltinDerivationsRegistered()
    const result = runDerivation('standard-kinematics', dataset)
    return { dataset: withPoints(dataset, result.points), summary: result.summary, warnings: result.warnings }
  },
}

/**
 * Every transform the Transform tab can apply must appear here.
 *
 * An unregistered transform still runs, but `App.tsx` has to synthesise a
 * fallback history record for it, `getOperation` then returns null on replay,
 * and the whole session loses the ability to save a named recipe. Registration
 * is what makes an operation reproducible, so adding a card without adding a
 * line here is a correctness bug, not an omission.
 *
 * Each registration is guarded because `registerOperation` throws on a
 * duplicate id and this function is called from several entry points (and
 * re-run by tests after `clearOperationsForTests`).
 */
export function ensureBuiltinOperationsRegistered(): void {
  for (const definition of BUILTIN_OPERATIONS) {
    if (!getOperation(definition.id)) registerOperation(definition)
  }
}

const BUILTIN_OPERATIONS: OperationDefinition<never>[] = [
  // Validity & structure
  sortByTimeOperation,
  swapLatLonOperation,
  dropInvalidOperation,
  dejitterTimestampsOperation,
  clipTimeRangeOperation,
  // Outliers & smoothing
  dropOutliersOperation,
  editPointOperation,
  elevationFilterOperation,
  smoothOperation,
  // Density & precision
  reducePointsOperation,
  roundPrecisionOperation,
  // Resampling & gaps
  fixedRateResampleOperation,
  distanceResampleMonotoneOperation,
  fillGapsOperation,
  // Derive
  standardKinematicsOperation,
  shiftTimeOperation,
  offsetElevationOperation,
] as OperationDefinition<never>[]

function validateMeters(value: unknown): OffsetElevationParams {
  const meters = (value as { meters?: unknown })?.meters
  if (typeof meters !== 'number' || !Number.isFinite(meters)) throw new Error('meters must be finite')
  return { meters }
}

function validateSeconds(value: unknown): ShiftTimeParams {
  const seconds = (value as { seconds?: unknown })?.seconds
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) throw new Error('seconds must be finite')
  return { seconds }
}

function validateEmptyParams(value: unknown): Record<string, never> {
  if (value === undefined) return {}
  // A plain object with no keys is the recorded form of "no parameters".
  // Arrays, Dates, Maps, Sets, RegExps and Errors all report zero enumerable
  // own keys too, so a key count alone would wave them through; the prototype
  // check is what keeps a malformed recorded param out of a replay.
  const prototype = typeof value === 'object' && value !== null ? Object.getPrototypeOf(value) as unknown : false
  if ((prototype === Object.prototype || prototype === null) && Object.keys(value as object).length === 0) return {}
  throw new Error('standard kinematics does not accept parameters')
}
