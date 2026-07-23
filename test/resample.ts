import type { Dataset } from '../src/core/model.ts'
import { fixedRateResampleOperation } from '../src/core/operations/resample.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const dataset: Dataset = {
  id: 'resample-test',
  name: 'resample-test',
  sourceFormat: 'csv',
  createdAt: 0,
  warnings: [],
  channels: ['temperature'],
  points: [
    { lat: 0, lon: 179.9, ele: 100, time: 0, ext: { temperature: 10 } },
    { lat: 1, lon: -179.9, ele: 200, time: 2000, ext: { temperature: 20 } },
  ],
}

const params = fixedRateResampleOperation.validateParams({ rateHz: 1, interpolation: 'linear' })
const result = fixedRateResampleOperation.execute({ dataset, params })
check('Creates fixed-rate samples including endpoints', result.dataset.points.length === 3)
check('Interpolates latitude', result.dataset.points[1]?.lat === 0.5)
check('Interpolates elevation', result.dataset.points[1]?.ele === 150)
check('Interpolates numeric extension channels', result.dataset.points[1]?.ext?.temperature === 15)
check('Handles antimeridian interpolation', Math.abs(Math.abs(result.dataset.points[1]?.lon ?? 0) - 180) < 0.001)
check('Marks generated samples as interpolated', result.dataset.points[1]?.provenance?.qualityFlags?.includes('interpolated') === true)
check('Does not mutate source points', dataset.points[1]?.provenance === undefined)

const step = fixedRateResampleOperation.execute({
  dataset,
  params: fixedRateResampleOperation.validateParams({ rateHz: 1, interpolation: 'step' }),
})
check('Step interpolation carries previous numeric values', step.dataset.points[1]?.ele === 100)

const gap = fixedRateResampleOperation.execute({
  dataset,
  params: fixedRateResampleOperation.validateParams({ rateHz: 1, interpolation: 'linear', maxGapMs: 1000 }),
})
check('Gap policy skips interior samples', gap.dataset.points.length === 2)
check('Gap policy emits a warning', (gap.warnings?.length ?? 0) === 1)

let duplicateRejected = false
try {
  fixedRateResampleOperation.execute({
    dataset: { ...dataset, points: [...dataset.points, { ...dataset.points[1] }] },
    params,
  })
} catch {
  duplicateRejected = true
}
check('Duplicate timestamps are rejected', duplicateRejected)

let invalidRateRejected = false
try {
  fixedRateResampleOperation.validateParams({ rateHz: 0, interpolation: 'linear' })
} catch {
  invalidRateRejected = true
}
check('Invalid rates are rejected', invalidRateRejected)

console.log(`\n${failures === 0 ? 'ALL RESAMPLING CHECKS PASSED' : `${failures} RESAMPLING CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
