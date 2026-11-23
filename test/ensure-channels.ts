// Regression test for the bug caught in Phase 2 review: ensureKinematicsChannels
// must never overwrite a channel a dataset already carries (e.g. NMEA's
// GPS-observed heading_deg), even when some other standard-kinematics output
// channel is absent. See docs/superpowers/specs/2026-09-27-jddc-suite-design.md §11.
import type { Dataset } from '../src/core/model'
import { ensureKinematicsChannels, STANDARD_KINEMATICS_CHANNELS } from '../src/core/analytics/ensureChannels'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const basePoints = [
  { lat: 34, lon: -117, ele: 100, time: 0 },
  { lat: 34.01, lon: -117.01, ele: 110, time: 10_000 },
  { lat: 34.02, lon: -117.02, ele: 120, time: 20_000 },
]

// Simulates an NMEA import: heading_deg observed from a VTG sentence, but
// no turn_rate_dps (NMEA never carries it) — a partial, real channel set.
const partialDataset: Dataset = {
  id: 'nmea-track',
  name: 'NMEA track',
  sourceFormat: 'nmea',
  points: basePoints.map((p) => ({ ...p, ext: { heading_deg: 271.5 } })),
  warnings: [],
  channels: ['heading_deg'],
  createdAt: 1000,
}

const result = ensureKinematicsChannels(partialDataset)
check(
  'a dataset with a partial (but real) channel set is returned unchanged, not derived over',
  result === partialDataset,
)
check(
  'the observed heading_deg value is not replaced with a derived estimate',
  result.points.every((p) => p.ext?.heading_deg === 271.5),
)
check('turn_rate_dps is not fabricated to fill the gap', result.points.every((p) => p.ext?.turn_rate_dps === undefined))

// A dataset with none of the standard channels should have them derived.
const emptyDataset: Dataset = {
  id: 'raw-track',
  name: 'Raw track',
  sourceFormat: 'csv',
  points: basePoints,
  warnings: [],
  channels: [],
  createdAt: 1000,
}
const derived = ensureKinematicsChannels(emptyDataset)
check(
  'a dataset with none of the standard channels gets them all derived',
  STANDARD_KINEMATICS_CHANNELS.every((channel) => derived.channels.includes(channel)),
)
check('derivation actually computed a numeric ground_speed_mps', typeof derived.points[1]?.ext?.ground_speed_mps === 'number')

console.log(`\n${failures === 0 ? 'ALL ENSURE-CHANNELS CHECKS PASSED' : `${failures} ENSURE-CHANNELS CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
