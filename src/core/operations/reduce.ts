// Point-count reduction.
//
// Dedupe, decimate and simplify were three cards that answered the same
// operator question — "this track has more points than it needs, thin it" —
// and differed only in the rule used to choose survivors. They are merged
// behind one `mode` so the choice is presented as what it is: a trade-off
// between cheapness (decimate), coincidence removal (dedupe), and shape
// fidelity (simplify).

import { decimate, dedupe, simplify, withPoints } from '../transforms'
import type { OperationDefinition } from '../recipes/model'
import { rejectScope } from './scope'
import { requireAtLeast, requireGreaterThan, requireInteger, requireOneOf, requireRecord, rejectUnknownKeys } from './params'

export type ReducePointsMode = 'dedupe' | 'decimate' | 'simplify'
const REDUCE_MODES: readonly ReducePointsMode[] = ['dedupe', 'decimate', 'simplify']

export type ReducePointsParams =
  | { mode: 'dedupe'; toleranceMeters: number }
  | { mode: 'decimate'; factor: number }
  | { mode: 'simplify'; epsilonMeters: number }

export const reducePointsOperation: OperationDefinition<ReducePointsParams> = {
  id: 'reduce-points',
  version: 1,
  label: 'Reduce points',
  description: 'Thin a dense track by collapsing coincident points (dedupe), keeping every Nth point (decimate), or Douglas–Peucker shape-preserving simplification.',
  validateParams: validateReducePointsParams,
  execute: ({ dataset, params, scope }) => {
    rejectScope(scope, 'Reduce points')
    const result = params.mode === 'dedupe'
      ? dedupe(dataset.points, params.toleranceMeters)
      : params.mode === 'decimate'
        ? decimate(dataset.points, params.factor)
        : simplify(dataset.points, params.epsilonMeters)
    return { dataset: withPoints(dataset, result.points), summary: result.summary }
  },
}

function validateReducePointsParams(value: unknown): ReducePointsParams {
  const record = requireRecord(value, 'Reduce points')
  const mode = requireOneOf(record.mode, 'mode', REDUCE_MODES)
  if (mode === 'dedupe') {
    rejectUnknownKeys(record, 'Reduce points (dedupe)', ['mode', 'toleranceMeters'])
    return { mode, toleranceMeters: requireAtLeast(record.toleranceMeters, 'toleranceMeters', 0) }
  }
  if (mode === 'decimate') {
    rejectUnknownKeys(record, 'Reduce points (decimate)', ['mode', 'factor'])
    return { mode, factor: requireInteger(record.factor, 'factor', 2) }
  }
  rejectUnknownKeys(record, 'Reduce points (simplify)', ['mode', 'epsilonMeters'])
  return { mode, epsilonMeters: requireGreaterThan(record.epsilonMeters, 'epsilonMeters', 0) }
}
