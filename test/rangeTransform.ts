import type { TrackPoint } from '../src/core/model.ts'
import { applyTransformToRange } from '../src/core/rangeTransform.ts'
import { offsetElevation, decimate } from '../src/core/transforms.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const points: TrackPoint[] = [
  { lat: 0, lon: 0, ele: 1 },
  { lat: 0, lon: 1, ele: 2 },
  { lat: 0, lon: 2, ele: 3 },
  { lat: 0, lon: 3, ele: 4 },
]

const result = applyTransformToRange(points, { start: 1, end: 2 }, (selected) => offsetElevation(selected, 10))
check('Preserves total point count', result.points.length === points.length)
check('Preserves points before selection', result.points[0]?.ele === 1)
check('Transforms selected points', result.points[1]?.ele === 12 && result.points[2]?.ele === 13)
check('Preserves points after selection', result.points[3]?.ele === 4)
check('Does not mutate source points', points[1]?.ele === 2)
check('Includes selected range in summary', result.summary.includes('1–2'))

let lengthChangeRejected = false
try {
  applyTransformToRange(points, { start: 0, end: 3 }, (selected) => decimate(selected, 2))
} catch {
  lengthChangeRejected = true
}
check('Rejects transforms that change point count', lengthChangeRejected)

console.log(`\n${failures === 0 ? 'ALL RANGE TRANSFORM CHECKS PASSED' : `${failures} RANGE TRANSFORM CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
