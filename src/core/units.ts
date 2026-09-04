/**
 * Display-unit conversion and formatting.
 *
 * Canonical storage stays degrees, metres, and epoch milliseconds everywhere
 * (AGENTS.md non-negotiable #5) -- nothing here converts stored data, only the
 * strings a readout shows. The unit choice arrives as an argument rather than
 * being read from `state/settings.ts`, so `core/` keeps no dependency on app
 * state and these stay pure functions a Node test can exercise without a
 * `window`. None of the parameters has a default: a call site that forgets to
 * pass the preference is a compile error rather than a readout that silently
 * stays metric while the rest of the view converts.
 */

export type UnitSystem = 'metric' | 'nautical'

export const UNIT_SYSTEM_IDS = ['metric', 'nautical'] as const

export const UNIT_SYSTEM_LABELS: Record<UnitSystem, string> = {
  metric: 'Metric (m, km, m/s)',
  nautical: 'Aviation/marine (ft, NM, kn)',
}

// Written as their defining ratios, not rounded decimal factors (1.94384,
// 3.28084, ...), so a reviewer can check the conversion against the definition
// instead of against a constant they have to look up. The international foot
// and the nautical mile are both exact by definition; the knot follows from the
// nautical mile and an hour.
export const METERS_PER_FOOT = 0.3048
export const METERS_PER_NAUTICAL_MILE = 1852
export const METERS_PER_SECOND_PER_KNOT = METERS_PER_NAUTICAL_MILE / 3600

export function toFeet(meters: number): number {
  return meters / METERS_PER_FOOT
}

export function toNauticalMiles(meters: number): number {
  return meters / METERS_PER_NAUTICAL_MILE
}

export function toKnots(metersPerSecond: number): number {
  return metersPerSecond / METERS_PER_SECOND_PER_KNOT
}

/** Short-unit label for a table that carries its unit in the column header. */
export function distanceUnitLabel(unitSystem: UnitSystem): string {
  return unitSystem === 'nautical' ? 'ft' : 'm'
}

export function speedUnitLabel(unitSystem: UnitSystem): string {
  return unitSystem === 'nautical' ? 'kn' : 'm/s'
}

/** Bare-number conversion, for cells whose unit is stated once in the header. */
export function convertDistance(meters: number, unitSystem: UnitSystem): number {
  return unitSystem === 'nautical' ? toFeet(meters) : meters
}

export function convertSpeed(metersPerSecond: number, unitSystem: UnitSystem): number {
  return unitSystem === 'nautical' ? toKnots(metersPerSecond) : metersPerSecond
}

/**
 * A track-length or separation distance, switching to the larger unit once it
 * passes one whole unit of it (1 km / 1 NM). The threshold is compared on the
 * magnitude so a signed separation (cross-track, vertical) reads the same way
 * either side of zero.
 */
export function formatDistance(meters: number, unitSystem: UnitSystem): string {
  if (!Number.isFinite(meters)) return '—'
  if (unitSystem === 'nautical') {
    if (Math.abs(meters) >= METERS_PER_NAUTICAL_MILE) return `${groupDigits(toNauticalMiles(meters), 2, 2)} NM`
    return `${groupDigits(toFeet(meters), 1, 1)} ft`
  }
  if (Math.abs(meters) >= 1000) return `${groupDigits(meters / 1000, 2, 2)} km`
  return `${groupDigits(meters, 1, 1)} m`
}

/**
 * An altitude or vertical separation. Never switches unit: an altitude in
 * kilometres or nautical miles is not how either audience reads one.
 *
 * `fractionDigits` is a ceiling, not a fixed width -- unlike `formatDistance`,
 * whose two-tier unit switch already bounds how many digits a value can need,
 * these span centimetres of separation to tens of thousands of feet, and a
 * round 300 m reads better as "300 m" than as "300.000 m".
 */
export function formatAltitude(meters: number, unitSystem: UnitSystem, fractionDigits = 0): string {
  if (!Number.isFinite(meters)) return '—'
  const value = unitSystem === 'nautical' ? toFeet(meters) : meters
  return `${groupDigits(value, 0, fractionDigits)} ${distanceUnitLabel(unitSystem)}`
}

/** A speed. `fractionDigits` is a ceiling, for the same reason as `formatAltitude`. */
export function formatSpeed(metersPerSecond: number, unitSystem: UnitSystem, fractionDigits = 1): string {
  if (!Number.isFinite(metersPerSecond)) return '—'
  return `${groupDigits(convertSpeed(metersPerSecond, unitSystem), 0, fractionDigits)} ${speedUnitLabel(unitSystem)}`
}

/** Locale-grouped fixed-precision formatting, so long readouts stay scannable. */
function groupDigits(value: number, minimumFractionDigits: number, maximumFractionDigits: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits, maximumFractionDigits })
}
