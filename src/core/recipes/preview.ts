// Pure before/after preview for a proposed transform/derivation, computed
// from two full Dataset snapshots. Kept independent of the operation
// registry so it works for both registered OperationDefinitions and the
// existing plain transforms.ts functions.
import type { Dataset } from '../model'
import { computeStats } from '../stats'
import { detectQualityEvents } from '../quality/events'
import type { IndexRange } from '../selection'

export interface OperationPreview {
  pointCountBefore: number
  pointCountAfter: number
  pointCountDelta: number
  boundsChanged: boolean
  durationMsBefore: number | null
  durationMsAfter: number | null
  qualityEventCountBefore: number
  qualityEventCountAfter: number
  selectedRangeCountBefore: number | null
  selectedRangeCountAfter: number | null
  /** True when the point count would shrink — the signal used to require confirmation. */
  isDestructive: boolean
}

function rangeCount(range: IndexRange | null | undefined, pointCount: number): number | null {
  if (!range || pointCount === 0) return null
  const start = Math.max(0, Math.min(range.start, pointCount - 1))
  const end = Math.max(0, Math.min(range.end, pointCount - 1))
  return end - start + 1
}

export function computeOperationPreview(
  before: Dataset,
  after: Dataset,
  selection?: { indexRange?: IndexRange | null },
): OperationPreview {
  const beforeStats = computeStats(before)
  const afterStats = computeStats(after)
  const beforeEvents = detectQualityEvents(before.points)
  const afterEvents = detectQualityEvents(after.points)

  return {
    pointCountBefore: beforeStats.pointCount,
    pointCountAfter: afterStats.pointCount,
    pointCountDelta: afterStats.pointCount - beforeStats.pointCount,
    boundsChanged: JSON.stringify(beforeStats.bounds) !== JSON.stringify(afterStats.bounds),
    durationMsBefore: beforeStats.durationMs,
    durationMsAfter: afterStats.durationMs,
    qualityEventCountBefore: beforeEvents.length,
    qualityEventCountAfter: afterEvents.length,
    selectedRangeCountBefore: rangeCount(selection?.indexRange, before.points.length),
    selectedRangeCountAfter: rangeCount(selection?.indexRange, after.points.length),
    isDestructive: afterStats.pointCount < beforeStats.pointCount,
  }
}

export function describeOperationPreview(preview: OperationPreview): string {
  const parts = [`${preview.pointCountBefore.toLocaleString()} → ${preview.pointCountAfter.toLocaleString()} points`]
  if (preview.pointCountDelta !== 0) {
    parts.push(preview.pointCountDelta < 0
      ? `${Math.abs(preview.pointCountDelta).toLocaleString()} points removed`
      : `${preview.pointCountDelta.toLocaleString()} points added`)
  }
  if (preview.qualityEventCountAfter !== preview.qualityEventCountBefore) {
    parts.push(`quality events ${preview.qualityEventCountBefore} → ${preview.qualityEventCountAfter}`)
  }
  if (preview.boundsChanged) parts.push('bounding box changes')
  return parts.join('; ')
}
