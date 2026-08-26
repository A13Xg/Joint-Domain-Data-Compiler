// Tranche 8 Task 8.1: deterministic synthetic track generation for
// benchmarking at 100k/500k/1M+ points. Deliberately not a test fixture —
// nothing here is checked into test/fixtures, and this module is
// only imported by the benchmark runner, never by the default test suite.
import type { TrackPoint } from '../src/core/model'

/** Mulberry32: a small, fast, seedable PRNG — good enough for deterministic synthetic data, not for anything security-sensitive. */
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SyntheticTrackOptions {
  /** Fraction of samples (0..1) that get a small random gap in addition to the base 1Hz cadence, to approximate real-world irregularity. */
  gapFraction?: number
  seed?: number
}

/** A deterministic, GPS-track-shaped synthetic dataset: a slow spiral climb with jittered elevation and a few extension channels. */
export function generateSyntheticTrack(pointCount: number, options: SyntheticTrackOptions = {}): TrackPoint[] {
  if (!Number.isSafeInteger(pointCount) || pointCount < 0) throw new Error('pointCount must be a non-negative safe integer')
  const gapFraction = options.gapFraction ?? 0.001
  if (!Number.isFinite(gapFraction) || gapFraction < 0 || gapFraction > 1) throw new Error('gapFraction must be between 0 and 1')
  const random = mulberry32(options.seed ?? 42)
  const points: TrackPoint[] = []
  const startTime = 1_700_000_000_000
  let timeMs = startTime
  let bearingDeg = 0

  for (let i = 0; i < pointCount; i++) {
    const radius = 0.01 + (i / pointCount) * 0.2
    bearingDeg = (bearingDeg + 0.7 + random() * 0.2) % 360
    const rad = (bearingDeg * Math.PI) / 180
    const lat = 34.05 + radius * Math.sin(rad)
    const lon = -118.25 + radius * Math.cos(rad)
    const ele = 100 + (i / pointCount) * 500 + (random() - 0.5) * 4

    points.push({
      lat,
      lon,
      ele,
      time: timeMs,
      ext: {
        hdop: 0.6 + random() * 0.6,
        sat: 6 + Math.floor(random() * 6),
      },
    })

    timeMs += 1000 + (random() < gapFraction ? Math.floor(random() * 60_000) : 0)
  }

  return points
}
