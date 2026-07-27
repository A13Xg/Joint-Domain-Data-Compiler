// GPX parser (handles GPX 1.0 and 1.1, tracks + routes + waypoints).
import type { ParseResult, TrackPoint } from '../model'
import { parseNumber } from '../format'

export function parseGpx(text: string): ParseResult {
  const warnings: string[] = []
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError || !doc.documentElement) {
    throw new Error(`GPX is not well-formed XML: ${parseError?.textContent?.slice(0, 200) ?? 'unknown'}`)
  }

  const points: TrackPoint[] = []
  const channelSet = new Set<string>()

  // Track points (trkpt) are primary; fall back to route points and waypoints.
  const trkpts = Array.from(doc.getElementsByTagName('trkpt'))
  const rtepts = Array.from(doc.getElementsByTagName('rtept'))
  const wpts = Array.from(doc.getElementsByTagName('wpt'))

  const collect = (elements: Element[], kind: string) => {
    for (const el of elements) {
      const point = elementToPoint(el, channelSet)
      if (point) points.push(point)
    }
    if (elements.length > 0) {
      // informational; surfaced via warnings only when nothing else present
      void kind
    }
  }

  collect(trkpts, 'trkpt')
  if (points.length === 0) collect(rtepts, 'rtept')
  collect(wpts, 'wpt') // waypoints supplement track if present

  if (points.length === 0) {
    warnings.push('No trkpt/rtept/wpt elements found in GPX.')
  }

  const creator = doc.documentElement.getAttribute('creator') ?? ''
  const version = doc.documentElement.getAttribute('version') ?? ''

  return {
    points,
    warnings,
    channels: Array.from(channelSet),
    meta: { creator, gpxVersion: version },
  }
}

function elementToPoint(el: Element, channelSet: Set<string>): TrackPoint | null {
  const lat = parseNumber(el.getAttribute('lat'))
  const lon = parseNumber(el.getAttribute('lon'))
  if (lat === null || lon === null) return null

  const point: TrackPoint = { lat, lon }
  const ext: Record<string, number | string> = {}

  const eleText = childText(el, 'ele')
  if (eleText) {
    const ele = parseNumber(eleText)
    if (ele !== null) point.ele = ele
  }

  const timeText = childText(el, 'time')
  if (timeText) {
    const ms = Date.parse(timeText)
    if (!Number.isNaN(ms)) point.time = ms
  }

  const name = childText(el, 'name')
  if (name) point.name = name
  const desc = childText(el, 'desc') ?? childText(el, 'cmt')
  if (desc) point.desc = desc

  for (const tag of ['sat', 'hdop', 'vdop', 'pdop', 'fix', 'geoidheight', 'magvar']) {
    const value = childText(el, tag)
    if (value) {
      const num = parseNumber(value)
      ext[tag] = num ?? value
      channelSet.add(tag)
    }
  }

  // Pull any namespaced extension leaf nodes (TrackPointExtension, custom).
  const extensions = el.getElementsByTagName('extensions')[0]
  if (extensions) {
    for (const node of Array.from(extensions.getElementsByTagName('*'))) {
      if (node.children.length === 0 && node.textContent?.trim()) {
        const key = node.localName
        const num = parseNumber(node.textContent)
        ext[key] = num ?? node.textContent.trim()
        channelSet.add(key)
      }
    }
  }

  if (Object.keys(ext).length > 0) point.ext = ext
  return point
}

function childText(el: Element, tag: string): string | null {
  for (const child of Array.from(el.children)) {
    if (child.localName === tag) {
      return child.textContent?.trim() ?? null
    }
  }
  return null
}
