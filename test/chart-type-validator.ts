import type { Dataset } from '../src/core/model.ts'
import { getBestChartType, getValidChartTypes, isMismatch } from '../src/visualization/charts/validator.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const withTimestamps: Dataset = {
  id: 'test1',
  name: 'Test',
  sourceFormat: 'csv',
  warnings: [],
  channels: ['ground_speed_mps'],
  createdAt: Date.now(),
  points: [
    { lat: 0, lon: 0, ele: 100, time: 1000, ext: { ground_speed_mps: 5 } },
    { lat: 1, lon: 1, ele: 200, time: 2000, ext: { ground_speed_mps: 6 } },
  ],
}

const noTimestamps: Dataset = {
  ...withTimestamps,
  points: [
    { lat: 0, lon: 0, ele: 100, ext: { ground_speed_mps: 5 } },
    { lat: 1, lon: 1, ele: 200, ext: { ground_speed_mps: 6 } },
  ],
}

const singleNumericChannel: Dataset = {
  ...withTimestamps,
  channels: [],
  points: [
    { lat: 0, lon: 0, ele: 100, time: 1000 },
    { lat: 1, lon: 1, ele: 200, time: 2000 },
  ],
}

// timeSeries validity
const tsTypes = getValidChartTypes(withTimestamps)
check('timeSeries is valid when dataset has timestamps', tsTypes.find((t) => t.type === 'timeSeries')?.isValid === true)

const noTsTypes = getValidChartTypes(noTimestamps)
const noTsTimeSeries = noTsTypes.find((t) => t.type === 'timeSeries')
check('timeSeries is invalid when dataset lacks timestamps', noTsTimeSeries?.isValid === false)
check('timeSeries invalid reason mentions timestamp', !!noTsTimeSeries?.reason?.includes('timestamp'))

// scatter validity (elevation + ground_speed_mps => 2 numeric channels)
check('scatter is valid with 2+ numeric channels', tsTypes.find((t) => t.type === 'scatter')?.isValid === true)

// scatter invalidity (only elevation => 1 numeric channel)
const singleChannelTypes = getValidChartTypes(singleNumericChannel)
const scatterSingle = singleChannelTypes.find((t) => t.type === 'scatter')
check('scatter is invalid with fewer than 2 numeric channels', scatterSingle?.isValid === false)
check('scatter invalid reason mentions numeric channels', !!scatterSingle?.reason?.includes('numeric channels'))

// area validity
check('area is valid when timestamped with a numeric channel', tsTypes.find((t) => t.type === 'area')?.isValid === true)
check('area is invalid when dataset lacks timestamps', noTsTypes.find((t) => t.type === 'area')?.isValid === false)

// isMismatch
check('isMismatch is true for timeSeries on a dataset without timestamps', isMismatch(noTimestamps, 'timeSeries') === true)
check('isMismatch is false for timeSeries on a dataset with timestamps', isMismatch(withTimestamps, 'timeSeries') === false)
check('isMismatch is true for an unknown chart type', isMismatch(withTimestamps, 'pie') === true)

// getBestChartType
check('getBestChartType prefers timeSeries when valid', getBestChartType(withTimestamps) === 'timeSeries')
check('getBestChartType falls back to scatter when timestamps are missing but channels are numeric', getBestChartType(noTimestamps) === 'scatter')

console.log(`\n${failures === 0 ? 'ALL CHART TYPE VALIDATOR CHECKS PASSED' : `${failures} CHART TYPE VALIDATOR CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
