// Small shared linear-interpolation helpers used by both notional gap-fill
// (src/core/derivations/notionalSmoothing.ts) and interpolated comparison
// alignment (src/core/analytics/relative.ts), so the antimeridian-safe
// longitude handling exists in exactly one place.
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Shortest-path longitude interpolation: crossing the antimeridian interpolates the short way (e.g. 179.9 -> -179.9 passes through 180, not through 0). */
export function lerpLon(a: number, b: number, t: number): number {
  let delta = b - a
  if (delta > 180) delta -= 360
  else if (delta < -180) delta += 360
  const result = a + delta * t
  return ((result + 540) % 360) - 180
}
