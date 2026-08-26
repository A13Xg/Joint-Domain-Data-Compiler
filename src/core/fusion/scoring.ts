// Tranche 6 Task 6.2 (scoring half): deterministic, explainable scoring of a
// real candidate point within a group. Never synthesizes a point — this only
// ranks the real candidates that exist so a later Auto-Combine step (Task
// 6.3, not built yet) can pick the best real one or leave a documented gap.
import type { CandidatePoint, SourceRegistration, SourceScore } from './model'

export interface ScoringOptions {
  candidate: CandidatePoint
  source: SourceRegistration
  /** The group's representative time, for a timing-consistency penalty. */
  groupTimeMs: number
}

/**
 * Score = source priority (dominant, always an integer multiple of 100 so it
 * strictly outranks the bounded HDOP/satellite/timing adjustments below)
 * plus quality adjustments. Higher is better. Deterministic for identical
 * inputs; ties are broken by the caller using sourceId (stable sort), never
 * silently — see `rankScores`.
 */
export function scoreCandidate({ candidate, source, groupTimeMs }: ScoringOptions): SourceScore {
  const reasons: string[] = [`source priority ${source.priority}`]
  let score = source.priority * 100

  if (candidate.hdop !== undefined) {
    // HDOP: lower is better. Typical range ~0.5 (excellent) to ~20+ (poor).
    // Bounded bonus so a single extreme reading can't overwhelm priority.
    const hdopBonus = Math.max(0, Math.min(10, 10 - candidate.hdop))
    score += hdopBonus
    reasons.push(`HDOP ${candidate.hdop.toFixed(2)} (+${hdopBonus.toFixed(2)})`)
  }

  if (candidate.satelliteCount !== undefined) {
    const satBonus = Math.min(candidate.satelliteCount, 12) * 0.5
    score += satBonus
    reasons.push(`${candidate.satelliteCount} satellites (+${satBonus.toFixed(2)})`)
  }

  const timingDeltaMs = Math.abs(candidate.time - groupTimeMs)
  if (timingDeltaMs > 0) {
    const timingPenalty = timingDeltaMs / 1000 // 1 point per second away from the group's representative time
    score -= timingPenalty
    reasons.push(`${timingDeltaMs.toFixed(0)} ms from group time (-${timingPenalty.toFixed(2)})`)
  }

  return { sourceId: candidate.sourceId, score, reason: reasons.join('; ') }
}

/**
 * Rank scores highest-first with a fully deterministic tie-break (by
 * sourceId) so identical inputs always produce identical output order,
 * regardless of input array order or sort-algorithm stability quirks.
 */
export function rankScores(scores: readonly SourceScore[]): SourceScore[] {
  return [...scores].sort((a, b) => b.score - a.score || a.sourceId.localeCompare(b.sourceId))
}
