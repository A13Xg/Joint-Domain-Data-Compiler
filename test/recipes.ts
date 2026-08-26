import type { Dataset } from '../src/core/model.ts'
import { buildRecipe, executeOperation, replayRecipe } from '../src/core/recipes/executor.ts'
import { fingerprintDataset } from '../src/core/recipes/hash.ts'
import type { OperationDefinition } from '../src/core/recipes/model.ts'
import { clearOperationsForTests, registerOperation } from '../src/core/recipes/registry.ts'
import { offsetElevationOperation, shiftTimeOperation, standardKinematicsOperation } from '../src/core/operations/basic.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const source: Dataset = {
  id: 'recipe-source',
  name: 'recipe-source',
  sourceFormat: 'csv',
  points: [
    { lat: 1, lon: 2, ele: 100, time: 1000 },
    { lat: 1.1, lon: 2.1, ele: 120, time: 2000 },
  ],
  warnings: [],
  channels: [],
  createdAt: 0,
}

const elevationOffset: OperationDefinition<{ meters: number }> = {
  id: 'elevation-offset',
  version: 1,
  label: 'Elevation offset',
  description: 'Add a constant elevation offset.',
  validateParams(params: unknown) {
    const meters = (params as { meters?: unknown })?.meters
    if (typeof meters !== 'number' || !Number.isFinite(meters)) throw new Error('meters must be finite')
    return { meters }
  },
  execute({ dataset, params }) {
    return {
      dataset: {
        ...dataset,
        points: dataset.points.map((point) => point.ele === undefined ? { ...point } : { ...point, ele: point.ele + params.meters }),
      },
      summary: `Offset elevation by ${params.meters} m`,
    }
  },
}

clearOperationsForTests()
registerOperation(elevationOffset)

const sourceHash = fingerprintDataset(source)
check('Dataset fingerprints are deterministic', sourceHash === fingerprintDataset(source))

const execution = executeOperation(source, 'elevation-offset', { meters: 5 })
check('Operation returns updated dataset', execution.dataset.points[0]?.ele === 105)
check('Operation does not mutate source', source.points[0]?.ele === 100)
check('Operation record captures input hash', execution.record.inputDatasetHash === sourceHash)
check('Operation record captures output hash', execution.record.outputDatasetHash === fingerprintDataset(execution.dataset))

const recipe = buildRecipe('Offset test', source, [execution.record])
const replayed = replayRecipe(source, recipe)
check('Recipe replay reproduces output', fingerprintDataset(replayed) === fingerprintDataset(execution.dataset))

let mismatchRejected = false
try {
  replayRecipe({ ...source, name: 'changed-source' }, recipe)
} catch {
  mismatchRejected = true
}
check('Changed source is rejected', mismatchRejected)

let versionMismatchRejected = false
try {
  replayRecipe(source, { ...recipe, operations: [{ ...recipe.operations[0]!, operationVersion: 2 }] })
} catch (error) {
  versionMismatchRejected = /version/i.test((error as Error).message)
}
check('Operation version mismatch is rejected with a clear warning', versionMismatchRejected)

registerOperation(standardKinematicsOperation)
const kinematicsExecution = executeOperation(source, 'standard-kinematics', {})
check('Standard kinematics operation derives replayable channels', kinematicsExecution.dataset.channels.includes('ground_speed_mps'))
const kinematicsRecipe = buildRecipe('Kinematics test', source, [kinematicsExecution.record])
check('Standard kinematics recipe replays byte-identical dataset state', fingerprintDataset(replayRecipe(source, kinematicsRecipe)) === fingerprintDataset(kinematicsExecution.dataset))

let invalidParamsRejected = false
try {
  executeOperation(source, 'elevation-offset', { meters: 'five' })
} catch {
  invalidParamsRejected = true
}
check('Invalid operation parameters are rejected', invalidParamsRejected)

clearOperationsForTests()
registerOperation(offsetElevationOperation)
registerOperation(shiftTimeOperation)
const offsetExecution = executeOperation(source, 'offset-elevation', { meters: 12 })
check('Built-in elevation offset records validated parameters', (offsetExecution.record.params as { meters: number }).meters === 12)
const shiftExecution = executeOperation(offsetExecution.dataset, 'shift-time', { seconds: 30 })
const builtInRecipe = buildRecipe('Built-in transforms', source, [offsetExecution.record, shiftExecution.record])
check('Built-in transform recipe replays byte-identical dataset state', fingerprintDataset(replayRecipe(source, builtInRecipe)) === fingerprintDataset(shiftExecution.dataset))

console.log(`\n${failures === 0 ? 'ALL RECIPE CHECKS PASSED' : `${failures} RECIPE CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
