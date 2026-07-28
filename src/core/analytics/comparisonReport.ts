import type { RelativePointSample } from './relative'

export function buildComparisonCsv(samples: readonly RelativePointSample[]): string {
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
  return [header.join(','), ...rows].join('\n') + '\n'
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
