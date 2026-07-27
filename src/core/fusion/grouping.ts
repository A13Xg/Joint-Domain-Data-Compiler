// Tranche 6 Task 6.2 (grouping half): deterministic time-based clustering of
// candidate points from possibly-multiple sources into CandidateGroups.
//
// Grouping strategy: sort all candidates by time, then anchor each group at
// its first (earliest) member and absorb subsequent candidates while they
// fall within `timeToleranceMs` of that anchor. This is deliberately not a
// rolling/centroid window — anchoring prevents a chain of closely-spaced
// points from drifting a single group's span arbitrarily wide, at the cost
// of occasionally splitting two nearly-tied candidates that straddle a group
// boundary. That trade-off is preferred here for determinism and
// explainability over marginal grouping optimality.
//
// Known MVP limitation: candidates from the *same* source that happen to
// fall within the same time tolerance are not de-duplicated within a group.
// In practice a source's own native sample cadence is normally much larger
// than a sensible fusion tolerance, so this should rarely trigger — but nothing
// here currently guards against it. Compatible-metadata screening (altitude/
// time reference) is intentionally left to the caller, one level up, where
// per-dataset metadata is available; a CandidatePoint alone doesn't carry it.
import { validateCandidateGroup, type CandidateGroup, type CandidatePoint } from './model'

export interface GroupingOptions {
  entityId: string
  timeToleranceMs: number
  idPrefix?: string
}

export function groupCandidatesByTime(candidates: readonly CandidatePoint[], options: GroupingOptions): CandidateGroup[] {
  if (options.timeToleranceMs < 0) throw new RangeError('timeToleranceMs must be non-negative')
  if (candidates.length === 0) return []

  const sorted = [...candidates].sort((a, b) => a.time - b.time || a.sourceId.localeCompare(b.sourceId))
  const groups: CandidateGroup[] = []
  let bucket: CandidatePoint[] = [sorted[0]!]
  let anchorTime = sorted[0]!.time

  const flush = () => {
    const groupTimeMs = bucket.reduce((sum, candidate) => sum + candidate.time, 0) / bucket.length
    groups.push(validateCandidateGroup({
      id: `${options.idPrefix ?? 'group'}-${groups.length}`,
      entityId: options.entityId,
      groupTimeMs,
      candidates: bucket,
    }))
  }

  for (let i = 1; i < sorted.length; i++) {
    const candidate = sorted[i]!
    if (candidate.time - anchorTime <= options.timeToleranceMs) {
      bucket.push(candidate)
    } else {
      flush()
      bucket = [candidate]
      anchorTime = candidate.time
    }
  }
  flush()

  return groups
}
