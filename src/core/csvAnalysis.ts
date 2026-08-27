// Column intelligence for CSV import: header-block detection, per-column type
// estimation, and known-field candidate scoring. Runs on the main thread off a
// raw-row sample streamed back by the analyzer worker, so the mapping UI can
// re-analyze instantly when the user changes header settings — no re-parse.
import {
  KNOWN_FIELDS,
  type ColumnEstimatedType,
  type ColumnStats,
  type CsvAnalysisResult,
  type CsvSampleRow,
  type DetectedColumn,
  type KnownField,
} from '../types/converter'
import { parseRangeTimeToEpochMs } from './format'
import {
  detectDataStartRow,
  inferHeaderRowFromRows,
  MAX_HEADER_ROWS,
  parseDateLike,
  parseNumber,
} from './parsers/csvPreview'

// Header-row-count detection (detectDataStartRow) and its numeric-ratio
// primitives (parseNumber, parseDateLike, MAX_HEADER_ROWS) now live in
// ./parsers/csvPreview.ts, which also exposes the plan-specified bounded
// `inferHeaderRow`/`inferHeaderRowFromRows` preview API. Re-exported here so
// existing call sites that import them from csvAnalysis keep working.
export { detectDataStartRow, MAX_HEADER_ROWS }

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

  if (values.some((value) => /^(?:\d{1,3}:)?\d{1,2}:\d{1,2}:\d{1,2}(?:[.,]\d+)?$/.test(value))) {
    patterns.add('value:range_time_candidate')
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

  if (
    stats.datetimeRatio >= 0.7
    || patterns.includes('value:iso_datetime_candidate')
    || patterns.includes('value:range_time_candidate')
  ) {
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
      // Colon-delimited range time is neither numeric nor Date.parse-able, so
      // without this an IRIG-stamped column scored 0 here and carried only its
      // header match (0.455) — under the 0.8 a candidate needs to set the
      // column's type, which is why TIME never auto-mapped to the timestamp.
      if (parseRangeTimeToEpochMs(value) !== null) {
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

  // Pass 2: dedup provisional names -> final `name`. Suffix with _2, _3, ...
  // and keep probing in case the suffixed name itself collides with a later
  // literal column (e.g. VALUE, VALUE, VALUE_2).
  const taken = new Set(provisional.map((p) => p.provisionalName))
  const seenCount = new Map<string, number>()
  const finalized = provisional.map(({ index, headerCandidates, provisionalName }) => {
    const count = seenCount.get(provisionalName) ?? 0
    seenCount.set(provisionalName, count + 1)
    let name = provisionalName
    if (count > 0) {
      let suffix = count + 1
      do {
        name = `${provisionalName}_${suffix}`
        suffix++
      } while (taken.has(name))
      taken.add(name)
    }
    // headerCandidates[0] must match `name` for sampleRows/mapping lookups.
    const finalHeaderCandidates =
      headerCandidates.length > 0 ? [name, ...headerCandidates.slice(1)] : [name]
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

/**
 * Build a CsvAnalysisResult from a raw-row sample.
 *
 * headerRows:
 *  - 'single' — classic behavior: row 0 is the header, data starts at row 1.
 *  - 'auto'   — detect 0..MAX_HEADER_ROWS leading header rows heuristically.
 *  - number   — explicit user override (clamped to 0..MAX_HEADER_ROWS).
 */
export function analyzeRawRows(
  rawRows: string[][],
  delimiter: string,
  headerRows: 'single' | 'auto' | number,
): CsvAnalysisResult {
  let dataStartRow: number
  if (headerRows === 'single') {
    dataStartRow = Math.min(1, rawRows.length)
  } else if (headerRows === 'auto') {
    dataStartRow = detectDataStartRow(rawRows)
  } else {
    dataStartRow = Math.max(0, Math.min(MAX_HEADER_ROWS, Math.floor(headerRows), rawRows.length))
  }

  const columns = buildColumns(rawRows, dataStartRow)
  const dataRows = rawRows.slice(dataStartRow)

  // Independent, bounded row-1-only signal from csvPreview.ts (the module
  // built specifically to explain "does row 1 look like a header?" with
  // confidence + reasons). Computed alongside the header-BLOCK sizing above
  // rather than replacing it — the two heuristics answer related but
  // distinct questions (block size vs. row-1 verdict) and can disagree.
  const rowOneInference = inferHeaderRowFromRows(rawRows)

  return {
    delimiter,
    rowCountSampled: dataRows.length,
    dataStartRow,
    sampleRows: normalizeRows(dataRows, columns),
    rawPreviewRows: rawRows.slice(0, 20).map((row) => [...row]),
    headerInference: {
      confidence: rawRows.length < 3 ? 'low' : dataStartRow === 0 ? 'medium' : 'high',
      reason: dataStartRow === 0
        ? 'Leading rows look data-like, so no header row was inferred.'
        : `${dataStartRow} leading row${dataStartRow === 1 ? '' : 's'} looked less numeric than the sampled data rows.`,
    },
    rowOneInference,
    columns,
  }
}
