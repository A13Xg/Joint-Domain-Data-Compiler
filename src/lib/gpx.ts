import Papa from 'papaparse'
import type {
  CsvToGpxOptions,
  CsvToGpxResult,
  ElevationUnit,
  TimeUnit,
} from '../types/converter'

type CsvRow = Record<string, string | undefined>

interface PointBuildResult {
  xml: string | null
  missingCoordinates: boolean
  outOfRangeCoordinates: boolean
  hasElevation: boolean
  hasTimestamp: boolean
}

function escapeXml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
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

function convertElevation(value: number, unit: ElevationUnit): number {
  if (unit === 'feet') {
    return value * 0.3048
  }
  return value
}

function parseTime(rawValue: string | undefined, unit: TimeUnit): string | null {
  if (!rawValue) {
    return null
  }

  const value = rawValue.trim()
  if (!value) {
    return null
  }

  if (unit === 'iso') {
    const date = new Date(value)
    return Number.isNaN(date.valueOf()) ? null : date.toISOString()
  }

  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return null
  }

  if (unit === 'epoch_seconds') {
    return new Date(numeric * 1000).toISOString()
  }

  if (unit === 'epoch_milliseconds') {
    return new Date(numeric).toISOString()
  }

  const excelDate = new Date((numeric - 25569) * 86400 * 1000)
  return Number.isNaN(excelDate.valueOf()) ? null : excelDate.toISOString()
}

function buildTrackPoint(row: CsvRow, options: CsvToGpxOptions): PointBuildResult {
  const latitude = parseNumber(row[options.mapping.latitude])
  const longitude = parseNumber(row[options.mapping.longitude])

  if (latitude === null || longitude === null) {
    return {
      xml: null,
      missingCoordinates: true,
      outOfRangeCoordinates: false,
      hasElevation: false,
      hasTimestamp: false,
    }
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return {
      xml: null,
      missingCoordinates: false,
      outOfRangeCoordinates: true,
      hasElevation: false,
      hasTimestamp: false,
    }
  }

  const pointParts: string[] = [
    `<trkpt lat="${latitude.toFixed(8)}" lon="${longitude.toFixed(8)}">`,
  ]

  let hasElevation = false
  if (options.mapping.elevation) {
    const elevation = parseNumber(row[options.mapping.elevation])
    if (elevation !== null) {
      pointParts.push(
        `<ele>${convertElevation(elevation, options.mapping.elevationUnit).toFixed(3)}</ele>`,
      )
      hasElevation = true
    }
  }

  let hasTimestamp = false
  if (options.mapping.timestamp) {
    const timeString = parseTime(row[options.mapping.timestamp], options.mapping.timeUnit)
    if (timeString) {
      pointParts.push(`<time>${escapeXml(timeString)}</time>`)
      hasTimestamp = true
    }
  }

  if (options.mapping.name && row[options.mapping.name]) {
    pointParts.push(`<name>${escapeXml(row[options.mapping.name] ?? '')}</name>`)
  }

  if (options.mapping.description && row[options.mapping.description]) {
    pointParts.push(`<cmt>${escapeXml(row[options.mapping.description] ?? '')}</cmt>`)
  }

  pointParts.push('</trkpt>')
  return {
    xml: pointParts.join(''),
    missingCoordinates: false,
    outOfRangeCoordinates: false,
    hasElevation,
    hasTimestamp,
  }
}

export function convertCsvToGpx(options: CsvToGpxOptions): Promise<CsvToGpxResult> {
  return new Promise((resolve, reject) => {
    let pointCount = 0
    const pointChunks: string[] = []
    let processedRows = 0
    let skippedMissingCoordinates = 0
    let skippedOutOfRangeCoordinates = 0
    let includedElevation = 0
    let includedTimestamp = 0

    Papa.parse<CsvRow>(options.file, {
      header: true,
      skipEmptyLines: 'greedy',
      delimiter: options.delimiter,
      chunkSize: 1024 * 1024,
      chunk: (result: Papa.ParseResult<CsvRow>) => {
        for (const row of result.data) {
          processedRows += 1
          const point = buildTrackPoint(row, options)
          if (point.missingCoordinates) {
            skippedMissingCoordinates += 1
            continue
          }

          if (point.outOfRangeCoordinates) {
            skippedOutOfRangeCoordinates += 1
            continue
          }

          if (point.xml) {
            pointChunks.push(point.xml)
            pointCount += 1
            if (point.hasElevation) {
              includedElevation += 1
            }
            if (point.hasTimestamp) {
              includedTimestamp += 1
            }
          }
        }

        if (options.onProgress && result.meta.cursor) {
          const progress = Math.min(100, (result.meta.cursor / options.file.size) * 100)
          options.onProgress(progress)
        }
      },
      complete: () => {
        if (pointCount === 0) {
          reject(new Error('No valid GPX points were generated. Verify latitude/longitude mapping and units.'))
          return
        }

        const body = pointChunks.join('')
        const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Joint Domain Data Compiler" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n  <metadata>\n    <name>${escapeXml(options.trackName)}</name>\n  </metadata>\n  <trk>\n    <name>${escapeXml(options.trackName)}</name>\n    <trkseg>${body}</trkseg>\n  </trk>\n</gpx>`

        resolve({
          pointCount,
          blob: new Blob([gpx], { type: 'application/gpx+xml;charset=utf-8' }),
          stats: {
            processedRows,
            skippedMissingCoordinates,
            skippedOutOfRangeCoordinates,
            includedElevation,
            includedTimestamp,
          },
        })
      },
      error: (error: Error) => {
        reject(error)
      },
    })
  })
}
