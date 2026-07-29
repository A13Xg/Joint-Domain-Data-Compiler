import type { FusedPointDecision, SourceRegistration } from './model'
import type { FusionReport } from './report'

/** Durable, manifest-serializable provenance for one fusion run. */
export interface FusionArtifact {
  id: string
  entityId: string
  fusedDatasetId: string
  sourceRegistrations: SourceRegistration[]
  timeToleranceMs: number
  decisions: FusedPointDecision[]
  report: FusionReport
  createdAt: number
}

export function validateFusionArtifact(value: unknown): asserts value is FusionArtifact {
  if (!isRecord(value)) throw new Error('Fusion artifact must be an object')
  requireText(value.id, 'fusion artifact id')
  requireText(value.entityId, 'fusion artifact entity id')
  requireText(value.fusedDatasetId, 'fusion artifact fused dataset id')
  if (!Array.isArray(value.sourceRegistrations) || value.sourceRegistrations.length < 2) throw new Error('Fusion artifact requires at least two source registrations')
  if (!Array.isArray(value.decisions)) throw new Error('Fusion artifact decisions must be an array')
  const timeToleranceMs = value.timeToleranceMs
  if (typeof timeToleranceMs !== 'number' || !Number.isFinite(timeToleranceMs) || timeToleranceMs < 1 || timeToleranceMs > 86_400_000) throw new Error('Fusion artifact time tolerance must be between 1 and 86400000 ms')
  if (!Number.isFinite(value.createdAt)) throw new Error('Fusion artifact createdAt must be finite')
  if (!isRecord(value.report) || value.report.totalGroups !== value.decisions.length) throw new Error('Fusion artifact report totalGroups must match decisions')
  const sourceIds = new Set<string>()
  const datasetIds = new Set<string>()
  for (const source of value.sourceRegistrations) {
    if (!isRecord(source)) throw new Error('Fusion artifact source registration must be an object')
    requireText(source.id, 'fusion source id'); requireText(source.datasetId, 'fusion source dataset id')
    if (sourceIds.has(source.id) || datasetIds.has(source.datasetId)) throw new Error('Fusion artifact source registrations must be unique')
    sourceIds.add(source.id); datasetIds.add(source.datasetId)
  }
  for (const decision of value.decisions) {
    if (!isRecord(decision) || typeof decision.chosenSourceId !== 'string' || !sourceIds.has(decision.chosenSourceId)) throw new Error('Fusion artifact decision references an unknown source')
    if (!Array.isArray(decision.skippedSourceIds) || !decision.skippedSourceIds.every((sourceId) => typeof sourceId === 'string' && sourceIds.has(sourceId))) {
      throw new Error('Fusion artifact decision skips an unknown source')
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function requireText(value: unknown, label: string): asserts value is string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`) }
