import { lerp, lerpLon } from '../src/core/geoInterpolation.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function close(a: number, b: number, epsilon = 1e-9): boolean {
  return Math.abs(a - b) < epsilon
}

// --- lerp: plain linear interpolation ---
check('t=0 returns a', lerp(10, 20, 0) === 10)
check('t=1 returns b', lerp(10, 20, 1) === 20)
check('t=0.5 returns the midpoint', lerp(10, 20, 0.5) === 15)
check('works with a descending range', lerp(20, 10, 0.25) === 17.5)
check('works with negative values', close(lerp(-10, 10, 0.5), 0))
check('extrapolates past t=1', lerp(0, 10, 2) === 20)
check('extrapolates before t=0', lerp(0, 10, -1) === -10)
check('a === b is a no-op regardless of t', lerp(5, 5, 0.7) === 5)

// --- lerpLon: no antimeridian crossing, should match plain lerp ---
check('no crossing: matches plain lerp at the midpoint', close(lerpLon(10, 20, 0.5), 15))
check('no crossing: matches plain lerp at t=0.25', close(lerpLon(10, 20, 0.25), 12.5))
check('t=0 returns a (already canonical)', close(lerpLon(150, -150, 0), 150))
check('t=1 returns b (already canonical)', close(lerpLon(150, -150, 1), -150))
check('two coincident longitudes are a no-op', close(lerpLon(45, 45, 0.5), 45))

// --- lerpLon: antimeridian crossing eastbound (179 -> -179 is a 2-degree hop through 180, not a 358-degree hop through 0) ---
{
  const midpoint = lerpLon(179, -179, 0.5)
  check('eastbound crossing: midpoint lands at the antimeridian (±180), not near 0', close(Math.abs(midpoint), 180), `${midpoint}`)
  const quarter = lerpLon(179, -179, 0.25)
  check('eastbound crossing: quarter-step moves toward 180, not backward toward 0', quarter > 179 || close(quarter, -180), `${quarter}`)
}

// --- lerpLon: antimeridian crossing westbound (-179 -> 179) ---
{
  const midpoint = lerpLon(-179, 179, 0.5)
  check('westbound crossing: midpoint also lands at the antimeridian', close(Math.abs(midpoint), 180), `${midpoint}`)
}

// --- lerpLon: result is always wrapped into (-180, 180] ---
for (const [a, b, t] of [[170, -170, 0.5], [-170, 170, 0.5], [0, 0, 0.5], [-180, 180, 0.5]] as const) {
  const result = lerpLon(a, b, t)
  check(`result for lerpLon(${a}, ${b}, ${t}) stays within [-180, 180]`, result >= -180 && result <= 180, `${result}`)
}

// --- lerpLon never takes the long way around for a small delta near the seam ---
{
  const result = lerpLon(-179.9, 179.9, 0.5)
  check('a 0.2-degree seam crossing interpolates the short way, not the long way', close(Math.abs(result), 180, 0.01), `${result}`)
}

console.log(`\n${failures === 0 ? 'ALL GEO INTERPOLATION CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
