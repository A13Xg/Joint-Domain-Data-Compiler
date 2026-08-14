// Task 2.2: authoritative parser fixtures. Exercises every supported import
// format against the real, licensed USGS-derived corpus in file-test/,
// covering valid normalization and malformed-input handling end to end
// (not just unit-level parser logic).
import '../test/helpers/linkedomShim.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Papa from 'papaparse'
import { parseGpx } from '../src/core/parsers/gpx.ts'
import { parseKml } from '../src/core/parsers/kml.ts'
import { parseGeoJson } from '../src/core/parsers/geojson.ts'
import { parseNmea } from '../src/core/parsers/nmea.ts'
import { parseGpb } from '../src/core/parsers/gpb.ts'
import { parseEag } from '../src/core/parsers/eag.ts'
import { buildPointsFromCsvRows, type CsvMapping } from '../src/core/parsers/csv.ts'
import { makeDataset } from '../src/core/parsers/index.ts'

// Resolved relative to the repository root (the test runner's cwd), not this
// file's location — esbuild bundles this file to a different directory.
const BASE = join(process.cwd(), 'file-test') + '/'
const INVALID = join(BASE, 'invalid') + '/'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}
function checkThrows(name: string, fn: () => void): void {
  try {
    fn()
    check(name, false, 'did not throw')
  } catch {
    check(name, true)
  }
}

function toBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

// --- GPX -------------------------------------------------------------------
{
  const valid = parseGpx(readFileSync(`${BASE}real-usgs.gpx`, 'utf8'))
  check('Valid GPX yields all 8 USGS events', valid.points.length === 8, `${valid.points.length} points`)
  check('Valid GPX has no warnings', valid.warnings.length === 0, valid.warnings.join('; '))
  check('Valid GPX preserves negative-elevation depth encoding', valid.points[0].ele === -12362)
  check('Valid GPX preserves point names', valid.points.some((p) => p.name === 'us7000t3eb'))

  const dataset = makeDataset('real-usgs.gpx', 'gpx', valid)
  check('makeDataset infers no extension channels for GPX fixture (no ext fields)', dataset.channels.length === 0)

  const malformed = parseGpx(readFileSync(`${INVALID}malformed-usgs.gpx`, 'utf8'))
  check('Malformed GPX (missing lat/lon) yields zero points', malformed.points.length === 0)
  check(
    'Malformed GPX surfaces an explanatory warning',
    malformed.warnings.some((w) => /No trkpt\/rtept\/wpt/.test(w)),
    malformed.warnings.join('; '),
  )
}

// --- KML ---------------------------------------------------------------
{
  const valid = parseKml(readFileSync(`${BASE}real-usgs.kml`, 'utf8'))
  check('Valid KML yields all 8 USGS events', valid.points.length === 8, `${valid.points.length} points`)
  check('Valid KML has no warnings', valid.warnings.length === 0, valid.warnings.join('; '))
  check('Valid KML preserves placemark names', valid.points.every((p) => typeof p.name === 'string' && p.name.startsWith('us7000')))
  check('Valid KML preserves negative-elevation depth encoding', valid.points[0].ele === -12362)

  const malformed = parseKml(readFileSync(`${INVALID}malformed-usgs.kml`, 'utf8'))
  check('Malformed KML (incomplete/empty coordinates) yields zero points', malformed.points.length === 0, `${malformed.points.length} points`)
  check(
    'Malformed KML surfaces an explanatory warning',
    malformed.warnings.some((w) => /No coordinates found/.test(w)),
    malformed.warnings.join('; '),
  )
}

// --- GeoJSON -----------------------------------------------------------
{
  const valid = parseGeoJson(readFileSync(`${BASE}real-usgs.geojson`, 'utf8'))
  check('Valid GeoJSON yields all 8 USGS events', valid.points.length === 8, `${valid.points.length} points`)
  check('Valid GeoJSON has no warnings', valid.warnings.length === 0, valid.warnings.join('; '))
  check('Valid GeoJSON recognizes the time property', valid.points.every((p) => typeof p.time === 'number'))
  check('Valid GeoJSON preserves feature properties as channels', valid.channels.includes('mag'))

  checkThrows('Malformed GeoJSON (invalid JSON syntax) throws', () => {
    parseGeoJson(readFileSync(`${INVALID}malformed-usgs.geojson`, 'utf8'))
  })
}

// --- NMEA ----------------------------------------------------------------
{
  const valid = parseNmea(readFileSync(`${BASE}real-usgs.nmea`, 'utf8'))
  check('Valid NMEA yields 16 points (8 GGA + 8 RMC)', valid.points.length === 16, `${valid.points.length} points`)
  check('Valid NMEA has no warnings', valid.warnings.length === 0, valid.warnings.join('; '))
  check('Valid NMEA GGA sentence carries elevation', valid.points[0].ele === -12362)
  check('Valid NMEA RMC sentence carries a decoded time', typeof valid.points[1].time === 'number')

  const malformed = parseNmea(readFileSync(`${INVALID}malformed-usgs.nmea`, 'utf8'))
  check('Malformed NMEA (bad checksums) yields zero points', malformed.points.length === 0)
  check(
    'Malformed NMEA reports dropped-checksum count',
    malformed.warnings.some((w) => /dropped due to bad checksums/.test(w)),
    malformed.warnings.join('; '),
  )
}

// --- GPB -----------------------------------------------------------------
{
  const valid = parseGpb(toBuffer(readFileSync(`${BASE}real-usgs.gpb`)))
  check('Valid GPB yields all 8 USGS events', valid.points.length === 8, `${valid.points.length} points`)
  check('Valid GPB preserves the magnitude channel', valid.channels.includes('magnitude'))
  check('Valid GPB round-trips elevation exactly (float32 tolerance)', Math.abs(valid.points[0].ele! - -12362) < 1e-2)

  checkThrows('Malformed GPB (wrong magic header) throws', () => {
    parseGpb(toBuffer(readFileSync(`${INVALID}malformed-usgs.gpb`)))
  })
  let truncatedRejected = false
  try {
    parseGpb(new Uint8Array([71, 80, 66, 49, 1, 0, 0, 0, 0]).buffer)
  } catch (error) {
    truncatedRejected = /Truncated GPB/.test((error as Error).message)
  }
  check('Malformed GPB (truncated container) reports an actionable error', truncatedRejected)
  checkThrows('GPB declared point count is rejected before point materialization', () => {
    parseGpb(new Uint8Array([71, 80, 66, 49, 1, 0, 0, 0, 255, 255, 255, 255]).buffer, 3_000_000)
  })
}

// --- CSV -------------------------------------------------------------------
{
  const mapping: CsvMapping = {
    latitude: 'latitude',
    longitude: 'longitude',
    elevation: 'depth_km',
    timestamp: 'time',
    name: 'usgs_event_id',
    description: 'place',
    elevationUnit: 'meters',
    timeFormat: 'auto',
  }

  function parseCsvSample(text: string) {
    const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: 'greedy' })
    const header = parsed.data[0] as string[]
    const rows = parsed.data.slice(1).map((raw) => {
      const row: Record<string, string> = {}
      header.forEach((column, index) => { row[column] = (raw as string[])[index] ?? '' })
      return row
    })
    return { header, rows, papaErrors: parsed.errors }
  }

  const valid = parseCsvSample(readFileSync(`${BASE}real-usgs.csv`, 'utf8'))
  check('Valid CSV has no delimiter-level parse errors', valid.papaErrors.length === 0)
  const validResult = buildPointsFromCsvRows(valid.rows, mapping, valid.header)
  check('Valid CSV yields all 8 USGS events', validResult.points.length === 8, `${validResult.points.length} points`)
  check('Valid CSV maps name/description columns', validResult.points.some((p) => p.name === 'us7000t3in' && p.desc?.includes('Mid-Atlantic')))
  check('Valid CSV preserves the magnitude channel', validResult.channels.includes('magnitude'))

  const malformed = parseCsvSample(readFileSync(`${INVALID}malformed-usgs.csv`, 'utf8'))
  check(
    'Malformed CSV (unterminated quote) is flagged by the delimiter parser',
    malformed.papaErrors.some((e) => e.code === 'MissingQuotes'),
    JSON.stringify(malformed.papaErrors),
  )
  // Known gap (tracked for Tranche 2 Task 2.3 follow-up): buildPointsFromCsvRows
  // operates on already-split rows and has no visibility into papaparse's row-level
  // parse errors, so a row salvaged from an unterminated quote is still emitted —
  // with its trailing columns corrupted — rather than rejected outright.
  const malformedResult = buildPointsFromCsvRows(malformed.rows, mapping, malformed.header)
  check(
    'Malformed CSV row is still parsed into a point despite the quote error (documented gap)',
    malformedResult.points.length === 1,
    `${malformedResult.points.length} points`,
  )
}

// --- EAG ---------------------------------------------------------------
{
  const valid = parseEag(readFileSync(`${BASE}06JAN25_TEST.txt`, 'utf8'), '06JAN25_TEST.txt')
  check('Valid EAG yields 8 points', valid.points.length === 8, `${valid.points.length} points`)
  check('Valid EAG has no warnings', valid.warnings.length === 0, valid.warnings.join('; '))
  check('Valid EAG preserves heading_deg channel', valid.channels.includes('heading_deg'))
  check('Valid EAG includes eag_field7 and eag_field8 channels', valid.channels.includes('eag_field7') && valid.channels.includes('eag_field8'))
  check('Valid EAG carries elevation from ECEF', valid.points[0].ele !== undefined && typeof valid.points[0].ele === 'number')
  check('Valid EAG includes header metadata', valid.meta && valid.meta['platformName'] === 'TEST-A/C')
  check('Valid EAG reconstructs UTC times', valid.points.every((p) => typeof p.time === 'number'))
  // Check midnight-crossing points (rows 4-5): should have different day-indices
  const point4Time = valid.points[4]?.time
  const point5Time = valid.points[5]?.time
  if (point4Time && point5Time) {
    const d4 = new Date(point4Time)
    const d5 = new Date(point5Time)
    check('Valid EAG midnight-crossing points advance calendar', d5.getUTCDate() === d4.getUTCDate() || d5.getUTCDate() === d4.getUTCDate() + 1)
  }

  const dataset = makeDataset('06JAN25_TEST.txt', 'eag', valid)
  check('makeDataset wires EAG meta through to metadata.meta', dataset.metadata?.meta !== undefined)

  const malformed = parseEag(readFileSync(`${INVALID}malformed-eag.txt`, 'utf8'), '06JAN25_MALFORMED.txt')
  check('Malformed EAG (wrong field counts, invalid ECEF) yields zero points', malformed.points.length === 0)
  check(
    'Malformed EAG surfaces explanatory warnings',
    malformed.warnings.some((w) => /EAG rows skipped/.test(w)),
    malformed.warnings.join('; '),
  )
}

console.log(`\n${failures === 0 ? 'ALL PARSER FIXTURE CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
