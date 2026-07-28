import assert from 'node:assert/strict'
import { buildComparisonCsv } from '../src/core/analytics/comparisonReport.ts'

const csv = buildComparisonCsv([{
  referenceIndex: 2,
  targetIndex: 4,
  referenceTimeMs: 1000,
  targetTimeMs: 1000,
  deltaTimeMs: 0,
  relativeEastM: 1,
  relativeNorthM: 2,
  relativeUpM: 3,
  horizontalRangeM: 2.24,
  slantRangeM: 3.74,
  bearingDeg: 26.6,
  derived: true,
}])
assert.match(csv, /^reference_index,target_index,derived,delta_time_ms/)
assert.match(csv, /2,4,interpolated,0,3.74,2.24,26.6,3,\n$/)
console.log('comparison report tests passed')
