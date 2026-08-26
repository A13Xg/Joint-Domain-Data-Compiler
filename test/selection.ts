import type { TrackPoint } from '../src/core/model.ts'
import {
  EMPTY_WORKSPACE_SELECTION,
  indexRangeToTimeRange,
  nearestPointIndexByTime,
  normalizeIndexRange,
  normalizeTimeRange,
  selectedPoints,
  timeRangeToIndexRange,
} from '../src/core/selection.ts'

let failures = 0

function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const points: TrackPoint[] = [
  { lat: 0, lon: 0, time: 1000 },
  { lat: 0, lon: 1 },
  { lat: 0, lon: 2, time: 3000 },
  { lat: 0, lon: 3, time: 4000 },
]

check('Empty selection starts without dataset or ranges',
  EMPTY_WORKSPACE_SELECTION.datasetId === null &&
  EMPTY_WORKSPACE_SELECTION.indexRange === null &&
  EMPTY_WORKSPACE_SELECTION.timeRange === null,
)

const normalizedIndex = normalizeIndexRange({ start: 9, end: -2 }, points.length)
check('Index range is ordered and clamped', normalizedIndex?.start === 0 && normalizedIndex.end === 3)

const normalizedTime = normalizeTimeRange({ startMs: 5000, endMs: 2000 })
check('Time range is ordered', normalizedTime.startMs === 2000 && normalizedTime.endMs === 5000)

const timeIndices = timeRangeToIndexRange(points, { startMs: 2500, endMs: 4500 })
check('Time range maps to matching source indices', timeIndices?.start === 2 && timeIndices.end === 3)

const indexTime = indexRangeToTimeRange(points, { start: 0, end: 2 })
check('Index range maps across untimed points', indexTime?.startMs === 1000 && indexTime.endMs === 3000)

check('Nearest timed point is selected', nearestPointIndexByTime(points, 3400) === 2)
check('Untimed-only data has no nearest time', nearestPointIndexByTime([{ lat: 0, lon: 0 }], 1000) === null)

const byIndex = selectedPoints(points, {
  ...EMPTY_WORKSPACE_SELECTION,
  datasetId: 'test',
  indexRange: { start: 1, end: 2 },
})
check('Index selection returns inclusive point range', byIndex.length === 2 && byIndex[0] === points[1])

const byTime = selectedPoints(points, {
  ...EMPTY_WORKSPACE_SELECTION,
  datasetId: 'test',
  timeRange: { startMs: 900, endMs: 3100 },
})
check('Time selection excludes untimed points', byTime.length === 2 && byTime[1] === points[2])

console.log(`\n${failures === 0 ? 'ALL SELECTION CHECKS PASSED' : `${failures} SELECTION CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
