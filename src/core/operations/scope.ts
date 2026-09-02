// Scope handling shared by the operation definitions.
//
// Range scoping used to live in the UI: TransformPanel called
// `applyTransformToRange` itself and then handed raw points to `onApply`, so
// the scope never reached an operation record and could not be replayed.
// Operations own it now, which is also what lets `OperationRecord.scope`
// round-trip through a saved recipe.

import type { Dataset, TrackPoint } from '../model'
import { applyTransformToRange } from '../rangeTransform'
import type { OperationExecutionResult, OperationScope } from '../recipes/model'
import { withPoints, type TransformResult } from '../transforms'

/** Guards an operation that has no meaningful sub-range behaviour. */
export function rejectScope(scope: OperationScope | undefined, label: string): void {
  if (scope?.indexRange || scope?.timeRange || scope?.indexSet) throw new Error(`${label} requires full-dataset scope`)
}

/**
 * Runs a point-count-preserving transform over the whole dataset or, when an
 * index range is scoped, over that slice spliced back into place.
 *
 * Time-range scope is rejected rather than approximated: converting a time
 * window to indices needs a monotone time channel the caller has not proven,
 * and quietly transforming the wrong points is worse than refusing.
 */
export function runPointPreserving(
  dataset: Dataset,
  scope: OperationScope | undefined,
  label: string,
  transform: (points: TrackPoint[]) => TransformResult,
): OperationExecutionResult {
  if (scope?.timeRange) throw new Error(`${label} does not support time-range scope`)
  if (scope?.indexSet) throw new Error(`${label} does not support set-based scope`)
  const result = scope?.indexRange
    ? applyTransformToRange(dataset.points, scope.indexRange, transform)
    : transform(dataset.points)
  return { dataset: withPoints(dataset, result.points), summary: result.summary }
}
