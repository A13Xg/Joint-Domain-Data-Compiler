// Task 3.1: typed, validated report section options. This is the contract
// downstream tasks (the export dialog, project-level persistence) are built
// on top of, so the shape is deliberately explicit rather than a flat bag of
// unrelated booleans — every field maps to exactly one report section, and
// nothing here is inferred implicitly from data at render time.
//
// Design choices worth calling out:
//  - `title` lives on the options object (not just the report input) so a
//    persisted "report preference" can fully describe what the next report
//    should look like, including its title.
//  - Core evidence sections that mirror the original 4-flag report
//    (source metadata, warnings, quality events, bookmarks, operation
//    history) default to `true` to preserve historical behavior.
//  - Sections that depend on data the caller must additionally supply
//    (comparison, fusion, overlay inventory) default to `false`: enabling
//    them without the caller also wiring up that data would otherwise
//    silently produce an empty/misleading section under a truthful-looking
//    "included" label.
//  - `includeNotionalDisclosure` defaults to `true` because omitting a
//    disclosure about synthetic/derived points is the failure mode this
//    task exists to close.

const MAX_TITLE_LENGTH = 200

export interface ReportOptions {
  /** Report document title. Trimmed, length-capped, and HTML-escaped at render time. */
  title: string
  /** Per-dataset source file, checksum, parser, and reference-frame metadata table. */
  includeSourceMetadata: boolean
  /** Per-dataset parser/import warnings. */
  includeWarnings: boolean
  /** Per-dataset automated quality-event detection (gaps, jumps, etc.). */
  includeQualityEvents: boolean
  /** Per-dataset user bookmarks. */
  includeBookmarks: boolean
  /** Per-dataset recorded transform/operation history. */
  includeOperationHistory: boolean
  /** Cross-dataset comparison analytics (relative range/closure), when supplied. */
  includeComparison: boolean
  /** Multi-source fusion decision summary, when supplied. */
  includeFusion: boolean
  /** Explicit disclosure of notional/derived (non-observed) points and their provenance. */
  includeNotionalDisclosure: boolean
  /** Inventory of map overlays active in the session, when supplied. */
  includeOverlayInventory: boolean
}

export type ReportSectionKey =
  | 'includeSourceMetadata'
  | 'includeWarnings'
  | 'includeQualityEvents'
  | 'includeBookmarks'
  | 'includeOperationHistory'
  | 'includeComparison'
  | 'includeFusion'
  | 'includeNotionalDisclosure'
  | 'includeOverlayInventory'

export interface ReportSectionDescriptor {
  key: ReportSectionKey
  label: string
}

/** Ordered, human-readable descriptions of each optional section — used to build the mandatory scope block and to drive any future options UI. */
export const REPORT_SECTIONS: readonly ReportSectionDescriptor[] = Object.freeze([
  { key: 'includeSourceMetadata', label: 'Source file, checksum, parser, and reference-frame metadata' },
  { key: 'includeWarnings', label: 'Import/parser warnings' },
  { key: 'includeQualityEvents', label: 'Automated quality-event detection' },
  { key: 'includeBookmarks', label: 'Bookmarks' },
  { key: 'includeOperationHistory', label: 'Recorded transform/operation history' },
  { key: 'includeComparison', label: 'Cross-dataset comparison analytics' },
  { key: 'includeFusion', label: 'Multi-source fusion decisions' },
  { key: 'includeNotionalDisclosure', label: 'Notional/derived-data disclosure' },
  { key: 'includeOverlayInventory', label: 'Map overlay inventory' },
])

export const DEFAULT_REPORT_TITLE = 'JDDC Analysis Report'

export const DEFAULT_REPORT_OPTIONS: ReportOptions = Object.freeze({
  title: DEFAULT_REPORT_TITLE,
  includeSourceMetadata: true,
  includeWarnings: true,
  includeQualityEvents: true,
  includeBookmarks: true,
  includeOperationHistory: true,
  includeComparison: false,
  includeFusion: false,
  includeNotionalDisclosure: true,
  includeOverlayInventory: false,
})

/** Safe-defaults constructor. Accepts a partial override for trusted, in-process callers (e.g. a UI building options interactively). Does not throw. */
export function createReportOptions(overrides?: Partial<ReportOptions>): ReportOptions {
  return normalizeReportOptions({ ...DEFAULT_REPORT_OPTIONS, ...overrides }).options
}

export interface NormalizeReportOptionsResult {
  options: ReportOptions
  /** True only if every field of the input was already well-formed. */
  valid: boolean
  /** Human-readable reasons for any field that fell back to a default, empty when valid. */
  reasons: string[]
}

/**
 * Validate/normalize report options recovered from untrusted persisted data
 * (project manifests, saved preferences, etc.). Never throws: malformed or
 * missing fields fall back field-by-field to safe defaults, and every
 * fallback is reported in `reasons` so callers can surface a warning.
 *
 * `fallbackTitle` lets callers (e.g. the report builder itself, given a
 * dataset/project-derived title) supply a better default than the generic
 * one when the persisted value omits a title entirely.
 */
export function normalizeReportOptions(value: unknown, fallbackTitle?: string): NormalizeReportOptionsResult {
  const reasons: string[] = []
  const defaultTitle = fallbackTitle?.trim() ? fallbackTitle.trim().slice(0, MAX_TITLE_LENGTH) : DEFAULT_REPORT_TITLE

  if (value === undefined || value === null) {
    return { options: { ...DEFAULT_REPORT_OPTIONS, title: defaultTitle }, valid: true, reasons: [] }
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return {
      options: { ...DEFAULT_REPORT_OPTIONS, title: defaultTitle },
      valid: false,
      reasons: ['Report options were not a valid object; using safe defaults.'],
    }
  }

  const record = value as Record<string, unknown>
  const title = normalizeTitle(record.title, defaultTitle, reasons)
  const options: ReportOptions = {
    title,
    includeSourceMetadata: normalizeBoolean(record.includeSourceMetadata, DEFAULT_REPORT_OPTIONS.includeSourceMetadata, 'includeSourceMetadata', reasons),
    includeWarnings: normalizeBoolean(record.includeWarnings, DEFAULT_REPORT_OPTIONS.includeWarnings, 'includeWarnings', reasons),
    includeQualityEvents: normalizeBoolean(record.includeQualityEvents, DEFAULT_REPORT_OPTIONS.includeQualityEvents, 'includeQualityEvents', reasons),
    includeBookmarks: normalizeBoolean(record.includeBookmarks, DEFAULT_REPORT_OPTIONS.includeBookmarks, 'includeBookmarks', reasons),
    includeOperationHistory: normalizeBoolean(record.includeOperationHistory, DEFAULT_REPORT_OPTIONS.includeOperationHistory, 'includeOperationHistory', reasons),
    includeComparison: normalizeBoolean(record.includeComparison, DEFAULT_REPORT_OPTIONS.includeComparison, 'includeComparison', reasons),
    includeFusion: normalizeBoolean(record.includeFusion, DEFAULT_REPORT_OPTIONS.includeFusion, 'includeFusion', reasons),
    includeNotionalDisclosure: normalizeBoolean(record.includeNotionalDisclosure, DEFAULT_REPORT_OPTIONS.includeNotionalDisclosure, 'includeNotionalDisclosure', reasons),
    includeOverlayInventory: normalizeBoolean(record.includeOverlayInventory, DEFAULT_REPORT_OPTIONS.includeOverlayInventory, 'includeOverlayInventory', reasons),
  }

  return { options, valid: reasons.length === 0, reasons }
}

function normalizeTitle(value: unknown, fallback: string, reasons: string[]): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string') {
    reasons.push('Report title was not a string; using the default title.')
    return fallback
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    reasons.push('Report title was empty; using the default title.')
    return fallback
  }
  if (trimmed.length > MAX_TITLE_LENGTH) {
    reasons.push(`Report title exceeded ${MAX_TITLE_LENGTH} characters and was truncated.`)
    return trimmed.slice(0, MAX_TITLE_LENGTH)
  }
  return trimmed
}

function normalizeBoolean(value: unknown, fallback: boolean, field: string, reasons: string[]): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') {
    reasons.push(`Report option "${field}" was not a boolean; using the default.`)
    return fallback
  }
  return value
}

// --- Supplementary section data contracts -----------------------------
// These describe the shape of the *optional* data a caller may pass into
// the report builder to populate cross-dataset sections. They live here
// (rather than only inline in htmlReport.ts) so persistence/UI tasks can
// import them without depending on the HTML builder module.

export interface ReportComparisonSummary {
  referenceDatasetName: string
  targetDatasetName: string
  sampleCount: number
  minRangeMeters?: number
  maxRangeMeters?: number
  meanRangeMeters?: number
  meanHorizontalRangeMeters?: number
  meanClosureRateMps?: number
  error?: string
}

export interface ReportOverlayEntry {
  id: string
  name: string
  sourceKind: string
  visible: boolean
}
