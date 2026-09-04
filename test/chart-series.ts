import type { TrackPoint } from '../src/core/model.ts'
import {
  BUILT_IN_CHART_PRESETS,
  channelIdFromXAxis,
  computeXDomain,
  extractChartSeries,
  minMaxDownsample,
  numericChannelValue,
  resolvePresetChannels,
} from '../src/visualization/charts/series.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const points: TrackPoint[] = Array.from({ length: 1000 }, (_, index) => ({
  lat: 0,
  lon: index / 1000,
  ele: index === 500 ? 10_000 : index,
  time: index * 1000,
  ext: {
    ground_speed_mps: index / 10,
    distance_m: index * 25,
  },
}))

const altitude = extractChartSeries(points, 'elevation', 'time', 100)
check('Series extraction preserves global minimum', altitude.min === 0)
check('Series extraction preserves global maximum', altitude.max === 10_000)
check('Series output respects point budget', altitude.samples.length <= 100)
check('Min-max downsampling preserves spike', altitude.samples.some((sample) => sample.y === 10_000))
check('Source indices remain available for linked selection', altitude.samples.every((sample) => Number.isInteger(sample.sourceIndex)))
check('Full-dataset series over budget is flagged downsampled', altitude.downsampled === true)

// --- computeXDomain: the full-extent domain, computed once from raw data ---
const timeDomain = computeXDomain(points, 'time')
check('computeXDomain spans the full time range', timeDomain?.lo === 0 && timeDomain?.hi === 999_000)

const indexDomain = computeXDomain(points, 'index')
check('computeXDomain spans the full index range', indexDomain?.lo === 0 && indexDomain?.hi === 999)

check('computeXDomain of an empty track is null', computeXDomain([], 'time') === null)

// --- domain-aware filtering: this is what makes zooming recover resolution -
// A window covering just indices 500-501 (times 500000-501000) should return
// only those two points plus one retained sample just outside each edge (499
// and 502), so the plotted line still reaches the window's boundary instead
// of stopping short at the last in-window sample.
const narrowed = extractChartSeries(points, 'elevation', 'time', 1000, { lo: 500_000, hi: 501_000 })
const narrowedIndices = narrowed.samples.map((sample) => sample.sourceIndex).sort((a, b) => a - b)
check('Domain filter keeps the in-window points plus one edge sample each side', narrowedIndices.join(',') === '499,500,501,502')
check('Domain filter excludes points further outside the window', !narrowedIndices.includes(498) && !narrowedIndices.includes(503))
check('A narrow window under budget is not downsampled', narrowed.downsampled === false)
check('Extrema inside the narrowed window are still preserved', narrowed.max === 10_000)

// Zooming in re-spends the same budget over a smaller window, so a tight
// window should end up far below the point budget even though the full
// dataset (1000 points) exceeds it — this is the resolution-recovery the
// window-aware downsampling fix exists for.
const zoomedIn = extractChartSeries(points, 'elevation', 'time', 100, { lo: 100_000, hi: 110_000 })
check('A zoomed-in window resolves below the point budget', zoomedIn.downsampled === false)
check('A zoomed-in window keeps every point in range, not just extrema', zoomedIn.samples.length >= 9)

// A domain entirely outside the data range degrades to an empty (but valid,
// non-throwing) series rather than crashing on an unflushed edge sample.
const outsideDomain = extractChartSeries(points, 'elevation', 'time', 100, { lo: 5_000_000, hi: 6_000_000 })
check('A domain outside the data range returns an empty series without throwing', outsideDomain.samples.length === 0)

const distance = extractChartSeries(points, 'elevation', 'distance', 80)
check('Distance axis uses distance channel', distance.samples[1]!.x > distance.samples[0]!.x)

const original = [
  { sourceIndex: 0, x: 0, y: 0 },
  { sourceIndex: 1, x: 1, y: 1 },
]
check('Small series is returned intact', minMaxDownsample(original, 10).length === 2)

const speedPreset = BUILT_IN_CHART_PRESETS.find((preset) => preset.id === 'speed-time')!
check('Speed preset resolves preferred available channel', resolvePresetChannels(speedPreset, ['speed_mps']).join(',') === 'speed_mps')
check('Unavailable preset channels resolve empty', resolvePresetChannels(speedPreset, []).length === 0)

// --- channel-vs-channel x-axis: X = another numeric channel's own value ----
check('channelIdFromXAxis extracts the id from a channel: axis', channelIdFromXAxis('channel:ground_speed_mps') === 'ground_speed_mps')
check('channelIdFromXAxis returns null for the fixed axis kinds', channelIdFromXAxis('time') === null && channelIdFromXAxis('index') === null && channelIdFromXAxis('distance') === null)

const channelAxis = extractChartSeries(points, 'elevation', 'channel:ground_speed_mps', 1000)
check('a channel x-axis pairs each point\'s own (x-channel, y-channel) values', channelAxis.samples.every((sample) => {
  const point = points[sample.sourceIndex]!
  return sample.x === numericChannelValue(point, 'ground_speed_mps') && sample.y === point.ele
}))
check('a channel x-axis produces one sample per point when unwindowed and under budget', channelAxis.samples.length === points.length)

const channelDomain = computeXDomain(points, 'channel:ground_speed_mps')
check('computeXDomain over a channel axis spans that channel\'s own min/max', channelDomain?.lo === 0 && channelDomain?.hi === 99.9)

// A point missing the x-channel (but present in the y-channel) is skipped
// entirely, the same way a point missing time/distance already is — not
// plotted at a fabricated x of 0.
const withGaps: TrackPoint[] = [
  { lat: 0, lon: 0, ele: 10, ext: { ground_speed_mps: 1 } },
  { lat: 0, lon: 0, ele: 20 }, // no ground_speed_mps at all
  { lat: 0, lon: 0, ele: 30, ext: { ground_speed_mps: 3 } },
]
const withGapsSeries = extractChartSeries(withGaps, 'elevation', 'channel:ground_speed_mps', 100)
check('a point missing the x-channel value is skipped, not plotted at x=0', withGapsSeries.samples.length === 2 && withGapsSeries.samples.every((sample) => sample.sourceIndex !== 1))

let invalidBudgetRejected = false
try {
  extractChartSeries(points, 'elevation', 'time', 1)
} catch {
  invalidBudgetRejected = true
}
check('Invalid chart budgets are rejected', invalidBudgetRejected)

console.log(`\n${failures === 0 ? 'ALL CHART SERIES CHECKS PASSED' : `${failures} CHART SERIES CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
