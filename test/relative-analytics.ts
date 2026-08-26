import {
  alignTracksByInterpolation,
  alignTracksByNearestTime,
  computeAlongCrossTrack,
  deriveInterpolatedRelativePosition,
  deriveRelativePosition,
  estimateClockDrift,
} from '../src/core/analytics/relative.ts'
import type { TrackPoint } from '../src/core/model.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const reference: TrackPoint[] = [
  { lat: 0, lon: 0, ele: 100, time: 1000 },
  { lat: 0, lon: 0, ele: 100, time: 2000 },
  { lat: 0, lon: 0, ele: 100, time: 3000 },
]
const target: TrackPoint[] = [
  { lat: 0, lon: 0.001, ele: 110, time: 1010 },
  { lat: 0, lon: 0.0005, ele: 105, time: 2010 },
  { lat: 0, lon: 0.00025, ele: 100, time: 3010 },
]

const pairs = alignTracksByNearestTime(reference, target, { toleranceMs: 20 })
check('Nearest-time alignment pairs all samples', pairs.length === 3)
check('Alignment preserves source indices', pairs[1]?.referenceIndex === 1 && pairs[1].targetIndex === 1)
check('Alignment reports signed delta', pairs[0]?.deltaTimeMs === 10)

const samples = deriveRelativePosition(reference, target, pairs)
check('Relative position produces all samples', samples.length === 3)
check('East separation is approximately 111 m', Math.abs((samples[0]?.relativeEastM ?? 0) - 111.319) < 0.2, String(samples[0]?.relativeEastM))
check('North separation is near zero', Math.abs(samples[0]?.relativeNorthM ?? 0) < 0.01)
check('Bearing is east', Math.abs((samples[0]?.bearingDeg ?? 0) - 90) < 0.01)
check('Altitude separation is derived', samples[0]?.altitudeSeparationM === 10)
check('Closure rate is positive while target approaches', (samples[1]?.closureRateMps ?? 0) > 50)

const offsetPairs = alignTracksByNearestTime(reference, target, { toleranceMs: 1, targetTimeOffsetMs: -10 })
check('Manual target time offset aligns exact timestamps', offsetPairs.length === 3 && offsetPairs.every((pair) => pair.deltaTimeMs === 0))

const missingTimePairs = alignTracksByNearestTime([{ lat: 0, lon: 0 }], target, { toleranceMs: 100 })
check('Untimed reference samples are ignored', missingTimePairs.length === 0)

let invalidToleranceRejected = false
try {
  alignTracksByNearestTime(reference, target, { toleranceMs: -1 })
} catch {
  invalidToleranceRejected = true
}
check('Negative alignment tolerance is rejected', invalidToleranceRejected)

// --- Interpolated alignment (Task 5.3 step 2) -------------------------------
{
  // Reference at t=1500, exactly halfway between target samples at t=1000 and t=2000.
  const ref: TrackPoint[] = [{ lat: 0, lon: 0, ele: 100, time: 1500 }]
  const tgt: TrackPoint[] = [
    { lat: 0, lon: 0, ele: 100, time: 1000 },
    { lat: 0, lon: 0.01, ele: 110, time: 2000 },
  ]
  const interpPairs = alignTracksByInterpolation(ref, tgt, { maxBracketGapMs: 5000 })
  check('Interpolated alignment finds one bracketed pair', interpPairs.length === 1)
  check('Interpolation fraction is exactly halfway', interpPairs[0]?.interpolationFraction === 0.5)
  check('Bracket indices point at the surrounding real samples', interpPairs[0]?.targetBeforeIndex === 0 && interpPairs[0]?.targetAfterIndex === 1)

  const interpSamples = deriveInterpolatedRelativePosition(ref, tgt, interpPairs)
  check('Interpolated samples are explicitly marked derived', interpSamples[0]?.derived === true)
  check('Nearest-time samples are not marked derived', samples[0]?.derived === undefined)
  check('Interpolated deltaTimeMs is always zero (aligned to the exact reference time)', interpSamples[0]?.deltaTimeMs === 0)
}

// --- Refuses to extrapolate beyond real target coverage ---------------------
{
  const ref: TrackPoint[] = [{ lat: 0, lon: 0, time: 500 }, { lat: 0, lon: 0, time: 2500 }]
  const tgt: TrackPoint[] = [{ lat: 0, lon: 0, time: 1000 }, { lat: 0, lon: 0, time: 2000 }]
  const interpPairs = alignTracksByInterpolation(ref, tgt, { maxBracketGapMs: 5000 })
  check('A reference time before target coverage starts is not extrapolated', !interpPairs.some((p) => p.referenceIndex === 0))
  check('A reference time after target coverage ends is not extrapolated', !interpPairs.some((p) => p.referenceIndex === 1))
}

// --- Refuses to bridge a large target gap -----------------------------------
{
  const ref: TrackPoint[] = [{ lat: 0, lon: 0, time: 5000 }]
  const tgt: TrackPoint[] = [{ lat: 0, lon: 0, time: 0 }, { lat: 0, lon: 0, time: 10_000 }]
  const tooWide = alignTracksByInterpolation(ref, tgt, { maxBracketGapMs: 5000 })
  check('A bracket gap wider than maxBracketGapMs is refused', tooWide.length === 0)
  const wideEnough = alignTracksByInterpolation(ref, tgt, { maxBracketGapMs: 10_000 })
  check('A bracket gap at or under maxBracketGapMs is accepted', wideEnough.length === 1)
}

// --- Exact-match boundary (fraction 0, no divide-by-zero) -------------------
{
  const ref: TrackPoint[] = [{ lat: 0, lon: 0, time: 1000 }]
  const tgt: TrackPoint[] = [{ lat: 5, lon: 5, ele: 50, time: 1000 }]
  const interpPairs = alignTracksByInterpolation(ref, tgt, { maxBracketGapMs: 5000 })
  check('An exact single-sample time match interpolates cleanly at fraction 0', interpPairs.length === 1 && interpPairs[0]?.interpolationFraction === 0)
}

// --- Antimeridian-safe interpolation -----------------------------------------
{
  const ref: TrackPoint[] = [{ lat: 0, lon: 0, time: 500 }]
  const tgt: TrackPoint[] = [{ lat: 0, lon: 179.9, time: 0 }, { lat: 0, lon: -179.9, time: 1000 }]
  const interpPairs = alignTracksByInterpolation(ref, tgt, { maxBracketGapMs: 5000 })
  const interpSamples = deriveInterpolatedRelativePosition(ref, tgt, interpPairs)
  check('Interpolation across the antimeridian does not wrap through 0 (produces a large, not near-zero, range)', (interpSamples[0]?.horizontalRangeM ?? 0) < 2000)
}

// --- Rejects invalid options --------------------------------------------------
{
  let threw = false
  try { alignTracksByInterpolation(reference, target, { maxBracketGapMs: 0 }) } catch { threw = true }
  check('A non-positive maxBracketGapMs is rejected', threw)
}

// --- Along-track / cross-track decomposition (Task 4.3) ---------------------
{
  // Reference path heads due north (lat increases, lon constant) between two points.
  const pathRef: TrackPoint[] = [
    { lat: 0, lon: 0, ele: 0, time: 1000 },
    { lat: 0.001, lon: 0, ele: 0, time: 2000 },
  ]
  const onPathPair = [{ referenceIndex: 0, targetIndex: 0, referenceTimeMs: 1000, targetTimeMs: 1000, deltaTimeMs: 0 }]

  const onPathTarget: TrackPoint[] = [{ lat: 0.0005, lon: 0, ele: 0, time: 1000 }]
  const onPathSamples = deriveRelativePosition(pathRef, onPathTarget, onPathPair)
  const onPathAC = computeAlongCrossTrack(pathRef, onPathSamples)
  check('A target exactly on the reference path has ~zero cross-track distance', Math.abs(onPathAC[0]?.crossTrackM ?? 999) < 0.05, String(onPathAC[0]?.crossTrackM))
  check('A target ahead on the path has positive along-track distance near 55.66 m', Math.abs((onPathAC[0]?.alongTrackM ?? 0) - 55.66) < 0.5, String(onPathAC[0]?.alongTrackM))

  const eastOffsetTarget: TrackPoint[] = [{ lat: 0, lon: 0.001, ele: 0, time: 1000 }]
  const eastOffsetSamples = deriveRelativePosition(pathRef, eastOffsetTarget, onPathPair)
  const eastOffsetAC = computeAlongCrossTrack(pathRef, eastOffsetSamples)
  check('A target offset due east of a north-heading path has ~zero along-track distance', Math.abs(eastOffsetAC[0]?.alongTrackM ?? 999) < 0.5, String(eastOffsetAC[0]?.alongTrackM))
  check('A target offset due east of a north-heading path has negative cross-track ~ -111.19 m (right side)', Math.abs((eastOffsetAC[0]?.crossTrackM ?? 0) - -111.19) < 0.5, String(eastOffsetAC[0]?.crossTrackM))

  const singlePointRef: TrackPoint[] = [{ lat: 0, lon: 0, time: 1000 }]
  const singlePointSamples = deriveRelativePosition(singlePointRef, onPathTarget, onPathPair)
  const singlePointAC = computeAlongCrossTrack(singlePointRef, singlePointSamples)
  check('A single-point reference path has no determinable tangent and is skipped, not approximated', singlePointAC.length === 0)
}

// --- Clock offset/drift estimation (Task 4.3) --------------------------------
{
  const injectedOffsetMs = 500
  const injectedDriftPerMs = 0.0002 // 200 ppm
  const referenceTimes = [0, 10_000, 20_000, 30_000, 40_000]
  const driftPairs = referenceTimes.map((referenceTimeMs) => ({
    referenceTimeMs,
    targetTimeMs: referenceTimeMs + injectedOffsetMs + injectedDriftPerMs * referenceTimeMs,
  }))
  const drift = estimateClockDrift(driftPairs)
  check('Drift estimation recovers the injected offset', Math.abs(drift.offsetMs - injectedOffsetMs) < 1e-6, String(drift.offsetMs))
  check('Drift estimation recovers the injected drift rate', Math.abs(drift.driftRatePerMs - injectedDriftPerMs) < 1e-9, String(drift.driftRatePerMs))
  check('Drift estimation reports the first reference time as its epoch', drift.referenceEpochMs === 0)
  check('Drift estimation reports the sample count used', drift.sampleCount === driftPairs.length)

  // A constant offset with no drift should estimate a ~zero drift rate.
  const staticPairs = referenceTimes.map((referenceTimeMs) => ({ referenceTimeMs, targetTimeMs: referenceTimeMs + 250 }))
  const staticDrift = estimateClockDrift(staticPairs)
  check('A constant offset with no drift estimates offset ~250 ms', Math.abs(staticDrift.offsetMs - 250) < 1e-9)
  check('A constant offset with no drift estimates a ~zero drift rate', Math.abs(staticDrift.driftRatePerMs) < 1e-12)

  let driftThrew = false
  try { estimateClockDrift([]) } catch { driftThrew = true }
  check('Clock drift estimation refuses an empty pair list', driftThrew)

  // A single pair cannot determine a rate — it should fall back to zero drift, offset equal to the one observed delta.
  const singlePairDrift = estimateClockDrift([{ referenceTimeMs: 1000, targetTimeMs: 1300 }])
  check('A single aligned pair yields zero drift rate and the observed offset', singlePairDrift.driftRatePerMs === 0 && singlePairDrift.offsetMs === 300)
}

console.log(`\n${failures === 0 ? 'ALL RELATIVE ANALYTICS CHECKS PASSED' : `${failures} RELATIVE ANALYTICS CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
