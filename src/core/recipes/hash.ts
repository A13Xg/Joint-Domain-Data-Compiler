import type { Dataset, TrackPoint } from '../model'

/**
 * Deterministic non-cryptographic dataset fingerprint for recipe guards.
 * This is intended to detect accidental source changes, not resist tampering.
 */
export function fingerprintDataset(dataset: Dataset): string {
  let hash = 2166136261
  hash = update(hash, dataset.sourceFormat)
  hash = update(hash, dataset.name)
  hash = update(hash, String(dataset.points.length))
  for (const point of dataset.points) hash = fingerprintPoint(hash, point)
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function fingerprintPoint(hash: number, point: TrackPoint): number {
  hash = update(hash, canonicalNumber(point.lat))
  hash = update(hash, canonicalNumber(point.lon))
  hash = update(hash, point.ele === undefined ? '' : canonicalNumber(point.ele))
  hash = update(hash, point.time === undefined ? '' : String(point.time))
  if (point.ext) {
    for (const key of Object.keys(point.ext).sort()) {
      hash = update(hash, key)
      hash = update(hash, String(point.ext[key]))
    }
  }
  return hash
}

function canonicalNumber(value: number): string {
  return Number.isFinite(value) ? value.toPrecision(15) : String(value)
}

function update(seed: number, value: string): number {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
