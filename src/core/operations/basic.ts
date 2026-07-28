import { offsetElevation, shiftTime, withPoints } from '../transforms'
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

export function ensureBuiltinOperationsRegistered(): void {
  if (!getOperation(offsetElevationOperation.id)) registerOperation(offsetElevationOperation)
  if (!getOperation(shiftTimeOperation.id)) registerOperation(shiftTimeOperation)
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
