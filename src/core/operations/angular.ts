// Seam-safe handling of wrapping angular quantities.
//
// Longitude and heading-like channels are cyclic, not linear. Interpolating
// their raw values treats 359° → 1° as a ~358° swing through 180° instead of
// the true ~2° crossing through the seam, which is a coordinate-math
// correctness bug (ARCHITECTURE.md §10) rather than a cosmetic one. Unwrap
// before fitting, re-wrap after.
//
// Extracted from distance-resample.ts so gap filling uses the same
// implementation rather than a second copy that can drift.

import type { ChannelDefinition } from '../model'

/** Unwraps a −180..180 longitude series into a continuous one. */
export function unwrapLongitudes(lons: readonly number[]): number[] {
  return unwrapSeries(lons)
}

export function wrapLongitude(value: number): number {
  return ((value + 540) % 360) - 180
}

/** Unwraps a 0..360 heading/bearing series into a continuous one. */
export function unwrapDegrees(values: readonly number[]): number[] {
  return unwrapSeries(values)
}

export function wrapDegrees(value: number): number {
  return ((value % 360) + 360) % 360
}

/**
 * True for channels whose values wrap at the 0/360 seam.
 *
 * Declared channel metadata wins; the name heuristic is the fallback for
 * datasets that have none, such as CSV extension columns.
 */
export function isAngularChannel(channel: string, metadataChannels: readonly ChannelDefinition[] | undefined): boolean {
  const declared = metadataChannels?.find((definition) => definition.id === channel)
  if (declared?.semanticType === 'heading' || declared?.semanticType === 'bearing') return true
  return /^(heading|bearing|course|track)(_|$)/i.test(channel)
}

/** Shortest signed angular difference, in −180..180. */
export function shortestAngleDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180
}

/** Initial great-circle bearing from `a` to `b`, in 0..360. */
export function initialBearingDegrees(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180
  const y = Math.sin((bLon - aLon) * rad) * Math.cos(bLat * rad)
  const x = Math.cos(aLat * rad) * Math.sin(bLat * rad) - Math.sin(aLat * rad) * Math.cos(bLat * rad) * Math.cos((bLon - aLon) * rad)
  return (Math.atan2(y, x) / rad + 360) % 360
}

/** Accumulates shortest-path deltas so a cyclic series becomes monotone-fittable. */
function unwrapSeries(values: readonly number[]): number[] {
  if (values.length === 0) return []
  const out: number[] = [values[0]!]
  for (let index = 1; index < values.length; index++) {
    out.push(out[index - 1]! + shortestAngleDelta(values[index - 1]!, values[index]!))
  }
  return out
}
