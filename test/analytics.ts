import type { Dataset } from '../src/core/model.ts'
import { standardKinematicsDerivation } from '../src/core/analytics/kinematics.ts'
import {
  clearDerivationsForTests,
  getDerivation,
  listDerivations,
  registerDerivation,
  runDerivation,
} from '../src/core/analytics/registry.ts'
import { ensureBuiltinDerivationsRegistered } from '../src/core/analytics/bootstrap.ts'

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

// Independently-computed distance/heading regression values (Task 3.1): these
// pin the exact haversine-distance and bearing formulas this engine uses —
// the same formulas the now-removed duplicate `deriveKinematics` in
// transforms.ts used — so consolidating onto this single engine did not
// silently change distance/heading behavior relied on elsewhere in the app.
check('Cumulative distance matches an independently computed haversine value', Math.abs((result.points[1]?.ext?.distance_m as number) - 111.195) < 0.001)
check('Cumulative distance accumulates across points', Math.abs((result.points[2]?.ext?.distance_m as number) - 222.39) < 0.001)
check('Heading matches an independently computed bearing (due east)', result.points[1]?.ext?.heading_deg === 90)
check('Heading matches an independently computed bearing (due north)', result.points[2]?.ext?.heading_deg === 0)

let duplicateRejected = false
try {
  registerDerivation(standardKinematicsDerivation)
} catch {
  duplicateRejected = true
}
check('Duplicate derivation registration is rejected', duplicateRejected)

let missingInputRejected = false
try {
  const untimedPoints = dataset.points.map((point) => ({ lat: point.lat, lon: point.lon, ele: point.ele }))
  runDerivation('standard-kinematics', { ...dataset, points: untimedPoints })
} catch {
  missingInputRejected = true
}
check('Missing required inputs are rejected', missingInputRejected)

// --- Product bootstrap wiring (Task 3.1: this is what App.tsx calls) -------
clearDerivationsForTests()
ensureBuiltinDerivationsRegistered()
check('Bootstrap registers the standard kinematics derivation', getDerivation('standard-kinematics') !== null)
let bootstrapIdempotent = true
try {
  ensureBuiltinDerivationsRegistered()
} catch {
  bootstrapIdempotent = false
}
check('Bootstrap is idempotent across repeated calls', bootstrapIdempotent)

console.log(`\n${failures === 0 ? 'ALL ANALYTICS CHECKS PASSED' : `${failures} ANALYTICS CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
