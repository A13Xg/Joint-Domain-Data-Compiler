import type { TrackPoint } from '../src/core/model.ts'
import {
  clearAllSelection,
  extendSetRange,
  getSelectedIndexSet,
  getSelectedPointIndex,
  getSelectedRange,
  getSelectedTimeRange,
  restorePointSelection,
  toggleInSet,
  unionSetRange,
} from '../src/state/pointSelection.ts'

let failures = 0
function check(name: string, condition: boolean): void { if (!condition) failures++; console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`) }

const points: TrackPoint[] = [
  { lat: 34, lon: -117, time: 1000 },
  { lat: 34.1, lon: -117.1, time: 2000 },
  { lat: 34.2, lon: -117.2, time: 3000 },
  { lat: 34.3, lon: -117.3, time: 4000 },
  { lat: 34.4, lon: -117.4, time: 5000 },
]
const other: TrackPoint[] = [{ lat: 0, lon: 0 }]

// --- ctrl/cmd+click toggling --------------------------------------------------
restorePointSelection(points, null, null)
toggleInSet(points, 2)
check('Toggling an index adds it to the set', getSelectedIndexSet(points).join(',') === '2')
toggleInSet(points, 4)
check('A second toggle adds the second index, sorted', getSelectedIndexSet(points).join(',') === '2,4')
toggleInSet(points, 2)
check('Toggling a member again removes it', getSelectedIndexSet(points).join(',') === '4')

// --- shift+click range extension ---------------------------------------------
restorePointSelection(points, null, null)
toggleInSet(points, 1)
extendSetRange(points, 3)
check('Shift+click unions the contiguous run from the anchor', getSelectedIndexSet(points).join(',') === '1,2,3')
toggleInSet(points, 1)
check('The anchor itself can still be toggled out, leaving the rest', getSelectedIndexSet(points).join(',') === '2,3')

// --- anchor semantics: toggle moves it, extend does not -----------------------
restorePointSelection(points, null, null)
toggleInSet(points, 0)
toggleInSet(points, 4)
// Anchor is now 4 (the last toggle). A shift+click at 2 should extend from 4, not 0.
extendSetRange(points, 2)
check('Toggle moves the anchor to the toggled index', getSelectedIndexSet(points).join(',') === '0,2,3,4')

restorePointSelection(points, null, null)
toggleInSet(points, 1) // anchor = 1
extendSetRange(points, 3) // run 1..3, anchor stays 1
extendSetRange(points, 0) // run 0..1, unioned with existing 1..3
check('Repeated shift+clicks accumulate disjoint runs from the same anchor', getSelectedIndexSet(points).join(',') === '0,1,2,3')

// --- ctrl/cmd+drag marquee: unionSetRange -------------------------------------
restorePointSelection(points, null, null)
unionSetRange(points, 1, 3)
check('unionSetRange adds the contiguous run between two explicit endpoints', getSelectedIndexSet(points).join(',') === '1,2,3')
unionSetRange(points, 3, 1) // reversed order still works
check('unionSetRange normalizes a reversed (end, start) pair', getSelectedIndexSet(points).join(',') === '1,2,3')
unionSetRange(points, 0, 0)
check('unionSetRange unions with a prior disjoint run rather than replacing it', getSelectedIndexSet(points).join(',') === '0,1,2,3')

restorePointSelection(points, null, null)
toggleInSet(points, 4) // anchor = 4
unionSetRange(points, 0, 1)
extendSetRange(points, 2) // still extends from anchor 4, not from anything unionSetRange touched
check('unionSetRange does not move the shift-click anchor', getSelectedIndexSet(points).join(',') === '0,1,2,3,4')

restorePointSelection(points, null, null)
unionSetRange(points, 99, 2)
check('unionSetRange with an out-of-bounds endpoint is a no-op', getSelectedIndexSet(points).length === 0)

// --- a plain single-point/range/time-range selection abandons the set --------
restorePointSelection(points, null, null)
toggleInSet(points, 1)
toggleInSet(points, 3)
restorePointSelection(points, 2, null)
check('restorePointSelection (a fresh selectPoint-equivalent) clears an in-progress set', getSelectedIndexSet(points).length === 0)
check('...and still lands the point selection', getSelectedPointIndex(points) === 2)

// --- dataset isolation ---------------------------------------------------------
restorePointSelection(points, null, null)
toggleInSet(points, 0)
toggleInSet(other, 0)
check('Switching datasets isolates the set', getSelectedIndexSet(points).length === 0 && getSelectedIndexSet(other).join(',') === '0')

// --- out-of-bounds indices are ignored -----------------------------------------
restorePointSelection(points, null, null)
toggleInSet(points, 99)
check('An out-of-bounds toggle is a no-op', getSelectedIndexSet(points).length === 0)

// --- clean slate: neither a range nor a time range accompanies the set -------
restorePointSelection(points, null, null)
toggleInSet(points, 1)
extendSetRange(points, 3)
check('Building a set does not populate the unrelated index range', getSelectedRange(points) === null)
check('Building a set does not populate the unrelated time range', getSelectedTimeRange(points) === null)

clearAllSelection(points)
console.log(`\n${failures === 0 ? 'ALL SET SELECTION CHECKS PASSED' : `${failures} SET SELECTION CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
