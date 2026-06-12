/// <reference lib="webworker" />
import Papa from 'papaparse'
import {
  KNOWN_FIELDS,
  type ColumnEstimatedType,
  type ColumnStats,
  type CsvAnalysisResult,
  type CsvSampleRow,
  type DetectedColumn,
  type KnownField,
} from '../types/converter'

interface AnalyzeMessage {
  type: 'analyze'
  payload: {
    file: File
    sampleLimit: number
  }
}

interface ProgressMessage {
  type: 'progress'
  payload: {
    progress: number
    sampled: number
  }
}

interface CompleteMessage {
  type: 'complete'
  payload: CsvAnalysisResult
}

interface ErrorMessage {
  type: 'error'
  payload: {
    message: string
  }
}

function parseNumber(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const normalized = /^-?\d+,\d+$/.test(trimmed)
    ? trimmed.replace(',', '.')
    : trimmed.replaceAll(',', '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function parseDateLike(value: string): number | null {
  const direct = new Date(value)
  if (!Number.isNaN(direct.valueOf())) {
    return direct.valueOf()
  }

  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return null
  }

  if (numeric > 1000000000000 && numeric < 9000000000000) {
    return numeric
  }

  if (numeric > 1000000000 && numeric < 9000000000) {
    return numeric * 1000
  }

  if (numeric > 25569 && numeric < 70000) {
    return (numeric - 25569) * 86400 * 1000
  }

  return null
}

function detectPatterns(values: string[], header: string): string[] {
  const patterns = new Set<string>()
  const normalizedHeader = header.toLowerCase()

  if (/(lat|latitude)/.test(normalizedHeader)) {
    patterns.add('header:latitude_like')
  }

  if (/(lon|lng|longitude)/.test(normalizedHeader)) {
    patterns.add('header:longitude_like')
  }

  if (/(alt|elev|height)/.test(normalizedHeader)) {
    patterns.add('header:elevation_like')
  }

  if (/(time|date|utc|created|recorded)/.test(normalizedHeader)) {
    patterns.add('header:timestamp_like')
  }

  if (values.some((value) => /^-?\d+\.\d+$/.test(value))) {
    patterns.add('value:decimal_numbers')
  }

  if (values.some((value) => /^-?\d+$/.test(value))) {
    patterns.add('value:integer_numbers')
  }

  if (values.some((value) => /^-?\d{10}$/.test(value))) {
    patterns.add('value:epoch_seconds_candidate')
  }

  if (values.some((value) => /^-?\d{13}$/.test(value))) {
    patterns.add('value:epoch_milliseconds_candidate')
  }

  if (values.some((value) => /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?/.test(value))) {
    patterns.add('value:iso_datetime_candidate')
  }

  if (values.some((value) => /^(true|false|yes|no|y|n|0|1)$/i.test(value))) {
    patterns.add('value:boolean_flags')
  }

  if (values.some((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))) {
    patterns.add('value:uuid')
  }

  if (values.some((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) {
    patterns.add('value:email')
  }

  if (values.some((value) => /^https?:\/\//.test(value))) {
    patterns.add('value:url')
  }

  return Array.from(patterns)
}

function buildStats(values: string[]): ColumnStats {
  if (values.length === 0) {
    return {
      nonEmptyRatio: 0,
      uniqueRatio: 0,
      numericRatio: 0,
      datetimeRatio: 0,
      booleanRatio: 0,
    }
  }

  const nonEmpty = values.filter((value) => value.trim().length > 0)
  if (nonEmpty.length === 0) {
    return {
      nonEmptyRatio: 0,
      uniqueRatio: 0,
      numericRatio: 0,
      datetimeRatio: 0,
      booleanRatio: 0,
    }
  }

  const unique = new Set(nonEmpty.map((value) => value.trim())).size
  const numeric = nonEmpty.filter((value) => parseNumber(value) !== null).length
  const datetime = nonEmpty.filter((value) => parseDateLike(value) !== null).length
  const booleanLike = nonEmpty.filter((value) => /^(true|false|yes|no|y|n|0|1)$/i.test(value.trim())).length

  return {
    nonEmptyRatio: nonEmpty.length / values.length,
    uniqueRatio: unique / nonEmpty.length,
    numericRatio: numeric / nonEmpty.length,
    datetimeRatio: datetime / nonEmpty.length,
    booleanRatio: booleanLike / nonEmpty.length,
  }
}

function inferEstimatedType(
  stats: ColumnStats,
  patterns: string[],
  candidates: Array<{ field: KnownField; score: number }>,
): { type: ColumnEstimatedType; confidence: number } {
  const topCandidate = candidates[0]

  if (topCandidate && topCandidate.score >= 0.8) {
    const candidateMap: Record<KnownField, ColumnEstimatedType> = {
      latitude: 'latitude',
      longitude: 'longitude',
      elevation: 'elevation',
      timestamp: 'datetime',
      name: 'text',
      description: 'text',
    }

    return {
      type: candidateMap[topCandidate.field],
      confidence: topCandidate.score,
    }
  }

  if (stats.booleanRatio >= 0.9) {
    return { type: 'boolean', confidence: stats.booleanRatio }
  }

  if (stats.datetimeRatio >= 0.7 || patterns.includes('value:iso_datetime_candidate')) {
    return { type: 'datetime', confidence: Math.max(stats.datetimeRatio, 0.7) }
  }

  if (stats.numericRatio >= 0.92) {
    if (patterns.includes('value:decimal_numbers')) {
      return { type: 'decimal', confidence: stats.numericRatio }
    }
    return { type: 'integer', confidence: stats.numericRatio }
  }

  if (stats.uniqueRatio >= 0.95 && stats.numericRatio < 0.4) {
    return { type: 'identifier', confidence: stats.uniqueRatio }
  }

  if (stats.numericRatio > 0.35 && stats.numericRatio < 0.85) {
    return { type: 'mixed', confidence: 0.6 }
  }

  return { type: 'text', confidence: Math.max(0.45, 1 - stats.numericRatio) }
}

function scoreByHeader(header: string, field: KnownField): number {
  const normalized = header.toLowerCase().replaceAll(/[^a-z0-9]+/g, ' ').trim()

  const patterns: Record<KnownField, RegExp[]> = {
    latitude: [/\blat\b/, /latitude/, /gps.?lat/],
    longitude: [/\blon\b/, /\blng\b/, /longitude/, /gps.?lon/],
    elevation: [/\bele\b/, /alt/, /height/, /elevation/],
    timestamp: [/time/, /date/, /recorded.?at/, /utc/],
    name: [/name/, /title/, /label/, /id$/],
    description: [/desc/, /comment/, /note/, /remark/],
  }

  return patterns[field].some((pattern) => pattern.test(normalized)) ? 0.65 : 0
}

function scoreByValues(values: string[], field: KnownField): number {
  if (values.length === 0) {
    return 0
  }

  const nonEmpty = values.filter((value) => value.trim().length > 0)
  if (nonEmpty.length === 0) {
    return 0
  }

  if (field === 'latitude') {
    const valid = nonEmpty.filter((value) => {
      const n = parseNumber(value)
      return n !== null && n >= -90 && n <= 90
    }).length
    return valid / nonEmpty.length
  }

  if (field === 'longitude') {
    const valid = nonEmpty.filter((value) => {
      const n = parseNumber(value)
      return n !== null && n >= -180 && n <= 180
    }).length
    return valid / nonEmpty.length
  }

  if (field === 'elevation') {
    const valid = nonEmpty.filter((value) => parseNumber(value) !== null).length
    return (valid / nonEmpty.length) * 0.75
  }

  if (field === 'timestamp') {
    const parseable = nonEmpty.filter((value) => {
      const asNumber = Number(value)
      if (Number.isFinite(asNumber)) {
        return true
      }
      return !Number.isNaN(new Date(value).valueOf())
    }).length
    return parseable / nonEmpty.length
  }

  if (field === 'name') {
    const textValues = nonEmpty.filter((value) => /[a-z]/i.test(value)).length
    return textValues / nonEmpty.length
  }

  const descriptive = nonEmpty.filter((value) => value.trim().length > 10).length
  return descriptive / nonEmpty.length
}

const MAX_HEADER_ROWS = 5

/** A row counts toward the header block if it has at least one non-empty cell
 *  and fewer than half of its non-empty cells look numeric. */
function isHeaderLikeRow(row: string[]): boolean {
  const nonEmpty = row.filter((cell) => cell.trim().length > 0)
  if (nonEmpty.length === 0) return false // fully blank row: stop the header block here
  const numeric = nonEmpty.filter((cell) => parseNumber(cell) !== null).length
  return numeric / nonEmpty.length < 0.5
}

/** Walk up to MAX_HEADER_ROWS leading rows; count how many are "header-like".
 *  Stops at the first row that is NOT header-like (including fully-empty rows).
 *  Returns 0 if row 0 already looks like data (no header at all). */
function detectDataStartRow(rawRows: string[][]): number {
  const limit = Math.min(MAX_HEADER_ROWS, rawRows.length)
  let count = 0
  for (let i = 0; i < limit; i++) {
    if (!isHeaderLikeRow(rawRows[i])) break
    count++
  }
  return count
}

function buildHeaderCandidatesForColumn(
  rawRows: string[][],
  colIndex: number,
  dataStartRow: number,
): string[] {
  const seen = new Set<string>()
  const candidates: string[] = []
  for (let r = 0; r < dataStartRow; r++) {
    const raw = (rawRows[r]?.[colIndex] ?? '').trim()
    if (!raw || seen.has(raw)) continue
    seen.add(raw)
    candidates.push(raw)
  }
  return candidates
}

function buildColumns(rawRows: string[][], dataStartRow: number): DetectedColumn[] {
  const maxCols = rawRows.reduce((max, row) => Math.max(max, row.length), 0)
  const dataRows = rawRows.slice(dataStartRow)

  // Pass 1: compute raw headerCandidates + provisional name per column.
  const provisional = Array.from({ length: maxCols }, (_, index) => {
    const headerCandidates = buildHeaderCandidatesForColumn(rawRows, index, dataStartRow)
    const provisionalName = headerCandidates[0] || `Column ${index + 1}`
    return { index, headerCandidates, provisionalName }
  })

  // Pass 2: dedup provisional names -> final `name`. Two columns sharing the
  // same headerCandidates[0] (e.g. repeated "VALUE" header) get `_2`, `_3`, ...
  const seenNames = new Map<string, number>()
  const finalized = provisional.map(({ index, headerCandidates, provisionalName }) => {
    const count = seenNames.get(provisionalName) ?? 0
    seenNames.set(provisionalName, count + 1)
    const name = count === 0 ? provisionalName : `${provisionalName}_${count + 1}`
    // headerCandidates[0] must match `name` for FieldSelect/ sampleRows lookups
    // to be consistent; if we suffixed, replace/seed headerCandidates[0].
    const finalHeaderCandidates =
      headerCandidates.length > 0
        ? [name, ...headerCandidates.slice(1)]
        : [name]
    return { index, name, headerCandidates: finalHeaderCandidates }
  })

  // Pass 3: per-column stats/patterns/candidates from data rows.
  return finalized.map(({ index, name, headerCandidates }) => {
    const allValues = dataRows.map((row) => row[index] ?? '')
    const sampleValues = allValues.filter((v) => v.trim().length > 0).slice(0, 6)
    const stats = buildStats(allValues)
    const headerForMatching = headerCandidates.join(' ')
    const patterns = detectPatterns(sampleValues, headerForMatching)

    const candidates = KNOWN_FIELDS.map((field) => ({
      field,
      score: Math.min(
        1,
        scoreByHeader(headerForMatching, field) * 0.7 + scoreByValues(allValues, field) * 0.8,
      ),
    }))
      .filter((c) => c.score >= 0.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

    const estimated = inferEstimatedType(stats, patterns, candidates)

    return {
      name,
      index,
      headerCandidates,
      sampleValues,
      estimatedType: estimated.type,
      estimatedConfidence: estimated.confidence,
      patterns,
      stats,
      candidates,
    }
  })
}

function normalizeRows(dataRows: string[][], columns: DetectedColumn[]): CsvSampleRow[] {
  return dataRows.map((row) => {
    const normalized: CsvSampleRow = {}
    for (const col of columns) {
      normalized[col.name] = row[col.index] ?? ''
    }
    return normalized
  })
}

self.onmessage = (event: MessageEvent<AnalyzeMessage>) => {
  if (event.data.type !== 'analyze') {
    return
  }

  const { file, sampleLimit } = event.data.payload
  const rawRows: string[][] = []
  let delimiter = ','

  Papa.parse<string[]>(file, {
    header: false,
    skipEmptyLines: 'greedy',
    chunkSize: 1024 * 1024,
    chunk: (result: Papa.ParseResult<string[]>, parser: Papa.Parser) => {
      if (result.meta.delimiter) delimiter = result.meta.delimiter

      for (const row of result.data) {
        if (rawRows.length < sampleLimit) rawRows.push(row)
      }

      const progress = result.meta.cursor
        ? Math.min(100, (result.meta.cursor / file.size) * 100)
        : 0
      self.postMessage({
        type: 'progress',
        payload: { progress, sampled: rawRows.length },
      } satisfies ProgressMessage)

      if (rawRows.length >= sampleLimit) parser.abort()
    },
    complete: () => {
      const dataStartRow = detectDataStartRow(rawRows)
      const columns = buildColumns(rawRows, dataStartRow)
      const dataRows = rawRows.slice(dataStartRow)
      self.postMessage({
        type: 'complete',
        payload: {
          delimiter,
          rowCountSampled: dataRows.length,
          dataStartRow,
          sampleRows: normalizeRows(dataRows, columns),
          columns,
        },
      } satisfies CompleteMessage)
    },
    error: (error: Error) => {
      self.postMessage({ type: 'error', payload: { message: error.message } } satisfies ErrorMessage)
    },
  })
}

export {}
