// Pure geometry behind the map's scale bar, offline grid and measure tool, kept
// out of MapView so each can be tested without a browser.
import { haversineMeters } from '../../core/model'
import { initialBearingDegrees } from '../../core/operations/angular'
import { METERS_PER_NAUTICAL_MILE, type UnitSystem } from '../../core/units'

const METERS_PER_FOOT = 0.3048

/**
 * The longest "round" length (1, 2 or 5 × 10ⁿ of the display unit) that fits in
 * `maxPx` at the given ground resolution. Nautical readouts switch from feet to
 * nautical miles once a whole nautical mile fits, matching formatDistance.
 */
export function niceScale(metersPerPixel: number, maxPx: number, unitSystem: UnitSystem): { widthPx: number; label: string } | null {
  if (!(metersPerPixel > 0) || !(maxPx > 0) || !Number.isFinite(metersPerPixel)) return null
  const maxMeters = metersPerPixel * maxPx
  const [unitMeters, unit] = unitSystem === 'nautical'
    ? (maxMeters >= METERS_PER_NAUTICAL_MILE ? [METERS_PER_NAUTICAL_MILE, 'NM'] as const : [METERS_PER_FOOT, 'ft'] as const)
    : (maxMeters >= 1000 ? [1000, 'km'] as const : [1, 'm'] as const)
  const value = roundDown125(maxMeters / unitMeters)
  if (value <= 0) return null
  return { widthPx: (value * unitMeters) / metersPerPixel, label: `${formatNice(value)} ${unit}` }
}

function roundDown125(value: number): number {
  if (!(value > 0)) return 0
  const exponent = Math.floor(Math.log10(value))
  const base = 10 ** exponent
  const leading = value / base
  const nice = leading >= 5 ? 5 : leading >= 2 ? 2 : 1
  return nice * base
}

function formatNice(value: number): string {
  return value >= 1 ? value.toLocaleString('en-US') : String(Number(value.toPrecision(1)))
}

const GRID_STEPS = [30, 15, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.025, 0.01, 0.005, 0.0025, 0.001, 0.0005, 0.00025, 0.0001]

/** A grid step giving roughly `target` lines across the larger visible span. */
export function graticuleStep(spanDegrees: number, target = 8): number {
  const ideal = Math.max(spanDegrees, 1e-6) / target
  for (const step of GRID_STEPS) if (step <= ideal * 1.5) return step
  return GRID_STEPS[GRID_STEPS.length - 1]!
}

/** Longitude into [-180, 180): Leaflet's world copies report values past ±180. */
export function wrapLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180
}

export interface GraticuleLine { value: number; label: string }

/**
 * Meridians and parallels inside the view, at `step` degrees. Meridian values
 * stay in the map's own (possibly unwrapped) longitude so the lines sit where
 * the map is; only their labels are wrapped into ±180. Capped so a degenerate
 * view can never produce thousands of lines.
 */
export function graticuleLines(bounds: { south: number; north: number; west: number; east: number }, step: number): { meridians: GraticuleLine[]; parallels: GraticuleLine[] } {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9))
  const build = (from: number, to: number, label: (v: number) => string): GraticuleLine[] => {
    const out: GraticuleLine[] = []
    const first = Math.ceil(from / step - 1e-9)
    const last = Math.floor(to / step + 1e-9)
    for (let i = first; i <= last && out.length < 200; i++) {
      const value = Number((i * step).toFixed(decimals + 2))
      out.push({ value, label: label(value) })
    }
    return out
  }
  const south = Math.max(-90, bounds.south), north = Math.min(90, bounds.north)
  return {
    meridians: build(bounds.west, bounds.east, (v) => formatAngle(wrapLongitude(v), decimals, 'E', 'W')),
    parallels: build(south, north, (v) => formatAngle(v, decimals, 'N', 'S')),
  }
}

function formatAngle(value: number, decimals: number, positive: string, negative: string): string {
  const rounded = Number(value.toFixed(decimals))
  if (rounded === 0 || Math.abs(rounded) === 180) return `${Math.abs(rounded).toFixed(decimals)}°`
  return `${Math.abs(rounded).toFixed(decimals)}°${rounded > 0 ? positive : negative}`
}

export interface MeasureLeg { distanceM: number; bearingDeg: number; cumulativeM: number }

/** Great-circle legs between consecutive vertices, on a spherical Earth. */
export function measureLegs(vertices: ReadonlyArray<{ lat: number; lon: number }>): MeasureLeg[] {
  const legs: MeasureLeg[] = []
  let cumulative = 0
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1]!, b = vertices[i]!
    const distanceM = haversineMeters(a.lat, a.lon, b.lat, b.lon)
    cumulative += distanceM
    legs.push({ distanceM, bearingDeg: initialBearingDegrees(a.lat, a.lon, b.lat, b.lon), cumulativeM: cumulative })
  }
  return legs
}
