import type { Dataset, SourceFormat, TrackPoint } from '../model'
import type { MovementWindow } from './movementWindow'
import type { TrackHealthConfig } from './trackHealthConfig'

export type TrackHealthCheckId = 'altitude-profile' | 'speed-envelope' | 'time-order-span' | 'schema-parse' | 'outlier' | 'stagnant'

export type TrackHealthCheckStatus = 'pass' | 'fail' | 'na'

/** A drill-down target: either a single source point or a contiguous span of them. Indices are always into `Dataset.points`. */
export interface TrackHealthFlag {
  pointIndex?: number
  range?: { start: number; end: number }
  label: string
}

export interface TrackHealthCheckResult {
  id: TrackHealthCheckId
  label: string
  status: TrackHealthCheckStatus
  weight: number
  /** `weight` when the check passes, 0 otherwise. N/A checks are dropped from the score denominator upstream. */
  pointsAwarded: number
  summary: string
  details?: string[]
  flags: TrackHealthFlag[]
  preferredTab: 'map' | 'charts'
  measurements?: Record<string, number>
}

/** Work shared across checks so it is derived once per scan rather than per check. */
export interface TrackHealthSharedContext {
  movementWindow: MovementWindow | null
}

export interface TrackHealthCheckDefinition {
  id: TrackHealthCheckId
  label: string
  weight: number
  /** The schema/parse gate: unweighted, and a failure blocks scoring entirely. */
  blocking?: boolean
  /** Future per-format override point; undefined means the check applies to every source format. */
  appliesTo?: SourceFormat[]
  isApplicable(points: readonly TrackPoint[], dataset: Dataset, config: TrackHealthConfig, shared: TrackHealthSharedContext): boolean
  run(points: readonly TrackPoint[], dataset: Dataset, config: TrackHealthConfig, shared: TrackHealthSharedContext): TrackHealthCheckResult
}

export interface TrackHealthReport {
  datasetId: string
  computedAt: number
  /** 'scored': the numeric score is meaningful. 'blocked': the schema gate failed, so no score is produced. */
  status: 'scored' | 'blocked'
  score: number | null
  blockingReason?: string
  checks: TrackHealthCheckResult[]
}
