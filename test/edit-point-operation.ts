import type { Dataset } from '../src/core/model.ts'
import { ensureBuiltinDerivationsRegistered } from '../src/core/analytics/bootstrap.ts'
import { runDerivation } from '../src/core/analytics/registry.ts'
import { buildRecipe, executeOperation, replayRecipe } from '../src/core/recipes/executor.ts'
import { fingerprintDataset } from '../src/core/recipes/hash.ts'
import { clearOperationsForTests, registerOperation } from '../src/core/recipes/registry.ts'
import { editPointOperation } from '../src/core/operations/edit-point.ts'
import { withPoints } from '../src/core/transforms.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const source: Dataset = {
  id: 'edit-point-source',
  name: 'edit-point-source',
  sourceFormat: 'csv',
  points: [
    { lat: 1, lon: 2, ele: 100, time: 1000, ext: { speed_mps: 5, flagged: false, tag: 'a' } },
    { lat: 1.1, lon: 2.1, ele: 120, time: 2000 },
  ],
  warnings: [],
  channels: ['speed_mps', 'flagged', 'tag'],
  createdAt: 0,
}

clearOperationsForTests()
registerOperation(editPointOperation)

// --- scalar field edit ------------------------------------------------------
const scalarEdit = executeOperation(source, 'edit-point', { index: 0, fields: { lat: 9.5, ele: 250 } }, { indexRange: { start: 0, end: 0 } })
check('Scalar edit updates the targeted field', scalarEdit.dataset.points[0]?.lat === 9.5)
check('Scalar edit updates a second targeted field in the same call', scalarEdit.dataset.points[0]?.ele === 250)
check('Scalar edit leaves untouched scalar fields alone', scalarEdit.dataset.points[0]?.lon === 2)
check('Scalar edit leaves other points untouched', scalarEdit.dataset.points[1]?.lat === 1.1)
check('Scalar edit does not mutate the source dataset', source.points[0]?.lat === 1)
check('Scalar edit preserves point count', scalarEdit.dataset.points.length === source.points.length)
check('Scalar edit flags the point manual_edit in provenance', scalarEdit.dataset.points[0]?.provenance?.qualityFlags?.includes('manual_edit') === true)
check('Scalar edit does not flag untouched points', scalarEdit.dataset.points[1]?.provenance?.qualityFlags === undefined)

// --- manual_edit is unioned with pre-existing quality flags, not replacing them
const flaggedSource: Dataset = { ...source, points: [{ ...source.points[0]!, provenance: { qualityFlags: ['interpolated'] } }, source.points[1]!] }
const flaggedEdit = executeOperation(flaggedSource, 'edit-point', { index: 0, fields: { lat: 3 } })
check('manual_edit is added alongside a pre-existing quality flag', flaggedEdit.dataset.points[0]?.provenance?.qualityFlags?.includes('interpolated') === true && flaggedEdit.dataset.points[0]?.provenance?.qualityFlags?.includes('manual_edit') === true)
check('A repeat edit does not duplicate the manual_edit flag', executeOperation(flaggedEdit.dataset, 'edit-point', { index: 0, fields: { lat: 4 } }).dataset.points[0]?.provenance?.qualityFlags?.filter((flag) => flag === 'manual_edit').length === 1)

// --- ext patch merges without dropping other channels -----------------------
const extEdit = executeOperation(source, 'edit-point', { index: 0, fields: { ext: { speed_mps: 11 } } })
check('ext patch updates the targeted channel', extEdit.dataset.points[0]?.ext?.speed_mps === 11)
check('ext patch leaves sibling channels intact', extEdit.dataset.points[0]?.ext?.tag === 'a')
check('ext patch leaves a boolean sibling channel intact', extEdit.dataset.points[0]?.ext?.flagged === false)
check('ext patch does not mutate the source point’s ext object', source.points[0]?.ext?.speed_mps === 5)

// --- a lat/lon/ele/time edit flags derived channels stale on this point AND the next --
ensureBuiltinDerivationsRegistered()
const kinematicSource: Dataset = withPoints(source, [
  { lat: 1, lon: 2, ele: 100, time: 1000 },
  { lat: 1.1, lon: 2.1, ele: 120, time: 2000 },
  { lat: 1.2, lon: 2.2, ele: 140, time: 3000 },
])
const derived = runDerivation('standard-kinematics', kinematicSource)
const kinematicDataset = withPoints(kinematicSource, derived.points)
check('Derivation populates ground_speed_mps to sanity-check the fixture', kinematicDataset.points[1]?.ext?.ground_speed_mps !== undefined)

const positionEdit = executeOperation(kinematicDataset, 'edit-point', { index: 1, fields: { lat: 5 } })
check('Position edit stales distance_m on the edited point', positionEdit.dataset.points[1]?.provenance?.staleChannels?.includes('distance_m') === true)
check('Position edit stales ground_speed_mps on the edited point', positionEdit.dataset.points[1]?.provenance?.staleChannels?.includes('ground_speed_mps') === true)
check('Position edit stales the next point too, which read the edited point as "previous"', positionEdit.dataset.points[2]?.provenance?.staleChannels?.includes('distance_m') === true)
check('Position edit leaves the point before the edit unflagged', positionEdit.dataset.points[0]?.provenance?.staleChannels === undefined)

const nameOnlyEdit = executeOperation(kinematicDataset, 'edit-point', { index: 1, fields: { name: 'waypoint' } })
check('A name-only edit does not stale any derived channel', nameOnlyEdit.dataset.points[1]?.provenance?.staleChannels === undefined)
check('A name-only edit does not touch the next point at all', nameOnlyEdit.dataset.points[2]?.provenance === undefined)

const extOnlyEdit = executeOperation(kinematicDataset, 'edit-point', { index: 1, fields: { ext: { ground_speed_mps: 99 } } })
check('An ext-only edit does not stale any derived channel', extOnlyEdit.dataset.points[1]?.provenance?.staleChannels === undefined)

const rederived = runDerivation('standard-kinematics', positionEdit.dataset)
check('Re-running the derivation clears the stale flags it owns', rederived.points[1]?.provenance?.staleChannels === undefined && rederived.points[2]?.provenance?.staleChannels === undefined)
check('Re-running the derivation still keeps the manual_edit flag (only staleness clears)', rederived.points[1]?.provenance?.qualityFlags?.includes('manual_edit') === true)

// --- out-of-range index is rejected -----------------------------------------
let outOfRangeRejected = false
try {
  executeOperation(source, 'edit-point', { index: source.points.length, fields: { lat: 0 } })
} catch {
  outOfRangeRejected = true
}
check('Out-of-range index is rejected', outOfRangeRejected)

let negativeIndexRejected = false
try {
  executeOperation(source, 'edit-point', { index: -1, fields: { lat: 0 } })
} catch {
  negativeIndexRejected = true
}
check('Negative index is rejected', negativeIndexRejected)

let emptyFieldsRejected = false
try {
  executeOperation(source, 'edit-point', { index: 0, fields: {} })
} catch {
  emptyFieldsRejected = true
}
check('An edit with no field changes is rejected', emptyFieldsRejected)

// --- replay reproduces the same output --------------------------------------
const recipe = buildRecipe('Edit point test', source, [scalarEdit.record])
const replayed = replayRecipe(source, recipe)
check('Recipe replay reproduces the same dataset state', fingerprintDataset(replayed) === fingerprintDataset(scalarEdit.dataset))
check('Operation record captures the input hash', scalarEdit.record.inputDatasetHash === fingerprintDataset(source))
check('Operation record captures the output hash', scalarEdit.record.outputDatasetHash === fingerprintDataset(scalarEdit.dataset))
check('Operation record carries the point-index scope', scalarEdit.record.scope?.indexRange?.start === 0 && scalarEdit.record.scope.indexRange.end === 0)

console.log(`\n${failures === 0 ? 'ALL EDIT POINT OPERATION CHECKS PASSED' : `${failures} EDIT POINT OPERATION CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
