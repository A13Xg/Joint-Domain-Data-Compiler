import type { TrackPoint } from '../src/core/model.ts'
import {
  BUILT_IN_CHART_PRESETS,
  extractChartSeries,
  minMaxDownsample,
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

let invalidBudgetRejected = false
try {
  extractChartSeries(points, 'elevation', 'time', 1)
} catch {
  invalidBudgetRejected = true
}
check('Invalid chart budgets are rejected', invalidBudgetRejected)

console.log(`\n${failures === 0 ? 'ALL CHART SERIES CHECKS PASSED' : `${failures} CHART SERIES CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
