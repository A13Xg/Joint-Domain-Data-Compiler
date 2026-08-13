// EAG geographic sanity tests: verify ECEF→geodetic conversion produces
// coordinates in the Nevada/West-Coast region (user's acceptance criterion).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEag } from '../src/core/parsers/eag.ts'

const BASE = join(process.cwd(), 'file-test', 'actual') + '/'

// Bounding box for Nevada + West Coast Ocean (Nevada/Pacific airspace)
const LAT_MIN = 32.0
const LAT_MAX = 42.0
const LON_MIN = -124.0
const LON_MAX = -114.0

let failures = 0

function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// --- Real EAG Files -----------------------------------------------
console.log('\nEAG Geographic Sanity Tests (Nevada/West-Coast bounding box)')

const files = [
  '06MAY25_WNDR01_TSPI.txt',
  '20250506_ATHO_5074.txt',
  '20250506_BOERA_ALL.txt',
  '20250506_DICE_5448.txt',
  '20250506_PRUEL_102_PCZ.txt',
  '20250506_TUCK_5472.txt',
]

let totalPoints = 0
let totalOutOfBounds = 0

for (const file of files) {
  try {
    const result = parseEag(readFileSync(`${BASE}${file}`, 'utf8'), file)
    totalPoints += result.points.length
    let outOfBounds = 0

    for (const point of result.points) {
      if (point.lat < LAT_MIN || point.lat > LAT_MAX || point.lon < LON_MIN || point.lon > LON_MAX) {
        outOfBounds++
      }
    }
    totalOutOfBounds += outOfBounds

    const inBoundsRatio = 1 - outOfBounds / result.points.length
    check(
      `${file}: ≥95% of ${result.points.length} points in bounds`,
      inBoundsRatio >= 0.95,
      `${(inBoundsRatio * 100).toFixed(1)}% (${outOfBounds} out of bounds)`,
    )
  } catch (e) {
    check(`${file}: parse succeeded`, false, (e as Error).message)
  }
}

const totalInBoundsRatio = 1 - totalOutOfBounds / totalPoints
check(
  `≥95% of ${totalPoints} total points in Nevada/West-Coast region`,
  totalInBoundsRatio >= 0.95,
  `${(totalInBoundsRatio * 100).toFixed(1)}% (${totalOutOfBounds} total out of bounds)`,
)

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
  // Point 2 should be on the next calendar day (compare timestamps, not just day-of-month which wraps at month boundaries)
  check(
    'Point 2 (00:00:00) is first point of next day',
    d2.getUTCDate() > d1.getUTCDate() || (d2.getUTCMonth() > d1.getUTCMonth()) || (d2.getUTCFullYear() > d1.getUTCFullYear()),
  )
  check('Point 3 (00:00:01) is second point of next day', d3.getUTCDate() === d2.getUTCDate() && d3.getUTCSeconds() === 1)
  check('Times strictly increase across midnight', t1 < t2 && t2 < t3)
}

console.log(`\n${failures === 0 ? 'ALL EAG GEOGRAPHIC CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
