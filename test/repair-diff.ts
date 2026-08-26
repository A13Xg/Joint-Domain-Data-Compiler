// Covers the repair-preview alignment ladder: index-for-index when the point
// count is unchanged, geometry-key matching when points were dropped or
// inserted, and the honest fallback when an operation resynthesized the track.
// Also pins the rule that decides where a graphical view makes sense, since
// that is what keeps a preview from appearing with nothing on it.

import type { TrackPoint } from '../src/core/model.ts'
import { ensureBuiltinOperationsRegistered } from '../src/core/operations/basic.ts'
import { executeOperation } from '../src/core/recipes/executor.ts'
import { computeTrackDiff, describeTrackDiff, hasVisualizableChange } from '../src/core/repair/diff.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

ensureBuiltinOperationsRegistered()

const base: TrackPoint[] = Array.from({ length: 40 }, (_, index) => ({
  lat: 40 + index * 0.001,
  lon: -75 + index * 0.0012,
  ele: 300 + index * 2,
  time: 1_700_000_000_000 + index * 1000,
  ext: { heading_deg: 45 + index * 0.1 },
}))

function dataset(points: TrackPoint[]) {
  return { id: 'fixture', name: 'fixture', sourceFormat: 'csv' as const, points, warnings: [], channels: [], createdAt: 0 }
}

console.log('index alignment')
{
  const after = base.map((point) => ({ ...point, ele: point.ele! + 10 }))
  const diff = computeTrackDiff(base, after)
  check('equal counts align index-for-index', diff.alignment === 'index')
  check('every point reads as modified', diff.counts.modified === base.length, `${diff.counts.modified}`)
  check('elevation is the only changed aspect', diff.changed.elevation && !diff.changed.position && !diff.changed.time)
  check('largest elevation shift is reported', Math.abs(diff.maxElevationShiftMeters - 10) < 1e-9, `${diff.maxElevationShiftMeters}`)
  check('a graphical view makes sense', hasVisualizableChange(diff))
}

console.log('channel-only derivations are not visualizable')
{
  const after = base.map((point) => ({ ...point, ext: { ...point.ext, speed_mps: 12 } }))
  const diff = computeTrackDiff(base, after)
  check('no point is classified as modified', diff.counts.modified === 0)
  check('the channel change is still recorded', diff.changed.channels)
  check('no preview is raised for it', !hasVisualizableChange(diff))
}

console.log('subsequence alignment: dropped points')
{
  const dropped = new Set([7, 8, 9, 22])
  const after = base.filter((_, index) => !dropped.has(index))
  const diff = computeTrackDiff(base, after)
  check('unequal counts fall to subsequence matching', diff.alignment === 'subsequence')
  check('every dropped point is found', diff.counts.removed === dropped.size, `${diff.counts.removed}`)
  check('nothing is reported as added', diff.counts.added === 0)
  check('survivors are matched, not re-reported', diff.counts.unchanged === after.length)
  const removedIndices = diff.entries.filter((entry) => entry.kind === 'removed').map((entry) => entry.beforeIndex)
  check('removed entries name the original indices', removedIndices.join(',') === [...dropped].sort((a, b) => a - b).join(','), removedIndices.join(','))
}

console.log('subsequence alignment: inserted points')
{
  const after = [...base]
  after.splice(12, 0, { lat: 40.0115, lon: -75.0139, ele: 322, time: 1_700_000_011_500 })
  after.splice(30, 0, { lat: 40.0285, lon: -75.0345, ele: 356, time: 1_700_000_028_500 })
  const diff = computeTrackDiff(base, after)
  check('insertions still align by subsequence', diff.alignment === 'subsequence')
  check('both inserted samples are found', diff.counts.added === 2, `${diff.counts.added}`)
  check('nothing is reported as removed', diff.counts.removed === 0, `${diff.counts.removed}`)
  check('original samples are all matched', diff.counts.unchanged === base.length)
}

console.log('rebuilt alignment')
{
  // Every sample lands on a new timestamp, so no geometry key survives.
  const after = base.slice(0, 25).map((point, index) => ({ ...point, lat: point.lat + 0.0004, time: point.time! + 137 * index }))
  const diff = computeTrackDiff(base, after)
  check('an unmatched rebuild degrades to count-only', diff.alignment === 'rebuilt')
  check('no misleading per-point entries are emitted', diff.entries.length === 0)
  check('the counts are still true', diff.beforeCount === 40 && diff.afterCount === 25)
  check('a rebuild is always worth showing', hasVisualizableChange(diff))
  check('the description says the pairing is unavailable', describeTrackDiff(diff).some((line) => line.includes('resynthesized')))
}

console.log('empty and degenerate inputs')
{
  const emptied = computeTrackDiff(base, [])
  check('dropping every point is reported as a rebuild', emptied.alignment === 'rebuilt')
  check('the after-count is zero', emptied.afterCount === 0)
  const identical = computeTrackDiff(base, base.map((point) => ({ ...point })))
  check('an unchanged track raises no preview', !hasVisualizableChange(identical))
  const bothEmpty = computeTrackDiff([], [])
  check('two empty tracks align by index', bothEmpty.alignment === 'index' && !hasVisualizableChange(bothEmpty))
}

console.log('against real repair operations')
{
  const withOutlier = base.map((point, index) => (index === 18 ? { ...point, lat: point.lat + 0.5 } : point))
  const execution = executeOperation(dataset(withOutlier), 'drop-outliers', {
    channels: ['position'], windowSize: 5, scoreThreshold: 3,
    minPositionScaleMeters: 1, minElevationScaleMeters: 1, minSpeedScaleMps: 0.5,
  })
  const diff = computeTrackDiff(withOutlier, execution.dataset.points)
  check('drop-outliers is matched as a subsequence', diff.alignment === 'subsequence')
  check('it reports the points it removed', diff.counts.removed > 0 && diff.counts.added === 0, `${diff.counts.removed} removed`)
  check('drop-outliers gets a graphical view', hasVisualizableChange(diff))

  const kinematics = executeOperation(dataset(base), 'standard-kinematics', {})
  const derived = computeTrackDiff(base, kinematics.dataset.points)
  check('standard-kinematics changes channels only', derived.changed.channels && !derived.changed.position && !derived.changed.time)
  check('standard-kinematics raises no preview', !hasVisualizableChange(derived))

  const shifted = executeOperation(dataset(base), 'shift-time', { seconds: 30 })
  const retimed = computeTrackDiff(base, shifted.dataset.points)
  check('shift-time is visible as a time change', retimed.changed.time && hasVisualizableChange(retimed))
  check('shift-time reports its magnitude', Math.abs(retimed.maxTimeShiftMs - 30_000) < 1e-6, `${retimed.maxTimeShiftMs}`)
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll repair-diff checks passed.')
