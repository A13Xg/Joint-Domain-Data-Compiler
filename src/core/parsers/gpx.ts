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

  // A trkpt/rtept/wpt whose lat or lon will not parse is skipped. That used to
  // happen with no record of any kind; the count is now reported so the
  // difference between "the file had 100 points" and "the file had 105, five
  // of them unusable" is visible rather than inferred.
  let droppedInvalidCoordinate = 0
  const collect = (elements: Element[], kind: string) => {
    for (const el of elements) {
      const point = elementToPoint(el, channelSet)
      if (point) points.push(point)
      else droppedInvalidCoordinate++
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

  if (droppedInvalidCoordinate > 0) {
    warnings.push(`Dropped ${droppedInvalidCoordinate} GPX element(s) with an unparseable lat/lon.`)
  }

  return {
    points,
    warnings,
    channels: Array.from(channelSet),
    meta: { creator, gpxVersion: version },
    droppedCounts: droppedInvalidCoordinate > 0 ? { invalidCoordinate: droppedInvalidCoordinate } : undefined,
  }
}

// Leaf tags copied straight into `ext`, in the order they are written there.
const EXTENSION_TAGS = ['sat', 'hdop', 'vdop', 'pdop', 'fix', 'geoidheight', 'magvar'] as const

function trimmedText(el: Element): string | null {
  return el.textContent?.trim() ?? null
}

function elementToPoint(el: Element, channelSet: Set<string>): TrackPoint | null {
  const lat = parseNumber(el.getAttribute('lat'))
  const lon = parseNumber(el.getAttribute('lon'))
  if (lat === null || lon === null) return null

  const point: TrackPoint = { lat, lon }
  const ext: Record<string, number | string> = {}

  // One pass over the children. Reading each field with its own scan rebuilt
  // an array of this point's children twelve times over — twelve allocations
  // and twelve linear scans per track point. `undefined` here means "no such
  // child was seen", which is distinct from a child whose text is empty, so
  // first-match-wins still behaves exactly as the per-field scans did.
  let eleText: string | null | undefined
  let timeText: string | null | undefined
  let nameText: string | null | undefined
  let descText: string | null | undefined
  let cmtText: string | null | undefined
  const extText: Array<string | null | undefined> = new Array<string | null | undefined>(EXTENSION_TAGS.length)

  const children = el.children
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (!child) continue
    switch (child.localName) {
      case 'ele': if (eleText === undefined) eleText = trimmedText(child); break
      case 'time': if (timeText === undefined) timeText = trimmedText(child); break
      case 'name': if (nameText === undefined) nameText = trimmedText(child); break
      case 'desc': if (descText === undefined) descText = trimmedText(child); break
      case 'cmt': if (cmtText === undefined) cmtText = trimmedText(child); break
      default: {
        const index = EXTENSION_TAGS.indexOf(child.localName as (typeof EXTENSION_TAGS)[number])
        if (index >= 0 && extText[index] === undefined) extText[index] = trimmedText(child)
      }
    }
  }

  if (eleText) {
    const ele = parseNumber(eleText)
    if (ele !== null) point.ele = ele
  }

  if (timeText) {
    const ms = Date.parse(timeText)
    if (!Number.isNaN(ms)) point.time = ms
  }

  if (nameText) point.name = nameText
  const desc = descText ?? cmtText
  if (desc) point.desc = desc

  for (let i = 0; i < EXTENSION_TAGS.length; i++) {
    const value = extText[i]
    if (!value) continue
    const tag = EXTENSION_TAGS[i]!
    const num = parseNumber(value)
    ext[tag] = num ?? value
    channelSet.add(tag)
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
