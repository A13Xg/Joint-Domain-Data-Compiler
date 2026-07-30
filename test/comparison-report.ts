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
// No drift supplied: output must degrade gracefully with no drift lines and no crash.
assert.ok(!csv.includes('estimated_clock_offset_ms'))

const csvWithDrift = buildComparisonCsv([{
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
}], { offsetMs: 12.5, driftRatePerMs: 0.0002, referenceEpochMs: 1000, sampleCount: 7 })
assert.match(csvWithDrift, /# estimated_clock_offset_ms,12\.5\n/)
assert.match(csvWithDrift, /# estimated_clock_drift_ppm,200\n/)
assert.match(csvWithDrift, /# clock_drift_reference_epoch_ms,1000\n/)
assert.match(csvWithDrift, /# clock_drift_sample_count,7\n$/)

console.log('comparison report tests passed')
