export const KNOWN_FIELDS = [
  'latitude',
  'longitude',
  'elevation',
  'timestamp',
  'name',
  'description',
] as const

export type KnownField = (typeof KNOWN_FIELDS)[number]

export type ColumnEstimatedType =
  | 'latitude'
  | 'longitude'
  | 'elevation'
  | 'datetime'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'identifier'
  | 'text'
  | 'mixed'

export interface FieldCandidate {
  field: KnownField
  score: number
}

export interface ColumnStats {
  nonEmptyRatio: number
  uniqueRatio: number
  numericRatio: number
  datetimeRatio: number
  booleanRatio: number
}

export interface DetectedColumn {
  name: string
  index: number
  headerCandidates: string[]
  sampleValues: string[]
  estimatedType: ColumnEstimatedType
  estimatedConfidence: number
  patterns: string[]
  stats: ColumnStats
  candidates: FieldCandidate[]
}

export type CsvSampleRow = Record<string, string>

export interface CsvHeaderInference {
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

/** Mirrors core/parsers/csvPreview.ts's HeaderInferenceResult, duplicated here
 *  (rather than imported) so this module stays free of a dependency on the
 *  parsers subtree; csvAnalysis.ts is responsible for keeping the shapes in
 *  sync. */
export interface CsvRowOneInference {
  inferred: boolean
  confidence: 'high' | 'medium' | 'low' | 'ambiguous'
  reasons: string[]
}

export interface CsvAnalysisResult {
  delimiter: string
  rowCountSampled: number
  dataStartRow: number
  sampleRows: CsvSampleRow[]
  rawPreviewRows: string[][]
  headerInference: CsvHeaderInference
  /** Independent, bounded row-1-only verdict from csvPreview's
   *  inferHeaderRowFromRows, sampled over the same rawPreviewRows. Additive
   *  evidence alongside `headerInference` — the two can legitimately
   *  disagree (they use different heuristics/scopes), so both are surfaced
   *  to the user rather than one silently overriding the other. */
  rowOneInference: CsvRowOneInference
  columns: DetectedColumn[]
}
