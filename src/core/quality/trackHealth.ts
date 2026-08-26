import type { Dataset } from '../model'
import type { TrackHealthCheckDefinition, TrackHealthCheckResult, TrackHealthReport, TrackHealthSharedContext } from './trackHealthTypes'
import { DEFAULT_TRACK_HEALTH_CONFIG, type TrackHealthConfig } from './trackHealthConfig'
import { detectMovementWindow } from './movementWindow'
import { TRACK_HEALTH_CHECKS } from './trackHealthChecks'

function skipped(check: TrackHealthCheckDefinition, summary: string): TrackHealthCheckResult {
  // N/A rows carry no flags, so `preferredTab` is inert here; 'map' is just the neutral default.
  return { id: check.id, label: check.label, status: 'na', weight: check.weight, pointsAwarded: 0, summary, flags: [], preferredTab: 'map' }
}

/**
 * Runs every applicable health check and folds the results into a 0-100 score.
 *
 * Checks that cannot run on this dataset (no elevation, no timestamps) report `na` and are
 * dropped from the denominator, so the remaining checks are re-weighted to still total 100 —
 * a track without altitude data is not penalised for an altitude check it could never pass.
 *
 * A failing blocking check (the schema gate) suppresses the numeric score entirely rather than
 * reporting a low one, since a structurally unsound dataset makes every other measure unreliable.
 * The remaining checks still run so the panel can show what else was observed.
 */
export function computeTrackHealth(
  dataset: Dataset,
  config: TrackHealthConfig = DEFAULT_TRACK_HEALTH_CONFIG,
  onProgress?: (completed: number, total: number, message: string) => void,
): TrackHealthReport {
  const { points } = dataset
  const checks = TRACK_HEALTH_CHECKS
  const shared: TrackHealthSharedContext = { movementWindow: detectMovementWindow(points, config.movementWindow) }

  const results: TrackHealthCheckResult[] = []
  let blockingReason: string | undefined

  for (let step = 0; step < checks.length; step++) {
    const check = checks[step]
    if (!check) continue
    onProgress?.(step, checks.length, `Checking ${check.label}`)

    const applicable = check.appliesTo === undefined || check.appliesTo.includes(dataset.sourceFormat)
    const result = applicable && check.isApplicable(points, dataset, config, shared)
      ? check.run(points, dataset, config, shared)
      : skipped(check, applicable ? 'Required data is not present on this track' : `Not applicable to ${dataset.sourceFormat} sources`)

    results.push(result)
    if (check.blocking && result.status === 'fail') blockingReason = result.summary
  }
  onProgress?.(checks.length, checks.length, 'Scan complete')

  const scored = results.filter((result) => result.status !== 'na' && result.weight > 0)
  const totalWeight = scored.reduce((sum, result) => sum + result.weight, 0)
  const earned = scored.reduce((sum, result) => sum + result.pointsAwarded, 0)

  if (blockingReason !== undefined) {
    return { datasetId: dataset.id, computedAt: Date.now(), status: 'blocked', score: null, blockingReason, checks: results }
  }

  return {
    datasetId: dataset.id,
    computedAt: Date.now(),
    status: 'scored',
    // No applicable weighted check means there is nothing to score, which is not the same as scoring zero.
    score: totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : null,
    checks: results,
  }
}
