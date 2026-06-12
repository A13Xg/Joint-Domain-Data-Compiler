// KML parser. Supports <LineString>/<Point> coordinates and Google's
// <gx:Track> (paired <when> + <gx:coord>) used by Earth and many flight tools.
import type { ParseResult, TrackPoint } from '../model'
import { parseNumber } from '../format'

export function parseKml(text: string): ParseResult {
  const warnings: string[] = []
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('KML is not well-formed XML.')
  }

  const points: TrackPoint[] = []

  // gx:Track — timestamps live in sibling <when> elements.
  const tracks = Array.from(doc.getElementsByTagName('*')).filter(
    (el) => el.localName === 'Track',
  )
  for (const track of tracks) {
    const whens = Array.from(track.children).filter((c) => c.localName === 'when')
    const coords = Array.from(track.children).filter((c) => c.localName === 'coord')
    for (let i = 0; i < coords.length; i++) {
      const parts = coords[i].textContent?.trim().split(/\s+/) ?? []
      const lon = parseNumber(parts[0])
      const lat = parseNumber(parts[1])
      const ele = parseNumber(parts[2] ?? '')
      if (lat === null || lon === null) continue
      const point: TrackPoint = { lat, lon }
      if (ele !== null) point.ele = ele
      const when = whens[i]?.textContent?.trim()
      if (when) {
        const ms = Date.parse(when)
        if (!Number.isNaN(ms)) point.time = ms
      }
      points.push(point)
    }
  }

  // Plain <coordinates> blocks (LineString / Point / Polygon rings).
  if (points.length === 0) {
    const coordEls = Array.from(doc.getElementsByTagName('*')).filter(
      (el) => el.localName === 'coordinates',
    )
    for (const el of coordEls) {
      const tuples = el.textContent?.trim().split(/\s+/) ?? []
      const placemarkName = nearestPlacemarkName(el)
      for (const tuple of tuples) {
        const [lonS, latS, eleS] = tuple.split(',')
        const lon = parseNumber(lonS)
        const lat = parseNumber(latS)
        if (lat === null || lon === null) continue
        const point: TrackPoint = { lat, lon }
        const ele = parseNumber(eleS ?? '')
        if (ele !== null) point.ele = ele
        if (placemarkName && tuples.length === 1) point.name = placemarkName
        points.push(point)
      }
    }
  }

  if (points.length === 0) warnings.push('No coordinates found in KML.')
  return { points, warnings, channels: [] }
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
