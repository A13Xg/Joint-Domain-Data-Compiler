// Shared parameter validation for operation definitions.
//
// `validateParams` runs twice: once against whatever the UI passes, and again
// on replay against JSON that came off disk and may have been hand-edited or
// written by an older build. Both paths must reject malformed input loudly
// rather than coercing it, because a silently-coerced parameter produces a
// dataset whose hash no longer matches the recorded `outputDatasetHash` — a
// failure that surfaces far from its cause.

/**
 * Narrows to a plain object.
 *
 * Arrays, Dates, Maps, Sets and RegExps are all `typeof === 'object'` and
 * would pass a naive null check while behaving nothing like a params record,
 * so the prototype is checked directly (matching `validateEmptyParams` in
 * `basic.ts`).
 */
export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  const prototype = typeof value === 'object' && value !== null ? Object.getPrototypeOf(value) as unknown : false
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} parameters must be a plain object`)
  return value as Record<string, unknown>
}

export function requireFinite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`)
  return value
}

export function requireAtLeast(value: unknown, label: string, minimum: number): number {
  const numeric = requireFinite(value, label)
  if (numeric < minimum) throw new Error(`${label} must be at least ${minimum}`)
  return numeric
}

export function requireGreaterThan(value: unknown, label: string, exclusiveMinimum: number): number {
  const numeric = requireFinite(value, label)
  if (numeric <= exclusiveMinimum) throw new Error(`${label} must be greater than ${exclusiveMinimum}`)
  return numeric
}

export function requireInteger(value: unknown, label: string, minimum: number): number {
  const numeric = requireFinite(value, label)
  if (!Number.isInteger(numeric)) throw new Error(`${label} must be an integer`)
  if (numeric < minimum) throw new Error(`${label} must be at least ${minimum}`)
  return numeric
}

export function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

export function requireOneOf<T extends string>(value: unknown, label: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${label} must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

/**
 * Rejects parameter keys that do not belong to the selected mode.
 *
 * Ignoring a stray key would let two different recorded params replay to the
 * same dataset, which defeats the point of recording them; failing here is
 * both earlier and more legible than the eventual output-hash mismatch.
 */
export function rejectUnknownKeys(record: Record<string, unknown>, label: string, allowed: readonly string[]): void {
  const unexpected = Object.keys(record).filter((key) => !allowed.includes(key) && record[key] !== undefined)
  if (unexpected.length > 0) throw new Error(`${label} does not accept parameter(s): ${unexpected.join(', ')}`)
}
