import type { TrackPoint } from '../src/core/model.ts'
import {
  clearAllSelection,
  clearPointSelection,
  clearRangeSelection,
  getHoveredPointIndex,
  getSelectedPointIndex,
  getSelectedRange,
  getSelectedTimeRange,
  handleSelectionKeyboard,
  restorePointSelection,
  setHoveredPointIndex,
} from '../src/state/pointSelection.ts'

let failures = 0
function check(name: string, condition: boolean): void { if (!condition) failures++; console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`) }

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
check('Index range derives synchronized time range', getSelectedTimeRange(points)?.startMs === 1000 && getSelectedTimeRange(points)?.endMs === 3000)

setHoveredPointIndex(points, 99)
check('Out-of-bounds cursor is normalized to null', getHoveredPointIndex(points) === null)
handleSelectionKeyboard(points, 'Home')
check('Home moves cursor to first point', getHoveredPointIndex(points) === 0)
handleSelectionKeyboard(points, 'ArrowRight', true)
check('Shift+Arrow extends a normalized range', getSelectedRange(points)?.start === 0 && getSelectedRange(points)?.end === 1)
handleSelectionKeyboard(points, 'Enter')
check('Enter persists the cursor point', getSelectedPointIndex(points) === 1)
handleSelectionKeyboard(points, 'End')
check('End moves cursor to final point', getHoveredPointIndex(points) === 2)
handleSelectionKeyboard(points, 'Escape')
check('Escape clears point, cursor, and range', getHoveredPointIndex(points) === null && getSelectedPointIndex(points) === null && getSelectedRange(points) === null)

restorePointSelection(points, 1, { start: 0, end: 2 })
clearPointSelection(points)
check('Clearing a point preserves the selected range', getSelectedPointIndex(points) === null && getSelectedRange(points)?.end === 2)
clearRangeSelection(points)
check('Clearing a range preserves the selected point state', getSelectedPointIndex(points) === null && getSelectedRange(points) === null && getSelectedTimeRange(points) === null)
restorePointSelection(points, 1, { start: 0, end: 2 })
setHoveredPointIndex(points, 2)
clearAllSelection(points)
check('Clearing all selection clears point, cursor, and range', getHoveredPointIndex(points) === null && getSelectedPointIndex(points) === null && getSelectedRange(points) === null)

setHoveredPointIndex(other, 0)
check('Switching datasets isolates cursor state', getHoveredPointIndex(points) === null && getHoveredPointIndex(other) === 0)
check('Switching datasets clears stale selection state', getSelectedPointIndex(other) === null && getSelectedRange(other) === null)

console.log(`\n${failures === 0 ? 'ALL LINKED SELECTION CHECKS PASSED' : `${failures} LINKED SELECTION CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
