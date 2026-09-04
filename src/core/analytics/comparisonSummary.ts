import type { Dataset } from '../model'
import { assessDatasetCompatibility } from '../metadataCompatibility'
import { errorMessage } from '../errors'
import type { ReportComparisonSummary } from '../reports/options'
import {
  alignTracksByInterpolation,
  alignTracksByNearestTime,
  deriveInterpolatedRelativePosition,
  deriveRelativePosition,
  type RelativePointSample,
} from './relative'

/** The persisted comparison controls, mirroring `WorkspaceState['comparison']`. */
export interface ComparisonSettings {
  referenceDatasetId: string | null
  targetDatasetId: string | null
  toleranceMs: number
  targetOffsetMs: number
  interpolateTarget: boolean
}

export interface ComparisonSamples {
  samples: RelativePointSample[]
  error: string | null
}

export interface ComparisonRangeStats {
  minRangeMeters?: number
  maxRangeMeters?: number
  meanRangeMeters?: number
  meanHorizontalRangeMeters?: number
  meanClosureRateMps?: number
}

/**
 * Which two datasets the Comparison tab is actually showing. Report export has
 * to resolve this the same way the panel does, or a report could name a
 * different pair than the one on screen -- hence one shared resolver rather
 * than a second copy of the `??` chain.
 */
export function resolveComparisonDatasetIds(
  datasets: readonly Dataset[],
  settings: ComparisonSettings,
  activeDatasetId: string | null,
): { referenceId: string; targetId: string } {
  const referenceId = settings.referenceDatasetId ?? activeDatasetId ?? datasets[0]?.id ?? ''
  const targetId = settings.targetDatasetId ?? datasets.find((dataset) => dataset.id !== referenceId)?.id ?? ''
  return { referenceId, targetId }
}

/** Align two tracks under the current settings. Never throws: a failed alignment is reported as `error`. */
export function computeComparisonSamples(
  reference: Dataset,
  target: Dataset,
  settings: ComparisonSettings,
): ComparisonSamples {
  const compatibility = assessDatasetCompatibility(reference, target)
  if (compatibility.level === 'blocked') return { samples: [], error: compatibility.reasons.join(' ') }
  try {
    const samples = settings.interpolateTarget
      ? deriveInterpolatedRelativePosition(reference.points, target.points, alignTracksByInterpolation(reference.points, target.points, { maxBracketGapMs: settings.toleranceMs, targetTimeOffsetMs: settings.targetOffsetMs }))
      : deriveRelativePosition(reference.points, target.points, alignTracksByNearestTime(reference.points, target.points, { toleranceMs: settings.toleranceMs, targetTimeOffsetMs: settings.targetOffsetMs }))
    return { samples, error: null }
  } catch (error) {
    return { samples: [], error: errorMessage(error) }
  }
}

/**
 * The range statistics both the Comparison tab and the HTML report show.
 * Reduce rather than `Math.min(...ranges)` so a long comparison can't overflow
 * the argument limit on the report path, where nothing caps sample count.
 */
export function summarizeComparisonRanges(samples: readonly RelativePointSample[]): ComparisonRangeStats {
  if (samples.length === 0) return {}
  const ranges = samples.map((sample) => sample.slantRangeM)
  const horizontal = samples.map((sample) => sample.horizontalRangeM)
  const closures = samples.map((sample) => sample.closureRateMps).filter((value): value is number => value !== undefined)
  return {
    minRangeMeters: ranges.reduce((low, value) => Math.min(low, value), Infinity),
    maxRangeMeters: ranges.reduce((high, value) => Math.max(high, value), -Infinity),
    meanRangeMeters: mean(ranges),
    meanHorizontalRangeMeters: mean(horizontal),
    meanClosureRateMps: closures.length > 0 ? mean(closures) : undefined,
  }
}

/**
 * Re-derive the comparison for report export from the same persisted settings
 * the Comparison tab reads, so a report never has to depend on whether the user
 * happened to open that tab first.
 *
 * Returns `undefined` only when no comparison is configured at all (fewer than
 * two datasets, or reference and target resolve to the same one) -- that is the
 * case the report's "not yet captured" placeholder honestly describes. A
 * configured comparison that simply aligned nothing returns `sampleCount: 0`
 * with the range fields absent, which renders as "Unavailable" rows instead of
 * silently claiming no comparison exists.
 */
export function buildReportComparisonSummary(
  datasets: readonly Dataset[],
  settings: ComparisonSettings,
  activeDatasetId: string | null,
): ReportComparisonSummary | undefined {
  const { referenceId, targetId } = resolveComparisonDatasetIds(datasets, settings, activeDatasetId)
  const reference = datasets.find((dataset) => dataset.id === referenceId)
  const target = datasets.find((dataset) => dataset.id === targetId)
  if (!reference || !target || reference.id === target.id) return undefined
  const { samples, error } = computeComparisonSamples(reference, target, settings)
  const names = { referenceDatasetName: reference.name, targetDatasetName: target.name }
  // Both names are populated on the error path too: buildComparisonSection
  // renders the failure as "{reference} vs {target}: {error}".
  if (error) return { ...names, sampleCount: 0, error }
  return { ...names, sampleCount: samples.length, ...summarizeComparisonRanges(samples) }
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
