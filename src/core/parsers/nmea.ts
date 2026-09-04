// NMEA 0183 parser — the lingua franca of raw GPS receiver logs (.nmea / .gps).
// Supports GGA (fix + altitude + HDOP + sats), RMC (date + time + speed +
// heading), GLL (position), VTG (course + speed over ground), ZDA
// (date + time), GSA (DOP + active satellites), and GSV (satellites in
// view). Time is reconstructed by pairing RMC/ZDA dates with GGA/RMC/ZDA
// times across the stream. VTG, ZDA, GSA, and GSV never carry a position of
// their own — each rides along on the next GGA/GLL fix that doesn't already
// have an equivalent field of its own (a receiver emitting GGA+VTG with no
// RMC would otherwise report positions with no speed/heading channel at
// all). RMC's speed/heading is NOT propagated onto later GGA/GLL fixes:
// RMC already emits its own point, and a GGA fix inheriting a different
// sentence's speed at a different timestamp would misattribute a
// measurement it never took — only VTG (which never produces a point of
// its own) rides along. ZDA's date is a more precise, unambiguous
// 4-digit-year alternative to RMC's — both feed the same `lastDate` used to
// pair a GGA/GLL fix's time-of-day with a calendar date. GSA's HDOP only
// fills in when a fix's own HDOP field (GGA) is blank — the fix's own
// reading always wins; PDOP/VDOP have no GGA equivalent so are pure
// additions. GSV's "satellites in view" is a distinct count from GGA's
// "satellites used in the fix solution" and is stored under a different
// channel key (`sat_in_view`, not `sat`) so it can never silently overwrite
// or be mistaken for the value the GPS fix-quality check reads.
import type { ParseResult, TrackPoint } from '../model'

const KNOTS_TO_MPS = 0.514444

export function parseNmea(text: string): ParseResult {
  const warnings: string[] = []
  const channelSet = new Set<string>()
  const points: TrackPoint[] = []

  let lastDate: { y: number; m: number; d: number } | null = null
  /** Set only by VTG — see the header comment for why RMC does not feed this. */
  let lastVtg: { headingDeg: number; speedMps: number } | null = null
  let lastGsa: { pdop: number | null; hdop: number | null; vdop: number | null } | null = null
  let lastSatellitesInView: number | null = null
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
      const speed = num(fields[7])
      const heading = num(fields[8])
      if (lat !== null && lon !== null) {
        const point: TrackPoint = { lat, lon }
        const ms = combineDateTime(lastDate, time)
        if (ms !== null) point.time = ms
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
        // The fix's own HDOP always wins; GSA only fills a gap GGA left blank.
        const effectiveHdop = hdop !== null ? hdop : lastGsa?.hdop ?? null
        if (effectiveHdop !== null) { ext['hdop'] = effectiveHdop; channelSet.add('hdop') }
        if (fix !== null) { ext['fix_quality'] = fix; channelSet.add('fix_quality') }
        // GGA carries no course/speed of its own; a receiver logging GGA+VTG
        // (no RMC) still gets one, from the most recent VTG sentence.
        if (lastVtg) {
          ext['speed_mps'] = lastVtg.speedMps
          ext['heading_deg'] = lastVtg.headingDeg
          channelSet.add('speed_mps')
          channelSet.add('heading_deg')
        }
        addGsaGsvFields(ext, channelSet, lastGsa, lastSatellitesInView)
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
        const ext: Record<string, number> = {}
        if (lastVtg) {
          ext['speed_mps'] = lastVtg.speedMps
          ext['heading_deg'] = lastVtg.headingDeg
          channelSet.add('speed_mps')
          channelSet.add('heading_deg')
        }
        addGsaGsvFields(ext, channelSet, lastGsa, lastSatellitesInView)
        if (Object.keys(ext).length) point.ext = ext
        points.push(point)
      }
    } else if (type === 'VTG') {
      const heading = num(fields[1])
      const speedKnots = num(fields[5])
      if (heading !== null && speedKnots !== null) lastVtg = { headingDeg: heading, speedMps: speedKnots * KNOTS_TO_MPS }
    } else if (type === 'ZDA') {
      lastDate = nmeaDateParts(fields[2], fields[3], fields[4]) ?? lastDate
    } else if (type === 'GSA') {
      const pdop = positiveNum(fields[15])
      const hdop = positiveNum(fields[16])
      const vdop = positiveNum(fields[17])
      if (pdop !== null || hdop !== null || vdop !== null) lastGsa = { pdop, hdop, vdop }
    } else if (type === 'GSV') {
      const inView = nonNegativeInt(fields[3])
      if (inView !== null) lastSatellitesInView = inView
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

/** DOP values are never zero or negative in practice; guards against a malformed field
 *  entering `ext` as a plausible-looking but meaningless reading. */
function positiveNum(value: string | undefined): number | null {
  const n = num(value)
  return n !== null && n > 0 ? n : null
}

function nonNegativeInt(value: string | undefined): number | null {
  const n = num(value)
  return n !== null && n >= 0 && Number.isInteger(n) ? n : null
}

/** GSA (PDOP/HDOP/VDOP) and GSV (satellites in view) never carry a position of their own;
 *  both ride along on the next GGA/GLL fix the same way VTG does. GSA's HDOP is applied by
 *  the caller (only as a fallback when the fix's own HDOP is blank) — this only adds the
 *  fields with no GGA/GLL equivalent, so there is nothing here for a fix's own reading to
 *  ever be overwritten by. */
function addGsaGsvFields(
  ext: Record<string, number>,
  channelSet: Set<string>,
  gsa: { pdop: number | null; hdop: number | null; vdop: number | null } | null,
  satellitesInView: number | null,
): void {
  if (gsa?.pdop !== null && gsa?.pdop !== undefined) { ext['pdop'] = gsa.pdop; channelSet.add('pdop') }
  if (gsa?.vdop !== null && gsa?.vdop !== undefined) { ext['vdop'] = gsa.vdop; channelSet.add('vdop') }
  if (satellitesInView !== null) { ext['sat_in_view'] = satellitesInView; channelSet.add('sat_in_view') }
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

/** Rejects fields a receiver could emit as garbage (blank, zero, out-of-range) rather than
 *  let them silently produce a nonsense Date that then times every subsequent fix. */
function isPlausibleDate(y: number, m: number, d: number): boolean {
  return y >= 1980 && m >= 1 && m <= 12 && d >= 1 && d <= 31
}

function nmeaDate(value: string | undefined): { y: number; m: number; d: number } | null {
  if (!value || value.length < 6) return null
  const d = Number(value.slice(0, 2))
  const m = Number(value.slice(2, 4))
  const yy = Number(value.slice(4, 6))
  if (![d, m, yy].every(Number.isFinite)) return null
  const y = 2000 + yy
  return isPlausibleDate(y, m, d) ? { y, m, d } : null
}

/** ZDA carries day/month/year as three separate fields with a full 4-digit
 *  year, unlike RMC's single packed 2-digit-year DDMMYY string. */
function nmeaDateParts(day: string | undefined, month: string | undefined, year: string | undefined): { y: number; m: number; d: number } | null {
  const d = num(day)
  const m = num(month)
  const y = num(year)
  if (d === null || m === null || y === null) return null
  return isPlausibleDate(y, m, d) ? { y, m, d } : null
}

function combineDateTime(
  date: { y: number; m: number; d: number } | null,
  time: { h: number; m: number; s: number } | null,
): number | null {
  if (!time) return null
  if (!date) return null
  return Date.UTC(date.y, date.m - 1, date.d, time.h, time.m, Math.floor(time.s), (time.s % 1) * 1000)
}
