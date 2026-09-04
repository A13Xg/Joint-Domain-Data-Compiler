import { MOTION_PROFILES, MOTION_PROFILE_IDS } from '../src/core/operations/motionProfiles.ts'
import { angularChannelsOf, collectRealNeighbors, firstProfileViolation, fitChannelsAtTimes, reconstructionKnots, type TimedPoint } from '../src/core/operations/trackReconstruction.ts'
import type { TrackPoint } from '../src/core/model.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function point(lat: number, lon: number, time: number, extra: Partial<TimedPoint> = {}): TimedPoint {
  return { lat, lon, time, ...extra }
}

// ---------------------------------------------------------------- motionProfiles

check('every declared id has a matching profile record', MOTION_PROFILE_IDS.every((id) => MOTION_PROFILES[id].id === id))
check('aircraft, ground, and marine use spline interpolation', ['aircraft', 'ground', 'marine'].every((id) => MOTION_PROFILES[id as keyof typeof MOTION_PROFILES].interpolation === 'spline'))
check('unconstrained (vector-only) uses linear interpolation', MOTION_PROFILES.unconstrained.interpolation === 'linear')
check('unconstrained has no finite ceiling on any axis', [
  MOTION_PROFILES.unconstrained.maxGroundSpeedMps,
  MOTION_PROFILES.unconstrained.maxVerticalSpeedMps,
  MOTION_PROFILES.unconstrained.maxTurnRateDps,
  MOTION_PROFILES.unconstrained.maxHorizontalAccelMps2,
].every((value) => !Number.isFinite(value)))
check('aircraft allows a higher ground speed than ground or marine', MOTION_PROFILES.aircraft.maxGroundSpeedMps > MOTION_PROFILES.ground.maxGroundSpeedMps
  && MOTION_PROFILES.ground.maxGroundSpeedMps > MOTION_PROFILES.marine.maxGroundSpeedMps)
check('ground vehicles turn tighter than aircraft', MOTION_PROFILES.ground.maxTurnRateDps > MOTION_PROFILES.aircraft.maxTurnRateDps)

// ---------------------------------------------------------------- reconstructionKnots

{
  const left = point(0, 0, 0)
  const right = point(1, 1, 1000)
  const context = [point(-1, -1, -1000), left, right, point(2, 2, 2000)]
  const spline = reconstructionKnots(context, left, right, MOTION_PROFILES.aircraft)
  check('spline profile keeps the full context as knots', spline === context)
  const linear = reconstructionKnots(context, left, right, MOTION_PROFILES.unconstrained)
  check('linear (vector-only) profile narrows to just the two endpoints', linear.length === 2 && linear[0] === left && linear[1] === right)
}

// ---------------------------------------------------------------- collectRealNeighbors

{
  const timed: TimedPoint[] = [0, 1, 2, 3, 4, 5].map((i) => point(i, i, i * 1000))
  const backward = collectRealNeighbors(timed, 3, -1, 2)
  check('walking backward collects the requested count in chronological order', backward.length === 2 && backward[0]!.time === 2000 && backward[1]!.time === 3000, `${backward.map((p) => p.time)}`)
  const forward = collectRealNeighbors(timed, 2, 1, 2)
  check('walking forward collects the requested count in order', forward.length === 2 && forward[0]!.time === 2000 && forward[1]!.time === 3000, `${forward.map((p) => p.time)}`)
  const clampedAtEdge = collectRealNeighbors(timed, 1, -1, 5)
  check('walking past the start of the array returns fewer than requested, not an error', clampedAtEdge.length === 2, `${clampedAtEdge.length}`)
  const empty = collectRealNeighbors(timed, -1, -1, 3)
  check('starting outside the array bounds returns an empty list', empty.length === 0)
}
{
  const synthetic = point(1, 1, 1000, { provenance: { qualityFlags: ['interpolated'] } })
  const real = point(2, 2, 2000)
  const timed: TimedPoint[] = [point(0, 0, 0), synthetic, real, point(3, 3, 3000)]
  const backward = collectRealNeighbors(timed, 2, -1, 2)
  check('a synthesized (interpolated) point is skipped, not collected as a fit knot', backward.every((p) => p.time !== 1000))
  check('walking past a synthesized point still reaches the next real one', backward.some((p) => p.time === 0))
  const notional = point(1, 1, 1000, { provenance: { qualityFlags: ['notional'] } })
  const timedNotional: TimedPoint[] = [point(0, 0, 0), notional, real]
  const skipNotional = collectRealNeighbors(timedNotional, 2, -1, 2)
  check('a notional point is skipped the same way an interpolated one is', skipNotional.every((p) => p.time !== 1000))
}

// ---------------------------------------------------------------- angularChannelsOf

{
  const points: TrackPoint[] = [{ lat: 0, lon: 0, ext: { heading_deg: 10, speed_mps: 5 } }]
  const angular = angularChannelsOf(points, undefined)
  check('a heading_deg-named channel is treated as angular by the name heuristic', angular.has('heading_deg'))
  check('an unrelated numeric channel is not treated as angular', !angular.has('speed_mps'))
}

// ---------------------------------------------------------------- fitChannelsAtTimes

{
  const knots: TimedPoint[] = [point(0, 0, 0, { ele: 100 }), point(10, 20, 10_000, { ele: 200 })]
  const [mid] = fitChannelsAtTimes(knots, [5000], new Set())
  check('a two-knot fit is a linear interpolation at the midpoint', Math.abs(mid!.lat - 5) < 1e-6 && Math.abs(mid!.lon - 10) < 1e-6, `lat=${mid!.lat} lon=${mid!.lon}`)
  check('elevation interpolates the same way when every knot carries it', Math.abs(mid!.ele! - 150) < 1e-6, `${mid!.ele}`)
  check('a fitted point is flagged interpolated', mid!.provenance?.qualityFlags?.includes('interpolated') === true)
  check('a fitted point keeps the query timestamp', mid!.time === 5000)
}
{
  // ele present on only one knot: nothing honest to interpolate between, so it's left off.
  const knots: TimedPoint[] = [point(0, 0, 0, { ele: 100 }), point(0, 0, 10_000)]
  const [mid] = fitChannelsAtTimes(knots, [5000], new Set())
  check('elevation missing from any knot is left undefined rather than guessed', mid!.ele === undefined)
}
{
  // ext channel present on only one knot is dropped from the fit; present on all knots, it's fit.
  const knots: TimedPoint[] = [
    point(0, 0, 0, { ext: { speed_mps: 10, partial: 1 } }),
    point(0, 0, 10_000, { ext: { speed_mps: 20 } }),
  ]
  const [mid] = fitChannelsAtTimes(knots, [5000], new Set())
  check('a channel present on every knot is fit', Math.abs((mid!.ext?.speed_mps as number) - 15) < 1e-6, `${mid!.ext?.speed_mps}`)
  check('a channel missing from one knot is dropped, not carried from the other', mid!.ext?.partial === undefined)
}
{
  // Angular wrap: heading 350 -> 10 should interpolate the short way (through 360/0), landing near 0, not near 180.
  const knots: TimedPoint[] = [
    point(0, 0, 0, { ext: { heading_deg: 350 } }),
    point(0, 0, 10_000, { ext: { heading_deg: 10 } }),
  ]
  const [mid] = fitChannelsAtTimes(knots, [5000], new Set(['heading_deg']))
  const heading = mid!.ext?.heading_deg as number
  const distanceFromZero = Math.min(heading, 360 - heading)
  check('an angular channel interpolates the short way across the 0/360 seam', distanceFromZero < 5, `${heading}`)
}

// ---------------------------------------------------------------- firstProfileViolation

{
  const slow: TimedPoint[] = [point(0, 0, 0), point(0.0001, 0, 10_000)] // ~11m in 10s, trivially slow
  check('a sequence well within every limit reports no violation', firstProfileViolation(slow, MOTION_PROFILES.aircraft) === null)
}
{
  const fast: TimedPoint[] = [point(0, 0, 0), point(1, 0, 1000)] // ~111km in 1s
  const violation = firstProfileViolation(fast, MOTION_PROFILES.marine)
  check('exceeding the ground-speed ceiling is reported', violation !== null && violation.includes('ground speed'), `${violation}`)
}
{
  const climbing: TimedPoint[] = [point(0, 0, 0, { ele: 0 }), point(0, 0, 1000, { ele: 500 })] // 500 m/s vertical
  const violation = firstProfileViolation(climbing, MOTION_PROFILES.marine)
  check('exceeding the vertical-speed ceiling is reported', violation !== null && violation.includes('vertical speed'), `${violation}`)
}
{
  // A 90-degree turn (north leg, then east leg) with each leg's own speed
  // (~27.8 m/s) safely under marine's 40 m/s ceiling, but the turn itself
  // (90 degrees / 4 seconds = 22.5 deg/s) over marine's 20 deg/s ceiling —
  // isolates the turn-rate check from the speed check that would otherwise
  // fire first and mask it.
  const turning: TimedPoint[] = [point(0, 0, 0), point(0.001, 0, 4000), point(0.001, 0.001, 8000)]
  const violation = firstProfileViolation(turning, MOTION_PROFILES.marine)
  check('a sharp turn within the speed ceiling still trips the turn-rate ceiling', violation !== null && violation.includes('turn rate'), `${violation}`)
  check('the same turn passes under a profile with a generous turn-rate ceiling', firstProfileViolation(turning, MOTION_PROFILES.aircraft) === null)
}
check('a non-positive time delta between points is skipped rather than dividing by zero', firstProfileViolation([point(0, 0, 1000), point(0, 0, 1000)], MOTION_PROFILES.aircraft) === null)
{
  // A stationary segment (distance 0) resets the bearing rather than treating undefined-to-defined as a spurious turn.
  const stationaryThenMoving: TimedPoint[] = [point(0, 0, 0), point(0, 0, 1000), point(0.0001, 0, 2000)]
  const violation = firstProfileViolation(stationaryThenMoving, MOTION_PROFILES.aircraft)
  check('a stationary segment does not fabricate a turn-rate violation on the next leg', violation === null, `${violation}`)
}
check('the unconstrained profile never reports a violation regardless of speed', firstProfileViolation([point(0, 0, 0), point(10, 10, 1)], MOTION_PROFILES.unconstrained) === null)

console.log(`\n${failures === 0 ? 'ALL TRACK RECONSTRUCTION CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
