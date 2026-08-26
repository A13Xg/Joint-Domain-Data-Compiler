// EAG geographic accuracy tests: verify the ECEF→geodetic conversion recovers
// the coordinates a range file was built from.
//
// This used to run against a corpus of real range recordings and assert only
// that ≥95% of points landed inside a Nevada/West-Coast bounding box. The
// corpus is gone (it was operational data and this repository is public), and
// the replacement is a stronger check rather than a weaker one: the fixtures in
// test/fixtures/*_RANGE_SYNTH.txt were generated from known geodetic waypoints
// through an independent WGS-84 implementation, so every point has an exact
// expected latitude, longitude, and altitude instead of a box to fall inside.
import { readFileSync } from 'node:fs'
import { parseEag } from '../src/core/parsers/eag.ts'
import { FIXTURES } from './helpers/fixtures.ts'

interface ExpectedPoint { lat: number; lon: number; ele: number }

// Rounding the generated ECEF triples to whole metres (the format's own
// precision) moves a point by up to ~0.9 m, which is ~1e-5 degrees of latitude.
const DEG_TOLERANCE = 3e-5
const ELE_TOLERANCE_M = 2

let failures = 0

function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const expected = JSON.parse(readFileSync(`${FIXTURES}eag-expected.json`, 'utf8')) as ExpectedPoint[]

// Both filename date encodings parseEag supports, so neither branch of its
// mission-date extraction goes uncovered.
const files = [
  { name: '20250506_RANGE_SYNTH.txt', dateForm: 'YYYYMMDD', utcDay: 6, utcMonth: 5, utcYear: 2025 },
  { name: '06MAY25_RANGE_SYNTH.txt', dateForm: 'DDMMMYY', utcDay: 6, utcMonth: 5, utcYear: 2025 },
]

console.log('\nEAG Geographic Accuracy Tests (synthetic WGS-84 reference corpus)')

for (const file of files) {
  const result = parseEag(readFileSync(`${FIXTURES}${file.name}`, 'utf8'), file.name)

  check(`${file.name}: parses without warnings`, result.warnings.length === 0, result.warnings.join('; '))
  check(`${file.name}: yields ${expected.length} points`, result.points.length === expected.length, `${result.points.length} points`)

  let worstLat = 0
  let worstLon = 0
  let worstEle = 0
  for (const [index, want] of expected.entries()) {
    const got = result.points[index]
    if (!got) break
    worstLat = Math.max(worstLat, Math.abs(got.lat - want.lat))
    worstLon = Math.max(worstLon, Math.abs(got.lon - want.lon))
    worstEle = Math.max(worstEle, Math.abs((got.ele ?? NaN) - want.ele))
  }
  check(`${file.name}: latitude within ${DEG_TOLERANCE}°`, worstLat <= DEG_TOLERANCE, `worst ${worstLat.toExponential(2)}°`)
  check(`${file.name}: longitude within ${DEG_TOLERANCE}°`, worstLon <= DEG_TOLERANCE, `worst ${worstLon.toExponential(2)}°`)
  check(`${file.name}: altitude within ${ELE_TOLERANCE_M} m`, worstEle <= ELE_TOLERANCE_M, `worst ${worstEle.toFixed(2)} m`)

  // The mission date comes from the filename, so a decoding regression here is
  // invisible to the coordinate checks above.
  const first = result.points[0]
  const firstDate = first?.time === undefined ? null : new Date(first.time)
  check(
    `${file.name}: ${file.dateForm} filename decodes to the right UTC date`,
    firstDate !== null
      && firstDate.getUTCFullYear() === file.utcYear
      && firstDate.getUTCMonth() + 1 === file.utcMonth
      && firstDate.getUTCDate() === file.utcDay,
    firstDate?.toISOString() ?? 'no time',
  )
}

// --- Midnight-Crossing Synthetic Test ----------------------------------------
console.log('\nMidnight Crossing Test')

const midnightCrossingFile = `A	1	9999	99	25	1	MIDNIGHT-TEST
86399000	1	9999	99	-2180000	-4666000	3749500	 0.0	  0.0	 0.0	23:59:59.00
0	1	9999	99	-2179800	-4665900	3749600	 0.0	  0.0	 0.0	00:00:00.00
1000	1	9999	99	-2179600	-4665800	3749700	 0.0	  0.0	 0.0	00:00:01.00
`

const midnightResult = parseEag(midnightCrossingFile, '19991231_MIDNIGHT_TEST.txt')
check('Midnight crossing parse yields 3 points', midnightResult.points.length === 3, `${midnightResult.points.length} points`)
check('Midnight crossing has no warnings', midnightResult.warnings.length === 0, midnightResult.warnings.join('; '))

if (midnightResult.points.length >= 3) {
  const p1 = midnightResult.points[0]!
  const p2 = midnightResult.points[1]!
  const p3 = midnightResult.points[2]!

  const t1 = p1.time ?? 0
  const t2 = p2.time ?? 0
  const t3 = p3.time ?? 0

  const d1 = new Date(t1)
  const d2 = new Date(t2)
  const d3 = new Date(t3)

  check('Point 1 (23:59:59) is last point of day', d1.getUTCHours() === 23 && d1.getUTCMinutes() === 59)
  // Compare timestamps, not day-of-month, which wraps at month boundaries.
  check(
    'Point 2 (00:00:00) is first point of next day',
    d2.getUTCDate() > d1.getUTCDate() || (d2.getUTCMonth() > d1.getUTCMonth()) || (d2.getUTCFullYear() > d1.getUTCFullYear()),
  )
  check('Point 3 (00:00:01) is second point of next day', d3.getUTCDate() === d2.getUTCDate() && d3.getUTCSeconds() === 1)
  check('Times strictly increase across midnight', t1 < t2 && t2 < t3)
}

console.log(`\n${failures === 0 ? 'ALL EAG GEOGRAPHIC CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
