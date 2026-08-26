// KML parser. Supports <LineString>/<Point> coordinates and Google's
// <gx:Track> (paired <when> + <gx:coord>) used by Earth and many flight tools.
import type { ParseResult, TrackPoint } from '../model'
import { parseNumber } from '../format'

export function parseKml(text: string): ParseResult {
  const warnings: string[] = []
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror') || !doc.documentElement) {
    throw new Error('KML is not well-formed XML.')
  }

  const points: TrackPoint[] = []
  // Shared across both loops below so every distinct geometry block in the
  // file — gx:Track or plain <coordinates> — gets its own index, purely for
  // sourceFeatureIndex (see PointProvenance). This does not touch
  // sourceSegment, which keeps its original, human-readable value and
  // semantics unchanged: normal track import/display behavior is unaffected.
  let featureIndex = 0
  // Coordinate tuples whose lat/lon will not parse. Both geometry paths below
  // skipped these silently, so a malformed KML looked identical to a short one.
  let droppedInvalidCoordinate = 0


  // gx:Track — timestamps live in sibling <when> elements.
  const tracks = Array.from(doc.getElementsByTagName('*')).filter(
    (el) => el.localName === 'Track',
  )
  for (const track of tracks) {
    const whens = Array.from(track.children).filter((c) => c.localName === 'when')
    const coords = Array.from(track.children).filter((c) => c.localName === 'coord')
    const trackName = nearestPlacemarkName(track) ?? 'gx:Track'
    const sourceFeatureIndex = featureIndex++
    if (whens.length > 0 && whens.length !== coords.length) {
      warnings.push(`${trackName} has ${whens.length} timestamps for ${coords.length} coordinates; timestamps were paired by index.`)
    }
    for (let i = 0; i < coords.length; i++) {
      const parts = coords[i]!.textContent?.trim().split(/\s+/) ?? []
      const lon = parseNumber(parts[0])
      const lat = parseNumber(parts[1])
      const ele = parseNumber(parts[2] ?? '')
      if (lat === null || lon === null) { droppedInvalidCoordinate++; continue }
      const point: TrackPoint = { lat, lon, provenance: { sourceSegment: trackName, sourceFeatureIndex } }
      if (ele !== null) point.ele = ele
      const when = whens[i]?.textContent?.trim()
      if (when) {
        const ms = Date.parse(when)
        if (!Number.isNaN(ms)) point.time = ms
      }
      points.push(point)
    }
  }

  // Plain <coordinates> blocks (LineString / Point / Polygon rings). Parse these
  // even when gx:Track exists so mixed KML files do not silently drop placemarks.
  const coordEls = Array.from(doc.getElementsByTagName('*')).filter(
    (el) => el.localName === 'coordinates',
  )
  for (const el of coordEls) {
    const tuples = el.textContent?.trim().split(/\s+/).filter(Boolean) ?? []
    const placemarkName = nearestPlacemarkName(el)
    const sourceFeatureIndex = featureIndex++
    for (const tuple of tuples) {
      const [lonS, latS, eleS] = tuple.split(',')
      const lon = parseNumber(lonS)
      const lat = parseNumber(latS)
      if (lat === null || lon === null) { droppedInvalidCoordinate++; continue }
      const point: TrackPoint = { lat, lon, provenance: { sourceFeatureIndex } }
      const ele = parseNumber(eleS ?? '')
      if (ele !== null) point.ele = ele
      if (placemarkName) point.provenance!.sourceSegment = placemarkName
      if (placemarkName && tuples.length === 1) point.name = placemarkName
      points.push(point)
    }
  }

  if (points.length === 0) warnings.push('No coordinates found in KML.')
  if (droppedInvalidCoordinate > 0) {
    warnings.push(`Dropped ${droppedInvalidCoordinate} KML coordinate tuple(s) with an unparseable lat/lon.`)
  }
  return {
    points,
    warnings,
    channels: [],
    droppedCounts: droppedInvalidCoordinate > 0 ? { invalidCoordinate: droppedInvalidCoordinate } : undefined,
  }
}

function nearestPlacemarkName(el: Element): string | null {
  let cur: Element | null = el
  while (cur) {
    if (cur.localName === 'Placemark') {
      for (const child of Array.from(cur.children)) {
        if (child.localName === 'name') return child.textContent?.trim() ?? null
      }
    }
    cur = cur.parentElement
  }
  return null
}
