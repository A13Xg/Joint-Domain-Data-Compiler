import type { TrackPoint } from '../src/core/model.ts'
import {
  getHoveredPointIndex,
  getSelectedPointIndex,
  getSelectedRange,
  restorePointSelection,
  setHoveredPointIndex,
} from '../src/state/pointSelection.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const points: TrackPoint[] = [
  { lat: 34, lon: -117, time: 1000 },
  { lat: 34.1, lon: -117.1, time: 2000 },
  { lat: 34.2, lon: -117.2, time: 3000 },
]
const other: TrackPoint[] = [{ lat: 0, lon: 0 }]

restorePointSelection(points, 1, { start: 0, end: 2 })
setHoveredPointIndex(points, 2)
check('Cursor is shared through the dataset-scoped store', getHoveredPointIndex(points) === 2)
check('Cursor does not replace selected point', getSelectedPointIndex(points) === 1)
check('Cursor does not replace selected range', getSelectedRange(points)?.end === 2)

setHoveredPointIndex(points, 99)
check('Out-of-bounds cursor is normalized to null', getHoveredPointIndex(points) === null)
setHoveredPointIndex(points, 0)
check('Cursor can move independently after normalization', getHoveredPointIndex(points) === 0)

setHoveredPointIndex(other, 0)
check('Switching datasets isolates cursor state', getHoveredPointIndex(points) === null && getHoveredPointIndex(other) === 0)
check('Switching datasets clears stale selection state', getSelectedPointIndex(other) === null && getSelectedRange(other) === null)

console.log(`\n${failures === 0 ? 'ALL LINKED SELECTION CHECKS PASSED' : `${failures} LINKED SELECTION CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
