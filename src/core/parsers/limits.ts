// Per-format import budgets. These exist so a runaway or unexpectedly large
// source file fails fast with an actionable message instead of stalling the
// UI or exhausting renderer memory deep inside a parser.
import type { SourceFormat } from '../model'

export interface FormatBudget {
  maxBytes: number
  maxPoints: number
}

const MB = 1024 * 1024

export const DEFAULT_FORMAT_BUDGETS: Record<SourceFormat, FormatBudget> = {
  csv: { maxBytes: 500 * MB, maxPoints: 2_000_000 },
  gpx: { maxBytes: 150 * MB, maxPoints: 1_000_000 },
  geojson: { maxBytes: 150 * MB, maxPoints: 1_000_000 },
  kml: { maxBytes: 150 * MB, maxPoints: 1_000_000 },
  nmea: { maxBytes: 150 * MB, maxPoints: 2_000_000 },
  gpb: { maxBytes: 300 * MB, maxPoints: 3_000_000 },
  eag: { maxBytes: 150 * MB, maxPoints: 2_000_000 },
  unknown: { maxBytes: 50 * MB, maxPoints: 500_000 },
}

export class FormatBudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormatBudgetExceededError'
  }
}

function formatMb(bytes: number): string {
  return (bytes / MB).toFixed(bytes % MB === 0 ? 0 : 1)
}

export function assertByteBudget(
  format: SourceFormat,
  byteLength: number,
  budgets: Record<SourceFormat, FormatBudget> = DEFAULT_FORMAT_BUDGETS,
): void {
  const budget = budgets[format]
  if (byteLength > budget.maxBytes) {
    throw new FormatBudgetExceededError(
      `${format.toUpperCase()} source is ${formatMb(byteLength)} MB, over the ${formatMb(budget.maxBytes)} MB import limit for this format. Split the file or import a smaller extract.`,
    )
  }
}

export function assertPointBudget(
  format: SourceFormat,
  pointCount: number,
  budgets: Record<SourceFormat, FormatBudget> = DEFAULT_FORMAT_BUDGETS,
): void {
  const budget = budgets[format]
  if (pointCount > budget.maxPoints) {
    throw new FormatBudgetExceededError(
      `${format.toUpperCase()} source produced ${pointCount.toLocaleString()} points, over the ${budget.maxPoints.toLocaleString()} point import limit for this format. Split the file or decimate before import.`,
    )
  }
}
