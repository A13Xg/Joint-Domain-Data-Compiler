// Tranche 6 Task 6.3 (core layer, steps 1-3; no UI/timeline yet — see plan
// notes). Consumes CandidateGroups (Task 6.2) and produces one fused
// TrackPoint per group by always picking a real candidate — this MVP never
// synthesizes a point. Manual overrides (point-exact or time-interval) take
// precedence over scoring and survive being called again with the same
// overrides (deterministic, not "sticky" hidden state).
import type { TrackPoint } from '../model'
import {
  validateFusedPointDecision,
  type CandidateGroup,
  type CandidatePoint,
  type FusedPointDecision,
  type SelectedIntervalOverride,
  type SelectedPointOverride,
  type SourceRegistration,
  type SourceScore,
} from './model'
import { rankScores, scoreCandidate } from './scoring'

export interface AutoCombineOptions {
  pointOverrides?: readonly SelectedPointOverride[]
  intervalOverrides?: readonly SelectedIntervalOverride[]
}

export interface AutoCombineResult {
  /** Fused points in group order — groupCandidatesByTime already produces chronological groups, so this is chronological too. */
  points: TrackPoint[]
  decisions: FusedPointDecision[]
}

export function autoCombine(
  groups: readonly CandidateGroup[],
  sources: readonly SourceRegistration[],
  options: AutoCombineOptions = {},
): AutoCombineResult {
  const sourcesById = new Map(sources.map((source) => [source.id, source]))
  const points: TrackPoint[] = []
  const decisions: FusedPointDecision[] = []

  for (const group of groups) {
    const { chosen, skipped, reason, confidence } = decideGroup(group, sourcesById, options)
    points.push(candidateToTrackPoint(chosen))
    decisions.push(validateFusedPointDecision({
      groupId: group.id,
      chosenSourceId: chosen.sourceId,
      chosenSourceIndex: chosen.sourceIndex,
      skippedSourceIds: skipped,
      reason,
      confidence,
    }))
  }

  return { points, decisions }
}

function decideGroup(
  group: CandidateGroup,
  sourcesById: ReadonlyMap<string, SourceRegistration>,
  options: AutoCombineOptions,
): { chosen: CandidatePoint; skipped: string[]; reason: string; confidence: number } {
  const pointOverride = options.pointOverrides?.find((override) => override.groupId === group.id)
  const pointOverrideCandidate = pointOverride && group.candidates.find((c) => c.sourceId === pointOverride.sourceId)
  if (pointOverrideCandidate) {
    return finalize(group, pointOverrideCandidate, `manual point override selected source ${pointOverrideCandidate.sourceId}`, 1)
  }

  const intervalOverride = options.intervalOverrides?.find((override) =>
    override.entityId === group.entityId && group.groupTimeMs >= override.startMs && group.groupTimeMs <= override.endMs)
  const intervalOverrideCandidate = intervalOverride && group.candidates.find((c) => c.sourceId === intervalOverride.sourceId)
  if (intervalOverrideCandidate) {
    const start = new Date(intervalOverride!.startMs).toISOString()
    const end = new Date(intervalOverride!.endMs).toISOString()
    return finalize(group, intervalOverrideCandidate, `manual interval override (${start} – ${end}) selected source ${intervalOverrideCandidate.sourceId}`, 1)
  }

  const scores: SourceScore[] = group.candidates.map((candidate) => {
    const source = sourcesById.get(candidate.sourceId)
    if (!source) throw new Error(`No registered source for id "${candidate.sourceId}" (group ${group.id})`)
    return scoreCandidate({ candidate, source, groupTimeMs: group.groupTimeMs })
  })
  const ranked = rankScores(scores)
  const best = ranked[0]!
  const chosen = group.candidates.find((c) => c.sourceId === best.sourceId)!
  return finalize(group, chosen, best.reason, confidenceFromScoreGap(ranked))
}

function finalize(group: CandidateGroup, chosen: CandidatePoint, reason: string, confidence: number) {
  const skipped = group.candidates.filter((c) => c !== chosen).map((c) => c.sourceId)
  return { chosen, skipped, reason, confidence }
}

/** A bigger gap to the runner-up score means more confidence in the choice; a single-candidate group is maximally confident since there was nothing to choose between. */
function confidenceFromScoreGap(ranked: readonly SourceScore[]): number {
  if (ranked.length <= 1) return 1
  const gap = ranked[0]!.score - ranked[1]!.score
  return Math.max(0.5, Math.min(1, 0.5 + gap / 100))
}

function candidateToTrackPoint(candidate: CandidatePoint): TrackPoint {
  const ext: Record<string, number | string | boolean> = { fused_source: candidate.sourceId }
  if (candidate.hdop !== undefined) ext.hdop = candidate.hdop
  if (candidate.satelliteCount !== undefined) ext.sat = candidate.satelliteCount
  return {
    lat: candidate.lat,
    lon: candidate.lon,
    ele: candidate.ele,
    time: candidate.time,
    provenance: { sourceSegment: candidate.sourceId, sourceRecord: candidate.sourceIndex },
    ext,
  }
}
