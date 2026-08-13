// EAG (European Air Group) TSPI exporter — writes datasets back to tab-delimited ECEF format.

import type { Dataset } from '../model'
import { isValidLat, isValidLon } from '../model'
import { geodeticToEcef } from '../geodesy'

export interface EagExportOptions {
  platformType?: string // default 'A'
  exerciseId?: string // default '0'
  missionId?: string // default '0'
  eagField4?: string // default '25' (observed constant)
  platformName?: string // default dataset.name
}

export interface EagExportResult {
  text: string
  pointCount: number
  warnings: string[]
}

export function buildEag(dataset: Dataset, options: EagExportOptions = {}): EagExportResult {
  const warnings: string[] = []

  const platformType = options.platformType ?? 'A'
  const exerciseId = options.exerciseId ?? '0'
  const missionId = options.missionId ?? '0'
  const eagField4 = options.eagField4 ?? '25'
  const platformName = options.platformName ?? dataset.name

  // Build header line
  const headerLine = [platformType, '1', exerciseId, missionId, eagField4, '1', platformName].join('\t')

  // Build data rows
  const dataLines: string[] = []
  let skippedInvalid = 0
  let skippedMissing = 0

  for (const point of dataset.points) {
    // Skip points with missing or invalid lat/lon
    if (!isValidLat(point.lat) || !isValidLon(point.lon)) {
      skippedMissing++
      continue
    }

    // Convert geodetic to ECEF
    const ecef = geodeticToEcef({
      latDeg: point.lat,
      lonDeg: point.lon,
      heightM: point.ele ?? 0,
    })

    // Reconstruct field[0] (ms since that point's UTC midnight)
    let timeCounterMs = 0
    if (point.time !== undefined) {
      const d = new Date(point.time)
      const midnightUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)
      timeCounterMs = point.time - midnightUtc
    }

    // Format HH:MM:SS.cc
    const d = new Date(point.time ?? 0)
    const h = String(d.getUTCHours()).padStart(2, '0')
    const m = String(d.getUTCMinutes()).padStart(2, '0')
    const s = String(d.getUTCSeconds()).padStart(2, '0')
    const ms = d.getUTCMilliseconds()
    const cs = String(Math.floor(ms / 10)).padStart(2, '0')
    const hmsStr = `${h}:${m}:${s}.${cs}`

    // Extract attitude/heading fields from ext
    const field7 = point.ext?.['eag_field7'] ?? 0
    const field8 = point.ext?.['eag_field8'] ?? 0
    const field9 = point.ext?.['heading_deg'] ?? 0

    if (!Number.isFinite(field7) || !Number.isFinite(field8) || !Number.isFinite(field9)) {
      skippedInvalid++
      continue
    }

    // Round ECEF to integers
    const x = Math.round(ecef.xM)
    const y = Math.round(ecef.yM)
    const z = Math.round(ecef.zM)

    const dataLine = [
      timeCounterMs,
      '1',
      exerciseId,
      missionId,
      x,
      y,
      z,
      ` ${(field7 as number).toFixed(1)}`,
      `  ${(field8 as number).toFixed(1)}`,
      ` ${(field9 as number).toFixed(1)}`,
      hmsStr,
    ].join('\t')

    dataLines.push(dataLine)
  }

  if (skippedMissing > 0) {
    warnings.push(`${skippedMissing} points skipped (missing coordinates)`)
  }
  if (skippedInvalid > 0) {
    warnings.push(`${skippedInvalid} points skipped (invalid attitude/heading values)`)
  }

  const text = [headerLine, ...dataLines].join('\n') + '\n'
  return {
    text,
    pointCount: dataLines.length,
    warnings,
  }
}
