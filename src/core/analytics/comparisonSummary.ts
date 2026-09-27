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
  return {
    ...names,
    sampleCount: samples.length,
    ...summarizeComparisonRanges(samples),
    distributions: summarizeComparisonDistributions(samples),
    slantRangeHistogram: histogram(samples.map((sample) => sample.slantRangeM)),
  }
}

/**
 * Shape of one comparison quantity across every aligned sample. A mean alone
 * hides exactly what a range comparison is usually after -- a track that sits
 * 50 m off for the whole sortie and one that sits at 0 m then jumps 2 km have
 * similar means and nothing else in common.
 */
export interface DistributionStats {
  count: number
  min: number
  median: number
  /** 95th percentile, linear interpolation between order statistics. */
  p95: number
  max: number
  mean: number
  /** Sample standard deviation (n − 1); 0 for a single value. */
  stdDev: number
}

export interface ComparisonDistributions {
  slantRangeM?: DistributionStats
  horizontalRangeM?: DistributionStats
  /** |vertical separation|: a signed median of "above" and "below" would cancel out. */
  verticalSeparationM?: DistributionStats
  closureRateMps?: DistributionStats
}

/** Non-finite values are skipped, never coerced. `undefined` when nothing is left. */
export function distributionStats(values: readonly number[]): DistributionStats | undefined {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  const n = sorted.length
  if (n === 0) return undefined
  const average = mean(sorted)
  const variance = n > 1 ? sorted.reduce((sum, value) => sum + (value - average) ** 2, 0) / (n - 1) : 0
  return {
    count: n,
    min: sorted[0]!,
    median: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    max: sorted[n - 1]!,
    mean: average,
    stdDev: Math.sqrt(variance),
  }
}

export function summarizeComparisonDistributions(samples: readonly RelativePointSample[]): ComparisonDistributions {
  return {
    slantRangeM: distributionStats(samples.map((sample) => sample.slantRangeM)),
    horizontalRangeM: distributionStats(samples.map((sample) => sample.horizontalRangeM)),
    verticalSeparationM: distributionStats(samples.map((sample) => Math.abs(sample.relativeUpM))),
    closureRateMps: distributionStats(samples.flatMap((sample) => sample.closureRateMps === undefined ? [] : [sample.closureRateMps])),
  }
}

/**
 * Equal-width histogram. Every finite value lands in exactly one bin (the last
 * bin is closed at the top), so the counts always sum to the value count.
 */
export function histogram(values: readonly number[], binCount = 20): { edges: number[]; counts: number[] } | undefined {
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length === 0 || !Number.isInteger(binCount) || binCount < 1) return undefined
  const low = finite.reduce((a, b) => Math.min(a, b), Infinity)
  const high = finite.reduce((a, b) => Math.max(a, b), -Infinity)
  const bins = high > low ? binCount : 1
  const width = high > low ? (high - low) / bins : 1
  const edges = Array.from({ length: bins + 1 }, (_, i) => (i === bins && high > low ? high : low + i * width))
  const counts = new Array<number>(bins).fill(0)
  for (const value of finite) counts[Math.min(bins - 1, Math.floor((value - low) / width))]!++
  return { edges, counts }
}

function quantile(sorted: readonly number[], q: number): number {
  const position = (sorted.length - 1) * q
  const lower = Math.floor(position)
  const fraction = position - lower
  return lower + 1 < sorted.length ? sorted[lower]! + fraction * (sorted[lower + 1]! - sorted[lower]!) : sorted[lower]!
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
