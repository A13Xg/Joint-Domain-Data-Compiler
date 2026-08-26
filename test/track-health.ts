import type { Dataset, TrackPoint } from '../src/core/model.ts'
import { computeTrackHealth } from '../src/core/quality/trackHealth.ts'
import { DEFAULT_TRACK_HEALTH_CONFIG } from '../src/core/quality/trackHealthConfig.ts'
import type { TrackHealthCheckId, TrackHealthReport } from '../src/core/quality/trackHealthTypes.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const START = 1_700_000_000_000
const COUNT = 240 // 240 samples at 10 s = 40 minutes

/**
 * A well-formed flight: smooth climb well above the 1000 ft floor, cruise, and a symmetric
 * descent back to the departure altitude, moving steadily throughout.
 */
function flight(): TrackPoint[] {
  const points: TrackPoint[] = []
  for (let index = 0; index < COUNT; index++) {
    const fraction = index / (COUNT - 1)
    points.push({
      lat: 40 + fraction * 0.5,
      lon: -100 + fraction * 0.5,
      ele: 50 + 2950 * Math.sin(Math.PI * fraction) ** 2,
      time: START + index * 10_000,
      ext: { ground_speed_mps: 150 },
    })
  }
  return points
}

function without(points: TrackPoint[], key: 'ele' | 'time'): TrackPoint[] {
  return points.map((point) => {
    const copy = { ...point }
    delete copy[key]
    return copy
  })
}

function dataset(points: TrackPoint[], overrides: Partial<Dataset> = {}): Dataset {
  return { id: 'ds', name: 'fixture', sourceFormat: 'gpx', points, warnings: [], channels: [], createdAt: 0, ...overrides }
}

function statusOf(report: TrackHealthReport, id: TrackHealthCheckId): string {
  return report.checks.find((entry) => entry.id === id)?.status ?? 'missing'
}

// --- the healthy baseline --------------------------------------------------
const healthy = computeTrackHealth(dataset(flight()))
check('A well-formed flight is scored', healthy.status === 'scored')
check('A well-formed flight scores 100', healthy.score === 100)
for (const id of ['schema-parse', 'altitude-profile', 'speed-envelope', 'time-order-span', 'outlier', 'stagnant'] as const) {
  check(`A well-formed flight passes ${id}`, statusOf(healthy, id) === 'pass')
}
// Guards the weight/points mix-up that made a flawless flight score 21.
const weighted = healthy.checks.filter((entry) => entry.weight > 0)
check('Weighted checks sum to 100', weighted.reduce((sum, entry) => sum + entry.weight, 0) === 100)
check('Each check awards exactly its own weight', weighted.every((entry) => entry.pointsAwarded === entry.weight))
check('The schema gate carries no weight', healthy.checks.find((entry) => entry.id === 'schema-parse')?.weight === 0)

// --- N/A handling and re-weighting ----------------------------------------
const noElevation = computeTrackHealth(dataset(without(flight(), 'ele')))
check('Altitude is N/A without elevation data', statusOf(noElevation, 'altitude-profile') === 'na')
check('An N/A check is dropped from the denominator, so the rest still reach 100', noElevation.score === 100)

const noTime = computeTrackHealth(dataset(without(flight(), 'time')))
check('Speed is N/A without timestamps', statusOf(noTime, 'speed-envelope') === 'na')
check('Stagnation is N/A without timestamps', statusOf(noTime, 'stagnant') === 'na')
check('Time order is N/A without timestamps', statusOf(noTime, 'time-order-span') === 'na')

// --- the blocking gate -----------------------------------------------------
const mostlyInvalid = flight().map((point, index) => (index % 3 === 0 ? point : { ...point, lat: 999, lon: 999 }))
const blocked = computeTrackHealth(dataset(mostlyInvalid))
check('Mostly-invalid coordinates block the scan', blocked.status === 'blocked')
check('A blocked scan reports no numeric score', blocked.score === null)
check('A blocked scan explains itself', (blocked.blockingReason ?? '').length > 0)
check('A blocked scan still reports the other checks', blocked.checks.length === healthy.checks.length)

const empty = computeTrackHealth(dataset([]))
check('An empty dataset is blocked rather than scored', empty.status === 'blocked' && empty.score === null)

// --- individual check failures --------------------------------------------
const outOfOrder = flight()
outOfOrder[100] = { ...outOfOrder[100]!, time: START }
check('Out-of-order timestamps fail the time check', statusOf(computeTrackHealth(dataset(outOfOrder)), 'time-order-span') === 'fail')

const tooShort = flight().slice(0, 30) // 30 samples at 10 s = 5 minutes
check('A span under 10 minutes fails the time check', statusOf(computeTrackHealth(dataset(tooShort)), 'time-order-span') === 'fail')

const tooLong = flight().map((point, index) => ({ ...point, time: START + index * 300_000 })) // 20 hours
check('A span over 12 hours fails the time check', statusOf(computeTrackHealth(dataset(tooLong)), 'time-order-span') === 'fail')

const neverClimbs = flight().map((point) => ({ ...point, ele: 100 }))
check('A track that never leaves the ground fails the altitude check', statusOf(computeTrackHealth(dataset(neverClimbs)), 'altitude-profile') === 'fail')

const noDescent = flight().map((point, index) => ({ ...point, ele: 50 + (index / (COUNT - 1)) * 2950 }))
check('A track that ends at altitude fails the altitude check', statusOf(computeTrackHealth(dataset(noDescent)), 'altitude-profile') === 'fail')

const supersonic = flight()
for (let index = 100; index < 130; index++) supersonic[index] = { ...supersonic[index]!, ext: { ground_speed_mps: 900 } }
check('Sustained speed above Mach 2 fails the speed check', statusOf(computeTrackHealth(dataset(supersonic)), 'speed-envelope') === 'fail')

// A brief dip through the floor is what takeoff and landing actually look like, so the
// tolerance must absorb it rather than failing every real flight.
const briefDip = flight()
briefDip[120] = { ...briefDip[120]!, ext: { ground_speed_mps: 2 } }
check('A single slow sample does not fail the speed check', statusOf(computeTrackHealth(dataset(briefDip)), 'speed-envelope') === 'pass')

// A recording that starts with the aircraft parked. The movement window alone does not
// save this one: a short burst above the floor early in the file (engine start, GPS noise
// while stationary) opens the window across the whole parked stretch, so without the
// lead-in skip those samples spend the check's violation budget on normal operation.
const parkedStart = flight()
const leadIn = Math.floor(COUNT * 0.2)
for (let index = 0; index < leadIn; index++) {
  parkedStart[index] = { ...parkedStart[index]!, lat: 40, lon: -100, ext: { ground_speed_mps: 0 } }
}
for (let index = 3; index < 6; index++) {
  parkedStart[index] = { ...parkedStart[index]!, ext: { ground_speed_mps: 150 } }
}
const parkedReport = computeTrackHealth(dataset(parkedStart))
check('A parked lead-in does not fail the speed check', statusOf(parkedReport, 'speed-envelope') === 'pass')
// Pins that the skip is what saves this track, not the movement window on its own.
const withoutSkip = computeTrackHealth(dataset(parkedStart), {
  ...DEFAULT_TRACK_HEALTH_CONFIG,
  speedEnvelope: { ...DEFAULT_TRACK_HEALTH_CONFIG.speedEnvelope, leadInIgnoreFraction: 0 },
})
check('Without the lead-in skip the same parked track fails', statusOf(withoutSkip, 'speed-envelope') === 'fail')
const parkedCheck = parkedReport.checks.find((entry) => entry.id === 'speed-envelope')
check('The speed check says which lead-in it ignored', parkedCheck?.details?.some((line) => line.includes('20%')) === true)
check('The speed check scores from the lead-in boundary onward', (parkedCheck?.measurements?.scoredFromIndex ?? -1) >= leadIn)

// The skip is a scoring window, not an amnesty: a slow stretch after the lead-in still fails.
const slowAfterLeadIn = flight()
for (let index = leadIn + 10; index < leadIn + 90; index++) {
  slowAfterLeadIn[index] = { ...slowAfterLeadIn[index]!, lat: 40.1, lon: -99.9, ext: { ground_speed_mps: 1 } }
}
check('A slow stretch past the lead-in still fails the speed check', statusOf(computeTrackHealth(dataset(slowAfterLeadIn)), 'speed-envelope') === 'fail')

const stalled = flight()
for (let index = 100; index < 160; index++) {
  stalled[index] = { ...stalled[index]!, lat: 40.2, lon: -99.8, ext: { ground_speed_mps: 150 } }
}
check('Ten minutes inside a quarter mile fails the stagnation check', statusOf(computeTrackHealth(dataset(stalled)), 'stagnant') === 'fail')

const spiked = flight()
for (const index of [40, 80, 120, 160, 200]) spiked[index] = { ...spiked[index]!, lat: spiked[index]!.lat + 3 }
const spikedReport = computeTrackHealth(dataset(spiked))
check('Scattered position spikes are flagged as outliers', (spikedReport.checks.find((entry) => entry.id === 'outlier')?.flags.length ?? 0) > 0)

// --- drill-down targets ----------------------------------------------------
const flagged = computeTrackHealth(dataset(outOfOrder)).checks.find((entry) => entry.id === 'time-order-span')
check('A failing check offers a drill-down target', (flagged?.flags.length ?? 0) > 0)
check('Drill-down indices address the source points', flagged?.flags[0]?.pointIndex === 100)

// Elevation-sparse tracks previously reported filtered-array positions, which pointed the map
// at the wrong sample. Every flag must index the dataset the caller passed in.
const sparse = flight().map((point, index) => (index % 10 === 0 ? { ...point, ele: undefined } : point))
const sparseReport = computeTrackHealth(dataset(sparse), { ...DEFAULT_TRACK_HEALTH_CONFIG, altitudeProfile: { ...DEFAULT_TRACK_HEALTH_CONFIG.altitudeProfile, minElevationCoverage: 0.5 } })
const everyFlag = sparseReport.checks.flatMap((entry) => entry.flags)
check('Every flag indexes a real source point', everyFlag.every((flag) => {
  if (flag.pointIndex !== undefined) return flag.pointIndex >= 0 && flag.pointIndex < sparse.length
  if (flag.range) return flag.range.start >= 0 && flag.range.end < sparse.length && flag.range.start <= flag.range.end
  return false
}))

// --- progress reporting ----------------------------------------------------
const steps: number[] = []
computeTrackHealth(dataset(flight()), DEFAULT_TRACK_HEALTH_CONFIG, (completed, total) => {
  steps.push(completed)
  if (total !== 6) failures++
})
check('Progress is reported once per check plus a final step', steps.length === 7)
check('Progress ends at the total', steps[steps.length - 1] === 6)

console.log(`\n${failures === 0 ? 'ALL TRACK HEALTH CHECKS PASSED' : `${failures} TRACK HEALTH CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
