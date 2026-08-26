// Task 3.2: pure before/after operation preview used to gate destructive
// transforms behind a confirmation step.
import type { Dataset } from '../src/core/model.ts'
import { computeOperationPreview, describeOperationPreview } from '../src/core/recipes/preview.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function makeDataset(pointCount: number, options: { withGap?: boolean } = {}): Dataset {
  const points = Array.from({ length: pointCount }, (_, i) => ({
    lat: 34 + i * 0.001,
    lon: -118 + i * 0.001,
    ele: 100,
    time: 1_700_000_000_000 + i * 1000 + (options.withGap && i > pointCount / 2 ? 60_000 : 0),
  }))
  return {
    id: 'preview-test', name: 'preview-test', sourceFormat: 'csv',
    points, warnings: [], channels: [], createdAt: 0,
  }
}

// --- Non-destructive: point count unchanged ---------------------------------
{
  const before = makeDataset(10)
  const after = { ...before, points: before.points.map((p) => ({ ...p, ele: p.ele! + 5 })) }
  const preview = computeOperationPreview(before, after)
  check('Unchanged point count is not destructive', preview.isDestructive === false)
  check('Point counts match before/after', preview.pointCountBefore === 10 && preview.pointCountAfter === 10)
  check('Delta is zero', preview.pointCountDelta === 0)
}

// --- Destructive: points removed --------------------------------------------
{
  const before = makeDataset(10)
  const after = { ...before, points: before.points.slice(0, 4) }
  const preview = computeOperationPreview(before, after)
  check('Reduced point count is destructive', preview.isDestructive === true)
  check('Delta reflects removed points', preview.pointCountDelta === -6)
  check('Bounds change when points are removed', preview.boundsChanged === true)
  const description = describeOperationPreview(preview)
  check('Description mentions removed points', /removed/.test(description), description)
}

// --- Growth: points added (e.g. resampling/notional fill) is not "destructive" ---
{
  const before = makeDataset(5)
  const extra = { lat: 34.01, lon: -118.01, ele: 100, time: 1_700_000_010_000 }
  const after = { ...before, points: [...before.points, extra] }
  const preview = computeOperationPreview(before, after)
  check('Added points is not flagged destructive', preview.isDestructive === false)
  check('Delta reflects added point', preview.pointCountDelta === 1)
}

// --- Quality-event delta -----------------------------------------------------
{
  const before = makeDataset(20, { withGap: true })
  const after = { ...before, points: before.points.filter((_, i) => i !== 11) } // remove a point, keep the gap
  const preview = computeOperationPreview(before, after)
  check('Quality event counts are computed for both snapshots', preview.qualityEventCountBefore >= 0 && preview.qualityEventCountAfter >= 0)
}

// --- Selected-range impact ---------------------------------------------------
{
  const before = makeDataset(10)
  const after = { ...before, points: before.points.slice(0, 6) }
  const preview = computeOperationPreview(before, after, { indexRange: { start: 2, end: 8 } })
  check('Selected range count is clamped to the before dataset', preview.selectedRangeCountBefore === 7)
  check('Selected range count is clamped to the smaller after dataset', preview.selectedRangeCountAfter === 4)
}
{
  const before = makeDataset(10)
  const preview = computeOperationPreview(before, before)
  check('No selection yields null range counts', preview.selectedRangeCountBefore === null && preview.selectedRangeCountAfter === null)
}

console.log(`\n${failures === 0 ? 'ALL OPERATION PREVIEW CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
