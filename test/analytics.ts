import type { Dataset } from '../src/core/model.ts'
import { standardKinematicsDerivation } from '../src/core/analytics/kinematics.ts'
import {
  clearDerivationsForTests,
  getDerivation,
  listDerivations,
  registerDerivation,
  runDerivation,
} from '../src/core/analytics/registry.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const dataset: Dataset = {
  id: 'analytics-test',
  name: 'analytics-test',
  sourceFormat: 'csv',
  points: [
    { lat: 0, lon: 0, ele: 100, time: 1000 },
    { lat: 0, lon: 0.001, ele: 110, time: 2000 },
    { lat: 0.001, lon: 0.001, ele: 120, time: 3000 },
  ],
  warnings: [],
  channels: [],
  createdAt: 0,
}

clearDerivationsForTests()
registerDerivation(standardKinematicsDerivation)
check('Registry returns a registered derivation', getDerivation('standard-kinematics')?.version === 1)
check('Registry list is deterministic', listDerivations()[0]?.id === 'standard-kinematics')

const result = runDerivation('standard-kinematics', dataset)
check('Derivation preserves point count', result.points.length === dataset.points.length)
check('Derivation does not mutate source points', dataset.points[1]?.ext === undefined)
check('Ground speed is derived', typeof result.points[1]?.ext?.ground_speed_mps === 'number')
check('Vertical speed is derived', result.points[1]?.ext?.vertical_speed_mps === 10)
check('Sample interval is derived', result.points[1]?.ext?.sample_interval_s === 1)
check('Acceleration is derived after two intervals', typeof result.points[2]?.ext?.horizontal_accel_mps2 === 'number')
check('Output channel metadata includes units', result.outputChannels.some((channel) => channel.id === 'turn_rate_dps' && channel.unit === 'deg/s'))

let duplicateRejected = false
try {
  registerDerivation(standardKinematicsDerivation)
} catch {
  duplicateRejected = true
}
check('Duplicate derivation registration is rejected', duplicateRejected)

let missingInputRejected = false
try {
  runDerivation('standard-kinematics', { ...dataset, points: dataset.points.map(({ time: _time, ...point }) => point) })
} catch {
  missingInputRejected = true
}
check('Missing required inputs are rejected', missingInputRejected)

console.log(`\n${failures === 0 ? 'ALL ANALYTICS CHECKS PASSED' : `${failures} ANALYTICS CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
