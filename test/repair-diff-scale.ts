// Budget guard for the repair gate at real track sizes.
//
// The gate runs synchronously on the Apply click, so the diff and the marker
// projection sit between the user and the dialog. The map already carries a
// 500k-point budget (test/e2e/map-performance.spec.ts); this pins the same
// scale for the two paths that a repair adds — a point-preserving edit, where
// every sample is compared index-for-index, and a point-removing one, where
// the geometry-key walk runs.

import { generateSyntheticTrack } from '../benchmarks/generate.ts'
import { computeTrackDiff, hasVisualizableChange } from '../src/core/repair/diff.ts'
import { buildPlanFrame, projectTrack } from '../src/visualization/diff/planProjection.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// Roughly three times the measured worst case at 500k (297 ms index diff,
// 193 ms geometry match, 165 ms projection), so a loaded CI box does not flake
// — but the composed-key form this started with, which took 1710 ms to match a
// 500k track, fails loudly if it ever comes back.
const DIFF_BUDGET_MS = 1000
const RENDER_BUDGET_MS = 700

function timed<T>(run: () => T): { result: T; ms: number } {
  const started = performance.now()
  const result = run()
  return { result, ms: performance.now() - started }
}

for (const size of [100_000, 500_000]) {
  console.log(`${size.toLocaleString()} points`)
  const before = generateSyntheticTrack(size, { seed: 11, gapFraction: 0.2 })

  const shifted = before.map((point) => ({ ...point, ele: (point.ele ?? 0) + 10 }))
  const indexRun = timed(() => computeTrackDiff(before, shifted))
  check(`index-aligned diff stays inside ${DIFF_BUDGET_MS} ms`, indexRun.ms < DIFF_BUDGET_MS, `${indexRun.ms.toFixed(0)} ms`)
  check('index-aligned diff classifies every point', indexRun.result.counts.modified === size)
  check('index-aligned diff is visualizable', hasVisualizableChange(indexRun.result))

  const decimated = before.filter((_, index) => index % 2 === 0)
  const subsequenceRun = timed(() => computeTrackDiff(before, decimated))
  check(`subsequence diff stays inside ${DIFF_BUDGET_MS} ms`, subsequenceRun.ms < DIFF_BUDGET_MS, `${subsequenceRun.ms.toFixed(0)} ms`)
  check('subsequence diff finds every dropped point', subsequenceRun.result.counts.removed === size - decimated.length)

  // What the plot itself does with the result: frame both tracks, then project
  // them at the display budget.
  const renderRun = timed(() => {
    const frame = buildPlanFrame([before, decimated], 720, 420, 28)
    if (!frame) throw new Error('expected a frame')
    return projectTrack(before, frame).length + projectTrack(decimated, frame).length
  })
  check(`projecting both paths stays inside ${RENDER_BUDGET_MS} ms`, renderRun.ms < RENDER_BUDGET_MS, `${renderRun.ms.toFixed(0)} ms`)
  check('projection respects the display budget', renderRun.result <= 4002, `${renderRun.result} drawn`)
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll repair-diff scale checks passed.')
