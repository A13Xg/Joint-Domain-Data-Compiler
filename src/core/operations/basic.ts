import { ensureBuiltinDerivationsRegistered } from '../analytics/bootstrap'
import { runDerivation } from '../analytics/registry'
import { offsetElevation, shiftTime, withPoints } from '../transforms'
import { distanceResampleMonotoneOperation } from './distance-resample'
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

export function ensureBuiltinOperationsRegistered(): void {
  if (!getOperation(offsetElevationOperation.id)) registerOperation(offsetElevationOperation)
  if (!getOperation(shiftTimeOperation.id)) registerOperation(shiftTimeOperation)
  if (!getOperation(standardKinematicsOperation.id)) registerOperation(standardKinematicsOperation)
  if (!getOperation(distanceResampleMonotoneOperation.id)) registerOperation(distanceResampleMonotoneOperation)
}

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
  if (value === undefined || (typeof value === 'object' && value !== null && Object.keys(value).length === 0)) return {}
  throw new Error('standard kinematics does not accept parameters')
}
