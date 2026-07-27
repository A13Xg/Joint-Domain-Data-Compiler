// Task 3.3: median and Hampel elevation filters (first tier of the plan's
// filter priority list).
import type { TrackPoint } from '../src/core/model.ts'
import { hampelFilterElevation, medianFilterElevation } from '../src/core/transforms.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function flatTrack(elevations: number[]): TrackPoint[] {
  return elevations.map((ele, i) => ({ lat: 34 + i * 0.001, lon: -118 + i * 0.001, ele }))
}

// --- Median filter -----------------------------------------------------------
{
  const points = flatTrack([100, 101, 500, 99, 100, 100, 100])
  const result = medianFilterElevation(points, 3)
  check('Median filter preserves point count', result.points.length === points.length)
  check('Median filter smooths a single-sample spike', result.points[2]?.ele !== 500, `got ${result.points[2]?.ele}`)
  check('Median filter is a no-op on a flat window', result.points[5]?.ele === 100)
}
{
  const points = flatTrack([100, 101, 102])
  const result = medianFilterElevation(points, 1)
  check('Window of 1 leaves elevations unchanged', result.points.every((p, i) => p.ele === points[i].ele))
}

// --- Hampel filter -------------------------------------------------------
{
  const baseline = Array.from({ length: 15 }, () => 100)
  baseline[7] = 250 // single spike
  const points = flatTrack(baseline)
  const result = hampelFilterElevation(points, 3, 11)
  check('Hampel filter preserves point count', result.points.length === points.length)
  check('Hampel filter replaces the spike with the local median', result.points[7]?.ele === 100, `got ${result.points[7]?.ele}`)
  check('Hampel filter leaves normal points untouched', result.points[3]?.ele === 100)
  check('Hampel-corrected point is flagged for provenance', result.points[7]?.provenance?.qualityFlags?.includes('hampel_corrected') === true)
  check('Untouched points are not flagged', result.points[3]?.provenance?.qualityFlags === undefined)
}
{
  const points = flatTrack([100, 101, 99, 100])
  const result = hampelFilterElevation(points, 3, 11)
  check('Too few elevations yields an explanatory no-op summary', /Too few elevations/.test(result.summary), result.summary)
  check('No-op preserves points unchanged', result.points.every((p, i) => p.ele === points[i].ele))
}
{
  const flat = flatTrack(Array.from({ length: 10 }, () => 100))
  const result = hampelFilterElevation(flat, 3, 7)
  check('Zero MAD (perfectly flat data) does not throw or flag anything', result.points.every((p) => p.provenance?.qualityFlags === undefined))
}

console.log(`\n${failures === 0 ? 'ALL TRANSFORM FILTER CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
