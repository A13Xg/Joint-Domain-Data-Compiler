import type { ClockDriftEstimate, RelativePointSample } from './relative'

/**
 * Builds the per-sample comparison CSV. `drift` is a single derived value
 * for the whole comparison (not per-row like everything else here), so when
 * supplied it is appended as trailing `# key,value` comment lines after the
 * data rows rather than as extra columns — this keeps the per-row schema
 * stable while still capturing the estimate in the one file users export.
 * `drift` is optional and omitted entirely (no crash, no comment lines) when
 * not supplied — e.g. interpolated-target comparisons where drift isn't meaningful.
 */
export function buildComparisonCsv(samples: readonly RelativePointSample[], drift?: ClockDriftEstimate): string {
  const header = ['reference_index', 'target_index', 'derived', 'delta_time_ms', 'slant_range_m', 'horizontal_range_m', 'bearing_deg', 'relative_up_m', 'closure_rate_mps']
  const rows = samples.map((sample) => [
    sample.referenceIndex,
    sample.targetIndex,
    sample.derived === true ? 'interpolated' : 'observed',
    sample.deltaTimeMs,
    sample.slantRangeM,
    sample.horizontalRangeM,
    sample.bearingDeg,
    sample.relativeUpM,
    sample.closureRateMps ?? '',
  ].map(csvCell).join(','))
  const lines = [header.join(','), ...rows]
  if (drift) {
    lines.push(
      `# estimated_clock_offset_ms,${drift.offsetMs}`,
      `# estimated_clock_drift_ppm,${drift.driftRatePerMs * 1_000_000}`,
      `# clock_drift_reference_epoch_ms,${drift.referenceEpochMs}`,
      `# clock_drift_sample_count,${drift.sampleCount}`,
    )
  }
  return lines.join('\n') + '\n'
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
