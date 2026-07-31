// Tranche 6 Task 6.1: domain-neutral fusion contracts (entities, source
// registrations, candidate groups, and point-level decision provenance).
// Pure data + validation only — no grouping/scoring/auto-combine algorithm
// yet (Task 6.2+) and no UI. Platform categorization is deliberately
// optional and non-authoritative: this models "what a human operator would
// call this track", not a classification system.
import type { TrackPoint } from '../model'

export interface Entity {
  id: string
  displayName: string
  callsign?: string
  platformType?: string
  description?: string
}

export interface SourceRegistration {
  id: string
  entityId: string
  datasetId: string
  label: string
  /** Higher priority wins ties when candidate scores are otherwise equal. */
  priority: number
}

export interface CandidatePoint {
  sourceId: string
  /** Index into the source dataset's points array — provenance back to the raw, immutable source. */
  sourceIndex: number
  lat: number
  lon: number
  ele?: number
  time: number
  /** Optional quality hints carried through from the source point's extension channels, used by scoring (Task 6.2). */
  hdop?: number
  satelliteCount?: number
}

export interface CandidateGroup {
  id: string
  entityId: string
  /** Representative time for the group (e.g. the mean of member candidate times). */
  groupTimeMs: number
  candidates: CandidatePoint[]
}

export interface SourceScore {
  sourceId: string
  score: number
  reason: string
}

export interface SelectedIntervalOverride {
  entityId: string
  sourceId: string
  startMs: number
  endMs: number
}

export interface SelectedPointOverride {
  entityId: string
  groupId: string
  sourceId: string
}

export interface FusedPointDecision {
  groupId: string
  /** Representative group time retained for durable timeline evidence. */
  groupTimeMs?: number
  chosenSourceId: string
  chosenSourceIndex: number
  skippedSourceIds: string[]
  reason: string
  /** 0..1; not a probability, just a relative confidence signal for review. */
  confidence: number
}

export class FusionValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FusionValidationError'
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new FusionValidationError(`${field} must be a non-empty string`)
  return value
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new FusionValidationError(`${field} must be a string when present`)
  return value
}

export function validateEntity(input: {
  id: unknown
  displayName: unknown
  callsign?: unknown
  platformType?: unknown
  description?: unknown
}): Entity {
  return {
    id: requireString(input.id, 'Entity.id'),
    displayName: requireString(input.displayName, 'Entity.displayName'),
    callsign: optionalString(input.callsign, 'Entity.callsign'),
    platformType: optionalString(input.platformType, 'Entity.platformType'),
    description: optionalString(input.description, 'Entity.description'),
  }
}

export function validateSourceRegistration(input: {
  id: unknown
  entityId: unknown
  datasetId: unknown
  label: unknown
  priority: unknown
}): SourceRegistration {
  const priority = input.priority
  if (typeof priority !== 'number' || !Number.isFinite(priority)) throw new FusionValidationError('SourceRegistration.priority must be a finite number')
  return {
    id: requireString(input.id, 'SourceRegistration.id'),
    entityId: requireString(input.entityId, 'SourceRegistration.entityId'),
    datasetId: requireString(input.datasetId, 'SourceRegistration.datasetId'),
    label: requireString(input.label, 'SourceRegistration.label'),
    priority,
  }
}

/**
 * Build a candidate group from raw source points without mutating them —
 * every CandidatePoint is a plain-value copy, never a reference back into a
 * dataset's TrackPoint objects, so downstream fusion code cannot accidentally
 * corrupt an immutable raw source.
 */
export function candidateFromSourcePoint(sourceId: string, sourceIndex: number, point: TrackPoint): CandidatePoint {
  if (point.time === undefined) throw new FusionValidationError('Candidate points must have a timestamp')
  const hdop = typeof point.ext?.hdop === 'number' ? point.ext.hdop : undefined
  const satelliteCount = typeof point.ext?.sat === 'number' ? point.ext.sat : undefined
  return { sourceId, sourceIndex, lat: point.lat, lon: point.lon, ele: point.ele, time: point.time, hdop, satelliteCount }
}

export function validateCandidateGroup(input: { id: unknown; entityId: unknown; groupTimeMs: unknown; candidates: unknown }): CandidateGroup {
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    throw new FusionValidationError('CandidateGroup.candidates must be a non-empty array')
  }
  if (typeof input.groupTimeMs !== 'number' || !Number.isFinite(input.groupTimeMs)) {
    throw new FusionValidationError('CandidateGroup.groupTimeMs must be a finite number')
  }
  const candidates = input.candidates.map((candidate, index) => {
    const c = candidate as Partial<CandidatePoint>
    if (typeof c.sourceId !== 'string' || c.sourceId.trim() === '') throw new FusionValidationError(`CandidateGroup.candidates[${index}].sourceId is required`)
    if (typeof c.sourceIndex !== 'number' || !Number.isInteger(c.sourceIndex) || c.sourceIndex < 0) throw new FusionValidationError(`CandidateGroup.candidates[${index}].sourceIndex must be a non-negative integer`)
    if (typeof c.lat !== 'number' || typeof c.lon !== 'number') throw new FusionValidationError(`CandidateGroup.candidates[${index}] must have numeric lat/lon`)
    if (typeof c.time !== 'number' || !Number.isFinite(c.time)) throw new FusionValidationError(`CandidateGroup.candidates[${index}].time must be a finite number`)
    return { sourceId: c.sourceId, sourceIndex: c.sourceIndex, lat: c.lat, lon: c.lon, ele: c.ele, time: c.time, hdop: c.hdop, satelliteCount: c.satelliteCount }
  })
  return {
    id: requireString(input.id, 'CandidateGroup.id'),
    entityId: requireString(input.entityId, 'CandidateGroup.entityId'),
    groupTimeMs: input.groupTimeMs,
    candidates,
  }
}

export function validateFusedPointDecision(input: {
  groupId: unknown
  groupTimeMs?: unknown
  chosenSourceId: unknown
  chosenSourceIndex: unknown
  skippedSourceIds: unknown
  reason: unknown
  confidence: unknown
}): FusedPointDecision {
  if (input.groupTimeMs !== undefined && (typeof input.groupTimeMs !== 'number' || !Number.isFinite(input.groupTimeMs))) {
    throw new FusionValidationError('FusedPointDecision.groupTimeMs must be a finite number when present')
  }
  if (typeof input.chosenSourceIndex !== 'number' || !Number.isInteger(input.chosenSourceIndex) || input.chosenSourceIndex < 0) {
    throw new FusionValidationError('FusedPointDecision.chosenSourceIndex must be a non-negative integer')
  }
  if (!Array.isArray(input.skippedSourceIds) || !input.skippedSourceIds.every((id) => typeof id === 'string')) {
    throw new FusionValidationError('FusedPointDecision.skippedSourceIds must be an array of strings')
  }
  if (typeof input.confidence !== 'number' || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new FusionValidationError('FusedPointDecision.confidence must be a number between 0 and 1')
  }
  return {
    groupId: requireString(input.groupId, 'FusedPointDecision.groupId'),
    ...(input.groupTimeMs === undefined ? {} : { groupTimeMs: input.groupTimeMs }),
    chosenSourceId: requireString(input.chosenSourceId, 'FusedPointDecision.chosenSourceId'),
    chosenSourceIndex: input.chosenSourceIndex,
    skippedSourceIds: [...input.skippedSourceIds],
    reason: requireString(input.reason, 'FusedPointDecision.reason'),
    confidence: input.confidence,
  }
}

/** Validate operator overrides against the groups and sources for this run. */
export function validateFusionOverrides(
  options: { pointOverrides?: readonly SelectedPointOverride[]; intervalOverrides?: readonly SelectedIntervalOverride[] },
  groups: readonly CandidateGroup[],
  sources: readonly SourceRegistration[],
): void {
  const sourceIds = new Set(sources.map((source) => source.id))
  const groupById = new Map(groups.map((group) => [group.id, group]))
  for (const override of options.pointOverrides ?? []) {
    if (override.entityId !== (groups[0]?.entityId ?? override.entityId)) throw new FusionValidationError(`Point override ${override.groupId} has a mismatched entity`)
    const group = groupById.get(override.groupId)
    if (!group) throw new FusionValidationError(`Point override references unknown group "${override.groupId}"`)
    if (!sourceIds.has(override.sourceId)) throw new FusionValidationError(`Point override references unknown source "${override.sourceId}"`)
    if (!group.candidates.some((candidate) => candidate.sourceId === override.sourceId)) throw new FusionValidationError(`Point override source "${override.sourceId}" is not present in group "${override.groupId}"`)
  }
  for (const override of options.intervalOverrides ?? []) {
    if (override.entityId !== (groups[0]?.entityId ?? override.entityId)) throw new FusionValidationError(`Interval override has a mismatched entity`)
    if (!sourceIds.has(override.sourceId)) throw new FusionValidationError(`Interval override references unknown source "${override.sourceId}"`)
    if (!Number.isFinite(override.startMs) || !Number.isFinite(override.endMs) || override.startMs > override.endMs) throw new FusionValidationError('Interval override range must have finite times with start at or before end')
  }
}
