export const KNOWN_FIELDS = [
  'latitude',
  'longitude',
  'elevation',
  'timestamp',
  'name',
  'description',
] as const

export type KnownField = (typeof KNOWN_FIELDS)[number]

export type ElevationUnit = 'meters' | 'feet'

export type TimeUnit = 'iso' | 'epoch_seconds' | 'epoch_milliseconds' | 'excel_serial'

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
  sampleValues: string[]
  estimatedType: ColumnEstimatedType
  estimatedConfidence: number
  patterns: string[]
  stats: ColumnStats
  candidates: FieldCandidate[]
}

export type CsvSampleRow = Record<string, string>

export interface CsvAnalysisResult {
  delimiter: string
  rowCountSampled: number
  sampleRows: CsvSampleRow[]
  columns: DetectedColumn[]
}

export interface MappingState {
  latitude: string
  longitude: string
  elevation: string
  timestamp: string
  name: string
  description: string
  elevationUnit: ElevationUnit
  timeUnit: TimeUnit
}

export interface CsvToGpxOptions {
  file: File
  mapping: MappingState
  delimiter?: string
  trackName: string
  onProgress?: (value: number) => void
}

export interface CsvToGpxResult {
  pointCount: number
  blob: Blob
  stats: {
    processedRows: number
    skippedMissingCoordinates: number
    skippedOutOfRangeCoordinates: number
    includedElevation: number
    includedTimestamp: number
  }
}
