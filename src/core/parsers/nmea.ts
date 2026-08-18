// NMEA 0183 parser — the lingua franca of raw GPS receiver logs (.nmea / .gps).
// Supports GGA (fix + altitude + HDOP + sats), RMC (date + time + speed +
// heading), and GLL (position). Time is reconstructed by pairing RMC dates with
// GGA/RMC times across the stream.
import type { ParseResult, TrackPoint } from '../model'

const KNOTS_TO_MPS = 0.514444

export function parseNmea(text: string): ParseResult {
  const warnings: string[] = []
  const channelSet = new Set<string>()
  const points: TrackPoint[] = []

  let lastDate: { y: number; m: number; d: number } | null = null
  let badChecksums = 0
  let lineNo = 0

  for (const rawLine of text.split(/\r?\n/)) {
    lineNo++
    const line = rawLine.trim()
    if (!line.startsWith('$')) continue

    const starIdx = line.indexOf('*')
    const body = starIdx >= 0 ? line.slice(1, starIdx) : line.slice(1)
    if (starIdx >= 0) {
      const expected = line.slice(starIdx + 1).trim().slice(0, 2)
      if (expected.length === 2 && !checksumOk(body, expected)) {
        badChecksums++
        continue
      }
    }

    const fields = body.split(',')
    const type = fields[0]!.slice(2) // strip talker id (GP, GN, GL, ...)

    if (type === 'RMC') {
      const time = nmeaTime(fields[1])
      const lat = nmeaCoord(fields[3], fields[4])
      const lon = nmeaCoord(fields[5], fields[6])
      lastDate = nmeaDate(fields[9]) ?? lastDate
      if (lat !== null && lon !== null) {
        const point: TrackPoint = { lat, lon }
        const ms = combineDateTime(lastDate, time)
        if (ms !== null) point.time = ms
        const speed = num(fields[7])
        const heading = num(fields[8])
        const ext: Record<string, number> = {}
        if (speed !== null) {
          ext['speed_mps'] = speed * KNOTS_TO_MPS
          channelSet.add('speed_mps')
        }
        if (heading !== null) {
          ext['heading_deg'] = heading
          channelSet.add('heading_deg')
        }
        if (Object.keys(ext).length) point.ext = ext
        points.push(point)
      }
    } else if (type === 'GGA') {
      const time = nmeaTime(fields[1])
      const lat = nmeaCoord(fields[2], fields[3])
      const lon = nmeaCoord(fields[4], fields[5])
      if (lat !== null && lon !== null) {
        const point: TrackPoint = { lat, lon }
        const alt = num(fields[9])
        if (alt !== null) point.ele = alt
        const ms = combineDateTime(lastDate, time)
        if (ms !== null) point.time = ms
        const ext: Record<string, number> = {}
        const sats = num(fields[7])
        const hdop = num(fields[8])
        const fix = num(fields[6])
        if (sats !== null) { ext['sat'] = sats; channelSet.add('sat') }
        if (hdop !== null) { ext['hdop'] = hdop; channelSet.add('hdop') }
        if (fix !== null) { ext['fix_quality'] = fix; channelSet.add('fix_quality') }
        if (Object.keys(ext).length) point.ext = ext
        points.push(point)
      }
    } else if (type === 'GLL') {
      const lat = nmeaCoord(fields[1], fields[2])
      const lon = nmeaCoord(fields[3], fields[4])
      if (lat !== null && lon !== null) {
        const point: TrackPoint = { lat, lon }
        const ms = combineDateTime(lastDate, nmeaTime(fields[5]))
        if (ms !== null) point.time = ms
        points.push(point)
      }
    }
  }

  if (badChecksums > 0) {
    warnings.push(`${badChecksums} NMEA sentences dropped due to bad checksums.`)
  }
  if (points.length === 0) {
    warnings.push('No GGA/RMC/GLL position sentences decoded.')
  }
  void lineNo

  return { points, warnings, channels: Array.from(channelSet) }
}

function checksumOk(body: string, expectedHex: string): boolean {
  let cs = 0
  for (let i = 0; i < body.length; i++) cs ^= body.charCodeAt(i)
  return cs === parseInt(expectedHex, 16)
}

function num(value: string | undefined): number | null {
  if (!value) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// NMEA latitude/longitude are ddmm.mmmm / dddmm.mmmm with a hemisphere letter.
function nmeaCoord(value: string | undefined, hemi: string | undefined): number | null {
  if (!value) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const deg = Math.floor(n / 100)
  const min = n - deg * 100
  let decimal = deg + min / 60
  if (hemi === 'S' || hemi === 'W') decimal = -decimal
  return decimal
}

function nmeaTime(value: string | undefined): { h: number; m: number; s: number } | null {
  if (!value || value.length < 6) return null
  const h = Number(value.slice(0, 2))
  const m = Number(value.slice(2, 4))
  const s = Number(value.slice(4))
  if (![h, m, s].every(Number.isFinite)) return null
  return { h, m, s }
}

function nmeaDate(value: string | undefined): { y: number; m: number; d: number } | null {
  if (!value || value.length < 6) return null
  const d = Number(value.slice(0, 2))
  const m = Number(value.slice(2, 4))
  const yy = Number(value.slice(4, 6))
  if (![d, m, yy].every(Number.isFinite)) return null
  return { y: 2000 + yy, m, d }
}

function combineDateTime(
  date: { y: number; m: number; d: number } | null,
  time: { h: number; m: number; s: number } | null,
): number | null {
  if (!time) return null
  if (!date) return null
  return Date.UTC(date.y, date.m - 1, date.d, time.h, time.m, Math.floor(time.s), (time.s % 1) * 1000)
}
