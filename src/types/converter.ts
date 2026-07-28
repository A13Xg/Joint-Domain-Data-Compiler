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

export interface CsvAnalysisResult {
  delimiter: string
  rowCountSampled: number
  dataStartRow: number
  sampleRows: CsvSampleRow[]
  rawPreviewRows: string[][]
  headerInference: CsvHeaderInference
  columns: DetectedColumn[]
}
