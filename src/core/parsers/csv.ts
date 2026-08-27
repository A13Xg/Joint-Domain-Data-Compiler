// CSV → TrackPoint mapping. CSV is the one format requiring an explicit
// column→field mapping (resolved interactively in the UI). Any unmapped columns
// are preserved as extension channels so no source data is lost.
import Papa from 'papaparse'
import type { ParseResult, TrackPoint } from '../model'
import {
  convertElevationToMeters,
  parseCoordinate,
  parseNumber,
  parseRangeTimeToEpochMs,
  parseTimeToEpochMs,
  type ElevationUnit,
  type TimeFormat,
} from '../format'
import { FormatBudgetExceededError } from './limits'

export interface CsvMapping {
  latitude: string
  longitude: string
  elevation: string
  timestamp: string
  name: string
  description: string
  elevationUnit: ElevationUnit
  timeFormat: TimeFormat
  /** Columns to preserve as extension channels (defaults to all unmapped). */
  includeChannels?: string[]
}

type CsvRow = Record<string, string | undefined>

function resolveChannelColumns(mapping: CsvMapping, allColumns: string[]): string[] {
  const mappedColumns = new Set(
    [
      mapping.latitude,
      mapping.longitude,
      mapping.elevation,
      mapping.timestamp,
      mapping.name,
      mapping.description,
    ].filter(Boolean),
  )
  return mapping.includeChannels ?? allColumns.filter((c) => !mappedColumns.has(c))
}

interface RowMappingResult {
  point: TrackPoint | null
  badCoord: boolean
  badTime: boolean
  /** Row carried an IRIG/range timestamp, which supplies no year (see rangeTimeWarning). */
  rangeTime: boolean
}

/** Map a single already-split CSV row into a TrackPoint. Pure and allocation-light
 * so it can run either over a fully materialized row array or one row at a time
 * as rows stream in (see streamCsvFileToPoints). */
function mapCsvRow(row: CsvRow, mapping: CsvMapping, channelColumns: string[], channelSet: Set<string>): RowMappingResult {
  const lat = parseCoordinate(row[mapping.latitude])
  const lon = parseCoordinate(row[mapping.longitude])
  if (lat === null || lon === null) {
    return { point: null, badCoord: true, badTime: false, rangeTime: false }
  }
  const point: TrackPoint = { lat, lon }
  let badTime = false
  let rangeTime = false

  if (mapping.elevation) {
    const ele = parseNumber(row[mapping.elevation])
    if (ele !== null) point.ele = convertElevationToMeters(ele, mapping.elevationUnit)
  }
  if (mapping.timestamp) {
    const raw = row[mapping.timestamp]
    const ms = parseTimeToEpochMs(raw, mapping.timeFormat)
    if (ms !== null) {
      point.time = ms
      // Range time carries no year, so the import anchors it to the current one.
      // Recorded here rather than inferred from mapping.timeFormat so the 'auto'
      // path, which is how these files actually arrive, is covered too.
      if (typeof raw === 'string' && parseRangeTimeToEpochMs(raw) !== null) rangeTime = true
    } else if (raw?.trim()) {
      badTime = true
    }
  }
  if (mapping.name && row[mapping.name]) point.name = row[mapping.name]
  if (mapping.description && row[mapping.description]) point.desc = row[mapping.description]

  const ext: Record<string, number | string> = {}
  for (const col of channelColumns) {
    const raw = row[col]
    if (raw === undefined || raw === '') continue
    const num = parseNumber(raw)
    ext[col] = num ?? raw
    channelSet.add(col)
  }
  if (Object.keys(ext).length > 0) point.ext = ext

  return { point, badCoord: false, badTime, rangeTime }
}

/**
 * IRIG/range timestamps (`DDD:HH:MM:SS`) name a day and a time but never a year,
 * so the import anchors them to the current UTC year. Inter-sample deltas — what
 * every downstream analytic actually consumes — are exact either way, but the
 * absolute date reaches GPX/KML exports, so the assumption is stated rather than
 * left for someone to discover in an exported file.
 */
function rangeTimeWarning(rows: number): string {
  return `${rows} row(s) used IRIG/range timestamps (DDD:HH:MM:SS), which carry no year. `
    + `Dates were anchored to ${new Date().getUTCFullYear()}; relative timing is unaffected.`
}

export function buildPointsFromCsvRows(
  rows: CsvRow[],
  mapping: CsvMapping,
  allColumns: string[],
): ParseResult {
  const channelSet = new Set<string>()
  const channelColumns = resolveChannelColumns(mapping, allColumns)
  const points: TrackPoint[] = []
  let badCoords = 0
  let badTimes = 0
  let rangeTimes = 0

  for (const row of rows) {
    const result = mapCsvRow(row, mapping, channelColumns, channelSet)
    if (result.point) points.push(result.point)
    if (result.badCoord) badCoords++
    if (result.badTime) badTimes++
    if (result.rangeTime) rangeTimes++
  }

  const warnings: string[] = []
  if (badCoords > 0) warnings.push(`${badCoords} rows skipped (unparseable latitude/longitude).`)
  if (badTimes > 0) warnings.push(`${badTimes} rows had timestamps that could not be parsed.`)
  if (rangeTimes > 0) warnings.push(rangeTimeWarning(rangeTimes))

  return { points, warnings, channels: Array.from(channelSet) }
}

export class CsvImportCancelledError extends Error {
  constructor() {
    super('CSV import cancelled.')
    this.name = 'CsvImportCancelledError'
  }
}

export interface StreamCsvOptions {
  onProgress?: (fraction: number) => void
  /** Polled once per chunk; returning true aborts the parse cleanly. */
  isCancelled?: () => boolean
  /** Checked once per chunk against the running point count; throws when exceeded. */
  maxPoints?: number
}

/**
 * Stream a CSV File directly into TrackPoints, one Papa.parse chunk at a
 * time. Unlike the former two-pass parseCsvFile + buildPointsFromCsvRows
 * flow, this never materializes a full array of raw row objects alongside
 * the full array of points — only the point array (the representation the
 * rest of the app needs) grows for the lifetime of the import.
 */
export function streamCsvFileToPoints(
  file: File,
  delimiter: string | undefined,
  columnNames: string[],
  dataStartRow: number,
  mapping: CsvMapping,
  options: StreamCsvOptions = {},
): Promise<ParseResult> {
  const { onProgress, isCancelled, maxPoints } = options
  const channelSet = new Set<string>()
  const channelColumns = resolveChannelColumns(mapping, columnNames)

  return new Promise((resolve, reject) => {
    const points: TrackPoint[] = []
    let rawRowsSeen = 0
    let badCoords = 0
    let badTimes = 0
    let rangeTimes = 0

    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: 'greedy',
      delimiter: delimiter || undefined,
      chunkSize: 1024 * 1024,
      chunk: (result: Papa.ParseResult<string[]>, parser: { abort: () => void }) => {
        for (const raw of result.data) {
          if (rawRowsSeen < dataStartRow) {
            rawRowsSeen++
            continue
          }
          rawRowsSeen++
          const row: CsvRow = {}
          for (let i = 0; i < columnNames.length; i++) {
            row[columnNames[i]!] = raw[i] ?? ''
          }
          const mapped = mapCsvRow(row, mapping, channelColumns, channelSet)
          if (mapped.point) points.push(mapped.point)
          if (mapped.badCoord) badCoords++
          if (mapped.badTime) badTimes++
          if (mapped.rangeTime) rangeTimes++
        }

        // Reject before calling parser.abort(): abort() synchronously invokes
        // the `complete` callback below, which would resolve the promise
        // first if the ordering were reversed (a promise's first settlement
        // wins, so the resolve would silently swallow this rejection).
        if (maxPoints !== undefined && points.length > maxPoints) {
          reject(new FormatBudgetExceededError(
            `CSV source produced over ${maxPoints.toLocaleString()} points, over the import limit for this format. Split the file or decimate before import.`,
          ))
          parser.abort()
          return
        }
        if (isCancelled?.()) {
          reject(new CsvImportCancelledError())
          parser.abort()
          return
        }
        if (onProgress && result.meta.cursor && file.size) {
          onProgress(Math.min(1, result.meta.cursor / file.size))
        }
      },
      complete: () => {
        const warnings: string[] = []
        if (badCoords > 0) warnings.push(`${badCoords} rows skipped (unparseable latitude/longitude).`)
        if (badTimes > 0) warnings.push(`${badTimes} rows had timestamps that could not be parsed.`)
        if (rangeTimes > 0) warnings.push(rangeTimeWarning(rangeTimes))
        resolve({ points, warnings, channels: Array.from(channelSet) })
      },
      error: (err: Error) => reject(err),
    })
  })
}
