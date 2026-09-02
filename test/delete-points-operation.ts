import type { Dataset } from '../src/core/model.ts'
import { buildRecipe, executeOperation, replayRecipe } from '../src/core/recipes/executor.ts'
import { fingerprintDataset } from '../src/core/recipes/hash.ts'
import { clearOperationsForTests, registerOperation } from '../src/core/recipes/registry.ts'
import { deletePointsOperation } from '../src/core/operations/delete-points.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const source: Dataset = {
  id: 'delete-points-source',
  name: 'delete-points-source',
  sourceFormat: 'csv',
  points: [
    { lat: 1, lon: 2, ele: 100, time: 1000 },
    { lat: 1.1, lon: 2.1, ele: 120, time: 2000 },
    { lat: 1.2, lon: 2.2, ele: 140, time: 3000 },
    { lat: 1.3, lon: 2.3, ele: 160, time: 4000 },
    { lat: 1.4, lon: 2.4, ele: 180, time: 5000 },
  ],
  warnings: [],
  channels: [],
  createdAt: 0,
}

clearOperationsForTests()
registerOperation(deletePointsOperation)

// --- basic removal, non-contiguous set --------------------------------------
const removed = executeOperation(source, 'delete-points', {}, { indexSet: [1, 3] })
check('Deletes exactly the named points', removed.dataset.points.length === 3)
check('Kept points preserve dataset order', removed.dataset.points.map((point) => point.lat).join(',') === '1,1.2,1.4')
check('Does not mutate the source dataset', source.points.length === 5)
check('Summary reports the deleted count', removed.record.summary.includes('2'))

// --- a single index, and a set naming the whole dataset ---------------------
const singleRemoved = executeOperation(source, 'delete-points', {}, { indexSet: [0] })
check('Deleting a single index removes exactly one point', singleRemoved.dataset.points.length === 4)
check('Deleting index 0 leaves the rest in order', singleRemoved.dataset.points.map((point) => point.lat).join(',') === '1.1,1.2,1.3,1.4')

const allRemoved = executeOperation(source, 'delete-points', {}, { indexSet: [0, 1, 2, 3, 4] })
check('Deleting every index empties the dataset', allRemoved.dataset.points.length === 0)

// --- duplicate indices in the set count once ---------------------------------
const dedupedRemoved = executeOperation(source, 'delete-points', {}, { indexSet: [2, 2, 2] })
check('Duplicate indices in the set are deduplicated', dedupedRemoved.dataset.points.length === 4)

// --- rejects an empty or missing set -----------------------------------------
let emptySetRejected = false
try {
  executeOperation(source, 'delete-points', {}, { indexSet: [] })
} catch {
  emptySetRejected = true
}
check('An empty indexSet is rejected', emptySetRejected)

let missingScopeRejected = false
try {
  executeOperation(source, 'delete-points', {})
} catch {
  missingScopeRejected = true
}
check('A missing scope is rejected', missingScopeRejected)

// --- rejects out-of-range and non-integer indices -----------------------------
let outOfRangeRejected = false
try {
  executeOperation(source, 'delete-points', {}, { indexSet: [source.points.length] })
} catch {
  outOfRangeRejected = true
}
check('An out-of-range index is rejected', outOfRangeRejected)

let negativeIndexRejected = false
try {
  executeOperation(source, 'delete-points', {}, { indexSet: [-1] })
} catch {
  negativeIndexRejected = true
}
check('A negative index is rejected', negativeIndexRejected)

let fractionalIndexRejected = false
try {
  executeOperation(source, 'delete-points', {}, { indexSet: [1.5] })
} catch {
  fractionalIndexRejected = true
}
check('A non-integer index is rejected', fractionalIndexRejected)

// --- rejects range-shaped scope (this is a set-scoped operation only) --------
let indexRangeRejected = false
try {
  executeOperation(source, 'delete-points', {}, { indexRange: { start: 0, end: 1 } })
} catch {
  indexRangeRejected = true
}
check('An indexRange scope is rejected', indexRangeRejected)

let timeRangeRejected = false
try {
  executeOperation(source, 'delete-points', {}, { timeRange: { startMs: 1000, endMs: 2000 } })
} catch {
  timeRangeRejected = true
}
check('A timeRange scope is rejected', timeRangeRejected)

// --- rejects parameters (the operation takes none) ---------------------------
let paramsRejected = false
try {
  executeOperation(source, 'delete-points', { anything: true }, { indexSet: [0] })
} catch {
  paramsRejected = true
}
check('Non-empty params are rejected', paramsRejected)

// --- replay reproduces the same output --------------------------------------
const recipe = buildRecipe('Delete points test', source, [removed.record])
const replayed = replayRecipe(source, recipe)
check('Recipe replay reproduces the same dataset state', fingerprintDataset(replayed) === fingerprintDataset(removed.dataset))
check('Operation record captures the input hash', removed.record.inputDatasetHash === fingerprintDataset(source))
check('Operation record captures the output hash', removed.record.outputDatasetHash === fingerprintDataset(removed.dataset))
check('Operation record carries the indexSet scope', removed.record.scope?.indexSet?.join(',') === '1,3')

console.log(`\n${failures === 0 ? 'ALL DELETE POINTS OPERATION CHECKS PASSED' : `${failures} DELETE POINTS OPERATION CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
