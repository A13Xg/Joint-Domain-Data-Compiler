// EAG (European Air Group) TSPI parser — tab-delimited ECEF flight telemetry from NATO/European-air-force range instrumentation.
// Coordinates are in ECEF (Earth-Centered-Earth-Fixed) meters, WGS84. Time is reconstructed from the filename-derived date + per-row HH:MM:SS.

import type { ParseResult, TrackPoint } from '../model'
import { isValidLat, isValidLon } from '../model'
import { ecefToGeodetic } from '../geodesy'

export function parseEag(text: string, fileName?: string): ParseResult {
  const warnings: string[] = []
  const channelSet = new Set<string>()
  const points: TrackPoint[] = []
  const meta: Record<string, string> = {}

  const lines = text.split(/\r?\n/)
  if (lines.length < 1) {
    warnings.push('Empty EAG file.')
    return { points, warnings, channels: [], meta }
  }

  // Parse header line (field 0 = platformType, 1 = recordVersion, 2 = exerciseId, 3 = missionId, 4 = eag_field4, 5 = reserved, 6 = platformName)
  const headerFields = lines[0]?.trim().split('\t') ?? []
  if (headerFields.length !== 7) {
    warnings.push(`EAG header has ${headerFields.length} fields; expected 7. Proceeding without header metadata.`)
  } else {
    // Fields 0-6 exist: the branch above rejects any header without exactly 7.
    meta['platformType'] = headerFields[0]!
    meta['recordVersion'] = headerFields[1]!
    meta['exerciseId'] = headerFields[2]!
    meta['missionId'] = headerFields[3]!
    meta['eag_field4'] = headerFields[4]!
    meta['platformName'] = headerFields[6]!
  }

  // Extract mission date from filename (YYYYMMDD or DDMMMYY pattern)
  let missionDate: Date | null = null
  if (fileName) {
    // Try YYYYMMDD first
    const yyyymmdMatch = fileName.match(/(\d{8})/)
    if (yyyymmdMatch) {
      const yyyymmdd = yyyymmdMatch[1]!
      const year = parseInt(yyyymmdd.slice(0, 4), 10)
      const month = parseInt(yyyymmdd.slice(4, 6), 10)
      const day = parseInt(yyyymmdd.slice(6, 8), 10)
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        missionDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
      }
    }

    // Try DDMMMYY if YYYYMMDD didn't work
    if (!missionDate) {
      const ddmmmyyMatch = fileName.match(/(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})/i)
      if (ddmmmyyMatch) {
        const day = parseInt(ddmmmyyMatch[1]!, 10)
        const monthName = ddmmmyyMatch[2]!.toUpperCase()
        const yy = parseInt(ddmmmyyMatch[3]!, 10)
        const monthMap: Record<string, number> = {
          JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
          JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
        }
        const month = monthMap[monthName]
        if (month && day >= 1 && day <= 31) {
          const year = 2000 + yy
          missionDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
        }
      }
    }

    if (!missionDate) {
      warnings.push(`Could not extract a mission date from filename "${fileName}". Times will be absent from imported points.`)
    }
  }

  let skippedWrongFieldCount = 0
  let skippedInvalidEcef = 0
  let skippedHeaderMismatch = 0
  let lastTimeCounterMs = -1
  let dayOffset = 0

  // Parse data rows
  for (let lineNo = 1; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo]?.trim()
    if (!line) continue

    const fields = line.split('\t')
    if (fields.length !== 11) {
      skippedWrongFieldCount++
      continue
    }

    // Cross-check fields 1,2,3 against header (if header was present and valid)
    if (headerFields.length === 7 && (fields[1] !== headerFields[1] || fields[2] !== headerFields[2] || fields[3] !== headerFields[3])) {
      skippedHeaderMismatch++
      continue
    }

    // Parse ECEF coordinates (fields 4, 5, 6)
    const x = Number(fields[4])
    const y = Number(fields[5])
    const z = Number(fields[6])

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      skippedInvalidEcef++
      continue
    }

    // Convert ECEF to geodetic
    const geodetic = ecefToGeodetic({ xM: x, yM: y, zM: z })
    if (!isValidLat(geodetic.latDeg) || !isValidLon(geodetic.lonDeg)) {
      skippedInvalidEcef++
      continue
    }

    // Parse time fields (field 0 = ms counter, field 10 = HH:MM:SS.cc)
    const timeCounterMs = Number(fields[0])
    const hmsStr = fields[10]

    let pointTime: number | undefined
    if (missionDate && hmsStr && Number.isFinite(timeCounterMs)) {
      // Extract HH:MM:SS.cc
      const hmsMatch = hmsStr.match(/(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,2}))?/)
      if (hmsMatch) {
        const h = parseInt(hmsMatch[1]!, 10)
        const m = parseInt(hmsMatch[2]!, 10)
        const s = parseInt(hmsMatch[3]!, 10)
        const cs = parseInt((hmsMatch[4] ?? '0').padEnd(2, '0'), 10) // centiseconds
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59 && s >= 0 && s <= 59) {
          // Detect day rollover: if timeCounterMs went DOWN from previous, we crossed midnight
          if (lastTimeCounterMs >= 0 && timeCounterMs < lastTimeCounterMs) {
            dayOffset++
          }
          lastTimeCounterMs = timeCounterMs

          const utcTime = Date.UTC(
            missionDate.getUTCFullYear(),
            missionDate.getUTCMonth(),
            missionDate.getUTCDate() + dayOffset,
            h, m, s, cs * 10
          )
          pointTime = utcTime
        }
      }
    }

    // Parse attitude/heading fields (7, 8, 9) — field 7 and 8 semantics unconfirmed, keep neutral names
    const point: TrackPoint = { lat: geodetic.latDeg, lon: geodetic.lonDeg }
    if (geodetic.heightM !== undefined) point.ele = geodetic.heightM
    if (pointTime !== undefined) point.time = pointTime

    const ext: Record<string, number> = {}
    const field7 = Number(fields[7])
    const field8 = Number(fields[8])
    const field9 = Number(fields[9])

    if (Number.isFinite(field7)) {
      ext['eag_field7'] = field7
      channelSet.add('eag_field7')
    }
    if (Number.isFinite(field8)) {
      ext['eag_field8'] = field8
      channelSet.add('eag_field8')
    }
    if (Number.isFinite(field9)) {
      ext['heading_deg'] = field9
      channelSet.add('heading_deg')
    }

    if (Object.keys(ext).length > 0) point.ext = ext
    points.push(point)
  }

  // Aggregate warnings
  if (skippedWrongFieldCount > 0) {
    warnings.push(`${skippedWrongFieldCount} EAG rows skipped: wrong field count.`)
  }
  if (skippedInvalidEcef > 0) {
    warnings.push(`${skippedInvalidEcef} EAG rows skipped: invalid or out-of-range ECEF coordinates.`)
  }
  if (skippedHeaderMismatch > 0) {
    warnings.push(`${skippedHeaderMismatch} EAG rows skipped: recordVersion/exerciseId/missionId differing from header.`)
  }
  if (points.length === 0) {
    warnings.push('No valid EAG position data found.')
  }

  return {
    points,
    warnings,
    channels: Array.from(channelSet),
    meta,
    altitudeReference: 'HAE',
    timeReference: 'UTC',
    coordinateSystem: 'EPSG:4326',
  }
}
