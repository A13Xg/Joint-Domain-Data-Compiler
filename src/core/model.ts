// Unified internal data model shared by every parser, transform, and exporter.
//
// All ingested formats (CSV, GPX, GeoJSON, KML, NMEA, ...) are normalized into a
// `Dataset` of `TrackPoint`s. Exporters consume the same model. This decoupling is
// what lets the app act as an N-to-M conversion matrix instead of a single pipeline.

/** A single time/space sample. Canonical units: degrees, meters, epoch milliseconds. */
export interface TrackPoint {
  /** Decimal degrees, -90..90. Required for any geospatial point. */
  lat: number
  /** Decimal degrees, -180..180. */
  lon: number
  /** Elevation in meters (converted on import from feet etc.). */
  ele?: number
  /** Timestamp as epoch milliseconds (UTC). */
  time?: number
  /** Short label. */
  name?: string
  /** Free-form note. */
  desc?: string
  /**
   * Derived / passthrough numeric or string channels keyed by name
   * (e.g. speed_mps, heading_deg, hdop, sat, custom CSV columns). Engineers care
   * about these extension channels, so we preserve every column we can.
   */
  ext?: Record<string, number | string>
}

export type SourceFormat =
  | 'csv'
  | 'gpx'
  | 'geojson'
  | 'kml'
  | 'nmea'
  | 'gpb'
  | 'unknown'

/** A normalized, in-memory track. */
export interface Dataset {
  id: string
  /** Display name (usually derived from the source filename). */
  name: string
  sourceFormat: SourceFormat
  points: TrackPoint[]
  /** Non-fatal issues surfaced during parsing (each is also logged). */
  warnings: string[]
  /** Ordered list of extension channel keys discovered across points. */
  channels: string[]
  /** Bytes of the original source, for reporting. */
  sourceBytes?: number
  createdAt: number
}

export interface BoundingBox {
  minLat: number
  minLon: number
  maxLat: number
  maxLon: number
}

/** Result of running a parser over raw input. */
export interface ParseResult {
  points: TrackPoint[]
  warnings: string[]
  /** Channel keys (extension fields) seen in the data. */
  channels: string[]
  /** Format-specific metadata the UI may display (track name, creator, ...). */
  meta?: Record<string, string>
}

export const EARTH_RADIUS_M = 6371008.8

/** Great-circle distance between two points in meters (haversine). */
export function haversineMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const toRad = Math.PI / 180
  const dLat = (bLat - aLat) * toRad
  const dLon = (bLon - aLon) * toRad
  const lat1 = aLat * toRad
  const lat2 = bLat * toRad
  const sinDLat = Math.sin(dLat / 2)
  const sinDLon = Math.sin(dLon / 2)
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function isValidLat(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90
}

export function isValidLon(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180
}

export function computeBounds(points: TrackPoint[]): BoundingBox | null {
  let minLat = Infinity
  let minLon = Infinity
  let maxLat = -Infinity
  let maxLon = -Infinity
  let seen = false

  for (const p of points) {
    if (!isValidLat(p.lat) || !isValidLon(p.lon)) {
      continue
    }
    seen = true
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lon < minLon) minLon = p.lon
    if (p.lon > maxLon) maxLon = p.lon
  }

  return seen ? { minLat, minLon, maxLat, maxLon } : null
}

/** Collect the union of extension channel keys across all points, in stable order. */
export function collectChannels(points: TrackPoint[]): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  for (const p of points) {
    if (!p.ext) continue
    for (const key of Object.keys(p.ext)) {
      if (!seen.has(key)) {
        seen.add(key)
        order.push(key)
      }
    }
  }
  return order
}
