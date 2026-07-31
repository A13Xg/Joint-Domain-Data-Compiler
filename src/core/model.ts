// Unified internal data model shared by every parser, transform, and exporter.
//
// All ingested formats (CSV, GPX, GeoJSON, KML, NMEA, ...) are normalized into a
// `Dataset` of `TrackPoint`s. Exporters consume the same model. This decoupling is
// what lets the app act as an N-to-M conversion matrix instead of a single pipeline.

export type AltitudeReference = 'MSL' | 'HAE' | 'AGL' | 'PRESSURE' | 'UNKNOWN'
export type TimeReference = 'UTC' | 'GPS' | 'TAI' | 'LOCAL' | 'UNKNOWN'
export type ChannelDataType = 'number' | 'string' | 'boolean'
export type ChannelInterpolation = 'linear' | 'step' | 'none'

export interface ChannelDefinition {
  id: string
  displayName: string
  unit?: string
  dataType: ChannelDataType
  sourceColumn?: string
  description?: string
  interpolation?: ChannelInterpolation
  semanticType?: string
}

export interface SourceMetadata {
  filename: string
  byteLength?: number
  importedAt: number
  checksum?: string
  parserId: string
  parserVersion: string
}

export interface DatasetMetadata {
  /** EPSG identifier or other CRS label. Defaults to EPSG:4326 for normalized coordinates. */
  coordinateSystem: string
  altitudeReference: AltitudeReference
  timeReference: TimeReference
  channels: ChannelDefinition[]
  source: SourceMetadata
}

export interface PointProvenance {
  /** One-based record index in the source file when known. */
  sourceRecord?: number
  /** Source-native segment, track, sentence, or feature identifier. */
  sourceSegment?: string
  /**
   * Zero-based index of the distinct geometry block (KML Placemark ring/line/
   * point, ...) a point belongs to, when the source format has more than one
   * per file. Unlike `sourceSegment` (a human-readable label that can repeat,
   * e.g. a polygon's outer ring and its inner hole share one Placemark name),
   * this is unique per geometry and exists purely so consumers that must not
   * connect unrelated shapes together (e.g. the map overlay renderer) can
   * group points correctly without depending on — or altering — the display
   * label.
   */
  sourceFeatureIndex?: number
  /** Machine-readable flags describing source or transform quality concerns. */
  qualityFlags?: string[]
}

/** A single time/space sample. Canonical units: degrees, meters, epoch milliseconds. */
export interface TrackPoint {
  /** Decimal degrees, -90..90. Required for any geospatial point. */
  lat: number
  /** Decimal degrees, -180..180. */
  lon: number
  /** Elevation in meters (converted on import from feet etc.). */
  ele?: number
  /** Timestamp as epoch milliseconds (UTC unless dataset metadata states otherwise). */
  time?: number
  /** Short label. */
  name?: string
  /** Free-form note. */
  desc?: string
  /** Source lineage and quality information preserved through transforms. */
  provenance?: PointProvenance
  /**
   * Derived / passthrough channels keyed by name
   * (e.g. speed_mps, heading_deg, hdop, sat, custom CSV columns).
   */
  ext?: Record<string, number | string | boolean>
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
  /** Rich semantic and provenance metadata. Optional for backward-compatible imports. */
  metadata?: DatasetMetadata
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
  /** Optional semantic channel definitions supplied by the parser. */
  channelDefinitions?: ChannelDefinition[]
  /** Format-specific metadata the UI may display (track name, creator, ...). */
  meta?: Record<string, string>
  altitudeReference?: AltitudeReference
  timeReference?: TimeReference
  coordinateSystem?: string
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
    if (!isValidLat(p.lat) || !isValidLon(p.lon)) continue
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

export function inferChannelDefinitions(points: TrackPoint[], channels = collectChannels(points)): ChannelDefinition[] {
  return channels.map((id) => {
    let dataType: ChannelDataType = 'string'
    for (const point of points) {
      const value = point.ext?.[id]
      if (value !== undefined) {
        dataType = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string'
        break
      }
    }
    return { id, displayName: id, dataType }
  })
}
