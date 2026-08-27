// Bounded, explainable CSV header-row inference. Answers a single question —
// "does physical row 1 of this file look like a header row?" — from only the
// first HEADER_PREVIEW_ROW_LIMIT physical rows, and never silently commits
// to an answer: callers get `inferred` plus a `confidence` and human-readable
// `reasons` so the UI can present a preview and let the user override rather
// than trust a guess as fact.
//
// This module also hosts the lower-level header-BLOCK sizing heuristic
// (`detectDataStartRow`) used by `csvAnalysis.ts`'s full column analysis, so
// the numeric-ratio primitives that answer "is this row header-like?" have a
// single implementation shared by both the quick preview and the full
// analyzer, instead of two divergent copies.
import Papa from 'papaparse'
import { parseRangeTimeToEpochMs } from '../format'

/** Multi-row header BLOCK detection (csvAnalysis.analyzeRawRows) never looks
 *  past this many leading rows when sizing the header block. */
export const MAX_HEADER_ROWS = 5

/** inferHeaderRow never reads more than this many physical rows, regardless
 *  of file size — it is a cheap preview signal, not a full analysis. */
export const HEADER_PREVIEW_ROW_LIMIT = 20

export type HeaderInferenceConfidence = 'high' | 'medium' | 'low' | 'ambiguous'

export interface HeaderInferenceResult {
  /** Best-effort guess: true if row 0 looks like a header row. */
  inferred: boolean
  /** How much to trust `inferred`. 'ambiguous' means: don't auto-apply, ask. */
  confidence: HeaderInferenceConfidence
  /** Human-readable evidence, in the order it was gathered. */
  reasons: string[]
}

/** Lenient numeric test used for header/data discrimination and stats.
 *  Intentionally simpler than format.parseNumber (no DMS) so header words
 *  never read as numbers. */
export function parseNumber(value: string | undefined): number | null {
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

/** Best-effort date/timestamp parse (calendar strings, epoch seconds/ms,
 *  Excel serial dates, IRIG/range time). Returns epoch ms, or null if nothing
 *  plausible. */
export function parseDateLike(value: string): number | null {
  const direct = new Date(value)
  if (!Number.isNaN(direct.valueOf())) {
    return direct.valueOf()
  }

  // `DDD:HH:MM:SS.fff` and bare `HH:MM:SS.fff`. Date.parse rejects every
  // colon-delimited form outright, so this only ever adds matches — a column of
  // range time used to score zero here and never be typed as a datetime.
  const rangeTime = parseRangeTimeToEpochMs(value)
  if (rangeTime !== null) {
    return rangeTime
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

function rowNumericRatio(row: string[]): number | null {
  const nonEmpty = row.filter((cell) => cell.trim().length > 0)
  if (nonEmpty.length === 0) return null
  return nonEmpty.filter((cell) => parseNumber(cell) !== null).length / nonEmpty.length
}

/** Numericness typical of this file's data rows, sampled well clear of any
 *  plausible header block. Null when the file is too short to judge. */
function dataNumericBaseline(rawRows: string[][]): number | null {
  const start = MAX_HEADER_ROWS
  const ratios: number[] = []
  for (let i = start; i < Math.min(rawRows.length, start + 50); i++) {
    const r = rowNumericRatio(rawRows[i]!)
    if (r !== null) ratios.push(r)
  }
  if (ratios.length < 3) return null
  ratios.sort((a, b) => a - b)
  return ratios[Math.floor(ratios.length / 2)]!
}

/** Walk up to MAX_HEADER_ROWS leading rows; count how many look like headers.
 *
 *  Row 0 only needs to be mostly non-numeric (mirrors the classic
 *  one-header-row assumption; returns 0 for headerless all-numeric files).
 *  Rows 1+ must ALSO be markedly less numeric than the file's data baseline,
 *  so text-heavy datasets (names, remarks) don't get leading data rows
 *  swallowed as extra header rows. */
export function detectDataStartRow(rawRows: string[][]): number {
  const limit = Math.min(MAX_HEADER_ROWS, rawRows.length)
  const baseline = dataNumericBaseline(rawRows)
  let count = 0
  for (let i = 0; i < limit; i++) {
    const ratio = rowNumericRatio(rawRows[i]!)
    if (ratio === null || ratio >= 0.5) break // blank or data-like: header block ends
    if (i > 0 && baseline !== null && baseline - ratio < 0.3) break
    count++
  }
  return count
}

function baselineWithinSample(sample: string[][]): number | null {
  // dataNumericBaseline looks at rows [MAX_HEADER_ROWS, MAX_HEADER_ROWS+50),
  // which — since `sample` is already capped at HEADER_PREVIEW_ROW_LIMIT — is
  // naturally bounded to the preview window with no extra work.
  return dataNumericBaseline(sample)
}

/**
 * Infer whether physical row 1 (index 0) of `rows` is a header row, sampling
 * only the first HEADER_PREVIEW_ROW_LIMIT physical rows. Pure and
 * deterministic: same input always yields the same verdict, and low-signal
 * input yields 'ambiguous' rather than a forced guess.
 */
export function inferHeaderRowFromRows(rows: string[][]): HeaderInferenceResult {
  const sample = rows.slice(0, HEADER_PREVIEW_ROW_LIMIT)
  const reasons: string[] = []

  if (sample.length === 0) {
    return { inferred: false, confidence: 'ambiguous', reasons: ['No rows available to sample.'] }
  }

  const firstRow = sample[0]!
  const trimmedCells = firstRow.map((cell) => (cell ?? '').trim())
  const nonEmptyCells = trimmedCells.filter((cell) => cell.length > 0)

  if (nonEmptyCells.length === 0) {
    return { inferred: false, confidence: 'ambiguous', reasons: ['First row is blank.'] }
  }

  let inferred = detectDataStartRow(sample) > 0

  const firstRowRatio = rowNumericRatio(firstRow)
  if (firstRowRatio === null) {
    reasons.push('First row has no non-empty cells to evaluate numerically.')
  } else if (firstRowRatio < 0.2) {
    reasons.push('First row is predominantly non-numeric text, typical of column labels.')
  } else if (firstRowRatio >= 0.5) {
    reasons.push('First row is predominantly numeric, typical of a data row rather than a header.')
  } else {
    reasons.push('First row has a mixed numeric/text composition.')
  }

  const blanks = trimmedCells.length - nonEmptyCells.length
  if (blanks > 0) {
    reasons.push(`${blanks} blank cell(s) in the first row.`)
  }

  const seen = new Set<string>()
  let duplicates = 0
  for (const cell of nonEmptyCells) {
    const key = cell.toLowerCase()
    if (seen.has(key)) duplicates++
    seen.add(key)
  }
  if (duplicates > 0) {
    reasons.push(`${duplicates} duplicate value(s) among first-row cells.`)
  }

  // Dates and in-range coordinate numbers are effectively never literal
  // header labels. detectDataStartRow only reasons about numeric ratios, so
  // an all-text-looking-but-actually-ISO-date first row (dates fail the
  // lenient numeric test) can otherwise be mistaken for a header block —
  // these checks catch that and override the verdict with a strong signal.
  const dateLikeCells = nonEmptyCells.filter((cell) => parseDateLike(cell) !== null && parseNumber(cell) === null)
  const majority = Math.max(2, Math.ceil(nonEmptyCells.length * 0.5))
  let overridden = false
  if (dateLikeCells.length >= majority) {
    reasons.push(`${dateLikeCells.length} cell(s) in the first row parse as dates/timestamps, unusual for header labels.`)
    inferred = false
    overridden = true
  } else if (dateLikeCells.length > 0) {
    reasons.push(`${dateLikeCells.length} cell(s) in the first row parse as dates/timestamps, unusual for header labels.`)
  }

  const coordLikeCount = nonEmptyCells.filter((cell) => {
    const n = parseNumber(cell)
    return n !== null && Math.abs(n) <= 180
  }).length
  if (coordLikeCount >= majority) {
    reasons.push('Multiple first-row cells parse as plausible coordinate values.')
    inferred = false
    overridden = true
  }

  const baseline = baselineWithinSample(sample)
  let confidence: HeaderInferenceConfidence

  if (overridden) {
    confidence = 'high'
  } else if (baseline === null) {
    reasons.push('Not enough sampled rows to establish a numeric baseline for the data rows.')
    confidence = 'ambiguous'
  } else if (firstRowRatio === null) {
    confidence = 'ambiguous'
  } else {
    const gap = baseline - firstRowRatio
    reasons.push(
      `Numeric-ratio gap between first row (${firstRowRatio.toFixed(2)}) and sampled data baseline (${baseline.toFixed(2)}) is ${gap.toFixed(2)}.`,
    )
    if (gap >= 0.5) {
      confidence = 'high'
    } else if (gap >= 0.3) {
      confidence = 'medium'
    } else if (gap > 0.05) {
      confidence = 'low'
    } else {
      // No meaningful gap either way (e.g. an all-numeric headerless file,
      // or too few sampled data rows to tell headers from data). Duplicate
      // or blank first-row cells nudge toward reporting a header despite
      // low separation, but the verdict itself stays unforced.
      confidence = duplicates > 0 || blanks > 0 ? 'low' : 'ambiguous'
    }
  }

  return { inferred, confidence, reasons }
}

/**
 * Parse raw CSV/TSV text (quoted commas/newlines honored) and infer whether
 * physical row 1 is a header row. Reads at most HEADER_PREVIEW_ROW_LIMIT
 * physical rows via Papa Parse's `preview` option — the rest of the file is
 * never touched.
 *
 * @param delimiter Explicit delimiter (',', '\t', ';', ...). Omit to let
 *   Papa Parse auto-detect from the sampled rows.
 */
export function inferHeaderRow(csvText: string, delimiter?: string): HeaderInferenceResult {
  const parsed = Papa.parse<string[]>(csvText, {
    delimiter: delimiter || undefined,
    skipEmptyLines: 'greedy',
    preview: HEADER_PREVIEW_ROW_LIMIT,
  })
  return inferHeaderRowFromRows(parsed.data)
}
