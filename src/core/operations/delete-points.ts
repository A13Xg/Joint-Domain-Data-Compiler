// Selection-scoped delete: removes exactly the points named by an
// `indexSet` scope (built by ctrl/cmd+click and shift+click on the table
// grid). Deliberately narrow — bulk removal by threshold already lives in
// drop-outliers and the rest of the Transform tab; this is for the few
// strays a set-based selection was built to name one at a time.
//
// Point-removing rather than point-preserving (unlike edit-point), so it
// cannot go through `runPointPreserving` — the whole point is that the
// output has fewer points than the input.

import { clonePoint } from '../model'
import type { OperationDefinition } from '../recipes/model'
import { withPoints } from '../transforms'

export type DeletePointsParams = Record<string, never>

export const deletePointsOperation: OperationDefinition<DeletePointsParams> = {
  id: 'delete-points',
  version: 1,
  label: 'Delete selected points',
  description: 'Remove the points named by the current set-based selection.',
  validateParams: validateDeletePointsParams,
  execute: ({ dataset, scope }) => {
    if (scope?.timeRange) throw new Error('Delete points does not support time-range scope')
    if (scope?.indexRange) throw new Error('Delete points requires a set-based (indexSet) scope, not a range')
    const indices = scope?.indexSet
    if (!indices || indices.length === 0) throw new Error('Delete points requires a non-empty indexSet scope')

    const doomed = new Set<number>()
    for (const index of indices) {
      if (!Number.isInteger(index) || index < 0 || index >= dataset.points.length) {
        throw new Error(`Delete points: index ${index} is out of range`)
      }
      doomed.add(index)
    }

    const kept = dataset.points.filter((_, index) => !doomed.has(index)).map(clonePoint)
    const summary = `Deleted ${doomed.size.toLocaleString()} point(s)`
    return { dataset: withPoints(dataset, kept), summary }
  },
}

function validateDeletePointsParams(value: unknown): DeletePointsParams {
  if (value === undefined) return {}
  // Same "recorded form of no parameters" check as standard-kinematics: a
  // plain object with zero own keys, not an Array/Date/Map/Set/RegExp/Error
  // that would also report zero enumerable own keys.
  const prototype = typeof value === 'object' && value !== null ? Object.getPrototypeOf(value) as unknown : false
  if ((prototype === Object.prototype || prototype === null) && Object.keys(value as object).length === 0) return {}
  throw new Error('Delete points does not accept parameters')
}
