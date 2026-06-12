// CSV → TrackPoint mapping. CSV is the one format requiring an explicit
// column→field mapping (resolved interactively in the UI). Any unmapped columns
// are preserved as extension channels so no source data is lost.
import Papa from 'papaparse'
import type { ParseResult, TrackPoint } from '../model'
import {
  convertElevationToMeters,
  parseCoordinate,
  parseNumber,
  parseTimeToEpochMs,
  type ElevationUnit,
  type TimeFormat,
} from '../format'

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

export function buildPointsFromCsvRows(
  rows: CsvRow[],
  mapping: CsvMapping,
  allColumns: string[],
): ParseResult {
  const warnings: string[] = []
  const points: TrackPoint[] = []
  const channelSet = new Set<string>()

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
  const channelColumns =
    mapping.includeChannels ?? allColumns.filter((c) => !mappedColumns.has(c))

  let badCoords = 0
  let badTimes = 0

  for (const row of rows) {
    const lat = parseCoordinate(row[mapping.latitude])
    const lon = parseCoordinate(row[mapping.longitude])
    if (lat === null || lon === null) {
      badCoords++
      continue
    }
    const point: TrackPoint = { lat, lon }

    if (mapping.elevation) {
      const ele = parseNumber(row[mapping.elevation])
      if (ele !== null) point.ele = convertElevationToMeters(ele, mapping.elevationUnit)
    }
    if (mapping.timestamp) {
      const ms = parseTimeToEpochMs(row[mapping.timestamp], mapping.timeFormat)
      if (ms !== null) point.time = ms
      else if (row[mapping.timestamp]?.trim()) badTimes++
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

    points.push(point)
  }

  if (badCoords > 0) warnings.push(`${badCoords} rows skipped (unparseable latitude/longitude).`)
  if (badTimes > 0) warnings.push(`${badTimes} rows had timestamps that could not be parsed.`)

  return { points, warnings, channels: Array.from(channelSet) }
}

/** Fully parse a CSV File into rows (used at export time, off the sample). */
export function parseCsvFile(
  file: File,
  delimiter: string | undefined,
  onProgress?: (fraction: number) => void,
): Promise<{ rows: CsvRow[]; columns: string[] }> {
  return new Promise((resolve, reject) => {
    const rows: CsvRow[] = []
    let columns: string[] = []
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      delimiter: delimiter || undefined,
      chunkSize: 1024 * 1024,
      chunk: (result: Papa.ParseResult<CsvRow>) => {
        if (result.meta.fields && columns.length === 0) columns = result.meta.fields
        for (const row of result.data) rows.push(row)
        if (onProgress && result.meta.cursor && file.size) {
          onProgress(Math.min(1, result.meta.cursor / file.size))
        }
      },
      complete: () => resolve({ rows, columns }),
      error: (err: Error) => reject(err),
    })
  })
}
