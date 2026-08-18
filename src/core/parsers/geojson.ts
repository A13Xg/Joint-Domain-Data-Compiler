// GeoJSON parser (RFC 7946). Flattens LineString / MultiLineString / Point /
// MultiPoint geometries into TrackPoints, preserving feature properties as
// extension channels and recognizing common time/elevation property names.
import type { ParseResult, TrackPoint } from '../model'
import { autoDetectEpochMs } from '../format'
import { errorMessage } from '../errors'

type Position = number[]

export function parseGeoJson(text: string): ParseResult {
  const warnings: string[] = []
  const channelSet = new Set<string>()
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch (err) {
    throw new Error(`Invalid GeoJSON: ${errorMessage(err)}`, { cause: err })
  }

  const points: TrackPoint[] = []
  const features = extractFeatures(root)

  for (const feature of features) {
    const rawProps = feature.properties
    const props = (rawProps && typeof rawProps === 'object' && !Array.isArray(rawProps) ? rawProps : {})
    const geom = feature.geometry
    if (!geom || typeof geom !== 'object' || typeof geom.type !== 'string') continue
    pushGeometry(geom, props, points, channelSet, warnings)
  }

  if (points.length === 0) {
    warnings.push('No usable geometry found in GeoJSON.')
  }

  return { points, warnings, channels: Array.from(channelSet) }
}

interface GeoFeature {
  properties?: Record<string, unknown>
  geometry?: { type: string; coordinates: unknown }
}

function extractFeatures(root: unknown): GeoFeature[] {
  if (!root || typeof root !== 'object') return []
  const obj = root as Record<string, unknown>
  if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
    // A FeatureCollection may legally exist while individual entries are null
    // or primitives; those must be skipped, not dereferenced.
    return obj.features.filter((feature): feature is GeoFeature => !!feature && typeof feature === 'object')
  }
  if (obj.type === 'Feature') return [obj]
  if (typeof obj.type === 'string' && 'coordinates' in obj) {
    return [{ geometry: obj as GeoFeature['geometry'] }]
  }
  return []
}

function pushGeometry(
  geom: { type: string; coordinates: unknown },
  props: Record<string, unknown>,
  out: TrackPoint[],
  channelSet: Set<string>,
  warnings: string[],
) {
  const t = geom.type
  const c = geom.coordinates
  if (t === 'Point') {
    addPosition(c as Position, props, out, channelSet)
  } else if (t === 'MultiPoint' || t === 'LineString') {
    // `coordinates` is untrusted: iterating a non-array throws "c is not
    // iterable", which tells the user nothing about which file is malformed.
    if (!Array.isArray(c)) {
      warnings.push(`${t} geometry has non-array coordinates; skipped.`)
      return
    }
    for (const pos of c as Position[]) addPosition(pos, props, out, channelSet)
  } else if (t === 'MultiLineString' || t === 'Polygon') {
    if (!Array.isArray(c)) {
      warnings.push(`${t} geometry has non-array coordinates; skipped.`)
      return
    }
    for (const line of c as Position[][]) {
      if (!Array.isArray(line)) {
        warnings.push(`${t} geometry has a non-array coordinate ring; skipped.`)
        continue
      }
      for (const pos of line) addPosition(pos, props, out, channelSet)
    }
  } else if (t === 'GeometryCollection') {
    warnings.push('GeometryCollection flattened to points.')
  } else {
    warnings.push(`Unsupported geometry type: ${t}`)
  }
}

function addPosition(
  pos: Position,
  props: Record<string, unknown>,
  out: TrackPoint[],
  channelSet: Set<string>,
) {
  if (!Array.isArray(pos) || pos.length < 2) return
  const [lon, lat, ele] = pos
  if (typeof lon !== 'number' || typeof lat !== 'number') return

  const point: TrackPoint = { lat, lon }
  if (typeof ele === 'number') point.ele = ele

  // Recognize common property keys.
  const timeProp = props['time'] ?? props['timestamp'] ?? props['t'] ?? props['datetime']
  // Only scalars can carry a timestamp. Stringifying an object or array here
  // yields "[object Object]", which parses to null anyway — but silently, so
  // the caller cannot tell a missing time from an unusable one.
  if (typeof timeProp === 'string' || typeof timeProp === 'number') {
    const ms = autoDetectEpochMs(String(timeProp))
    if (ms !== null) point.time = ms
  }
  if (typeof props['name'] === 'string') point.name = props['name']
  if (typeof props['desc'] === 'string') point.desc = props['desc']

  const ext: Record<string, number | string> = {}
  for (const [key, value] of Object.entries(props)) {
    if (['time', 'timestamp', 't', 'datetime', 'name', 'desc'].includes(key)) continue
    if (typeof value === 'number' || typeof value === 'string') {
      ext[key] = value
      channelSet.add(key)
    }
  }
  if (Object.keys(ext).length > 0) point.ext = ext

  out.push(point)
}
