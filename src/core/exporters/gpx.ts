// GPX 1.1 exporter built for maximum cross-program compatibility.
//
// Correctness fixes over the original implementation:
//  1. Schema-valid child ordering. The GPX 1.1 XSD (wptType) fixes the order of
//     <trkpt> children: ele, time, magvar, geoidheight, name, cmt, desc, ...,
//     extensions. The old code emitted <desc> before <cmt>, which strict
//     validators (Garmin BaseCamp, gpsbabel -x validate, XSD loaders) reject.
//  2. Deterministic UTC timestamps (see format.ts) instead of engine-dependent
//     Date parsing.
//  3. <bounds> emitted in metadata so importers zoom/fit correctly.
//  4. Pretty-printed with newlines — robust for naive line-based importers and
//     human-diffable.
//  5. Custom channels preserved under a namespaced <extensions> block.

import {
  computeBounds,
  isValidLat,
  isValidLon,
  type Dataset,
  type TrackPoint,
} from '../model'
import { epochMsToGpxTime, escapeXml, trimNumber } from '../format'

export interface GpxExportOptions {
  creator?: string
  trackName?: string
  /** Emit each point's extension channels inside <extensions>. Default true. */
  includeExtensions?: boolean
  /** Sort points by time before writing (recommended for player compatibility). */
  sortByTime?: boolean
  /** Decimal places for lat/lon. 7 ≈ 1.1cm, the practical GPS limit. */
  coordinatePrecision?: number
  /** Prepend a UTF-8 BOM (some legacy Windows tools want it). Default false. */
  bom?: boolean
}

const EXT_NS = 'jddc'
const EXT_NS_URI = 'https://joint-domain-data-compiler.local/gpx/v1'

export interface PointXmlResult {
  xml: string | null
  reason?: 'missing' | 'out_of_range'
}

/**
 * Build a single <trkpt> XML fragment for one point. Exported so the chunked
 * compute core (src/core/compute/gpxExport.ts) can reuse the exact same
 * per-point logic instead of duplicating it — chunking must never change the
 * bytes produced for a given point.
 */
export function buildTrkpt(
  point: TrackPoint,
  opts: Required<Pick<GpxExportOptions, 'includeExtensions' | 'coordinatePrecision'>>,
): PointXmlResult {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
    return { xml: null, reason: 'missing' }
  }
  if (!isValidLat(point.lat) || !isValidLon(point.lon)) {
    return { xml: null, reason: 'out_of_range' }
  }

  const lat = trimNumber(point.lat, opts.coordinatePrecision)
  const lon = trimNumber(point.lon, opts.coordinatePrecision)
  const lines: string[] = [`      <trkpt lat="${lat}" lon="${lon}">`]

  // --- Strict GPX 1.1 child order below ---
  if (point.ele !== undefined && Number.isFinite(point.ele)) {
    lines.push(`        <ele>${trimNumber(point.ele, 3)}</ele>`)
  }
  if (point.time !== undefined) {
    const t = epochMsToGpxTime(point.time)
    if (t) lines.push(`        <time>${t}</time>`)
  }
  if (point.name) {
    lines.push(`        <name>${escapeXml(point.name)}</name>`)
  }
  if (point.desc) {
    // cmt MUST precede desc per the schema.
    lines.push(`        <cmt>${escapeXml(point.desc)}</cmt>`)
    lines.push(`        <desc>${escapeXml(point.desc)}</desc>`)
  }

  // Lift well-known GPS quality channels into their schema-defined slots.
  const ext = point.ext ?? {}
  const sat = numeric(ext['sat'] ?? ext['satellites'])
  const hdop = numeric(ext['hdop'])
  const vdop = numeric(ext['vdop'])
  const pdop = numeric(ext['pdop'])
  if (sat !== null) lines.push(`        <sat>${Math.round(sat)}</sat>`)
  if (hdop !== null) lines.push(`        <hdop>${trimNumber(hdop, 3)}</hdop>`)
  if (vdop !== null) lines.push(`        <vdop>${trimNumber(vdop, 3)}</vdop>`)
  if (pdop !== null) lines.push(`        <pdop>${trimNumber(pdop, 3)}</pdop>`)

  // Remaining custom channels go in a namespaced extensions block (valid GPX).
  if (opts.includeExtensions) {
    const reserved = new Set(['sat', 'satellites', 'hdop', 'vdop', 'pdop'])
    const extraKeys = Object.keys(ext).filter((k) => !reserved.has(k))
    if (extraKeys.length > 0) {
      lines.push('        <extensions>')
      for (const key of extraKeys) {
        const tag = sanitizeTagName(key)
        lines.push(`          <${EXT_NS}:${tag}>${escapeXml(String(ext[key]))}</${EXT_NS}:${tag}>`)
      }
      lines.push('        </extensions>')
    }
  }

  lines.push('      </trkpt>')
  return { xml: lines.join('\n') }
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function sanitizeTagName(key: string): string {
  const cleaned = key.replace(/[^A-Za-z0-9_.-]/g, '_')
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`
}

export interface GpxBuildResult {
  xml: string
  pointCount: number
  skippedMissing: number
  skippedOutOfRange: number
}

export type NormalizedGpxOptions = Required<GpxExportOptions>

/** Fill in defaults once so buildGpx and the chunked worker path agree byte-for-byte. */
export function normalizeGpxOptions(dataset: Dataset, options: GpxExportOptions = {}): NormalizedGpxOptions {
  return {
    creator: options.creator ?? 'Joint Domain Data Compiler',
    trackName: options.trackName ?? dataset.name ?? 'track',
    includeExtensions: options.includeExtensions ?? true,
    sortByTime: options.sortByTime ?? true,
    coordinatePrecision: options.coordinatePrecision ?? 7,
    bom: options.bom ?? false,
  }
}

/** Sort (or not) exactly as buildGpx does, exposed so chunked builds see the same point order. */
export function sortGpxPoints(points: TrackPoint[], opts: NormalizedGpxOptions): TrackPoint[] {
  if (!opts.sortByTime || !points.some((p) => p.time !== undefined)) return points
  return [...points].sort((a, b) => {
    if (a.time === undefined && b.time === undefined) return 0
    if (a.time === undefined) return 1
    if (b.time === undefined) return -1
    return a.time - b.time
  })
}

/**
 * Assemble the final GPX document from already-built <trkpt> bodies. Shared by the
 * synchronous buildGpx and the chunked/cancellable worker path so header, metadata,
 * and footer formatting can never drift between the two.
 */
export function composeGpxDocument(
  opts: NormalizedGpxOptions,
  points: TrackPoint[],
  body: string[],
  skippedMissing: number,
  skippedOutOfRange: number,
  firstTime: number | undefined,
): GpxBuildResult {
  const bounds = computeBounds(points)
  const metaTime = firstTime !== undefined ? epochMsToGpxTime(firstTime) : null

  const header =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<gpx version="1.1" creator="${escapeXml(opts.creator)}"\n` +
    '     xmlns="http://www.topografix.com/GPX/1/1"\n' +
    '     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n' +
    `     xmlns:${EXT_NS}="${EXT_NS_URI}"\n` +
    '     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">'

  const metaLines = ['  <metadata>', `    <name>${escapeXml(opts.trackName)}</name>`]
  if (metaTime) metaLines.push(`    <time>${metaTime}</time>`)
  if (bounds) {
    metaLines.push(
      `    <bounds minlat="${trimNumber(bounds.minLat, opts.coordinatePrecision)}" ` +
        `minlon="${trimNumber(bounds.minLon, opts.coordinatePrecision)}" ` +
        `maxlat="${trimNumber(bounds.maxLat, opts.coordinatePrecision)}" ` +
        `maxlon="${trimNumber(bounds.maxLon, opts.coordinatePrecision)}"/>`,
    )
  }
  metaLines.push('  </metadata>')

  const trk = [
    '  <trk>',
    `    <name>${escapeXml(opts.trackName)}</name>`,
    '    <trkseg>',
    ...body,
    '    </trkseg>',
    '  </trk>',
  ]

  const xml = [header, ...metaLines, ...trk, '</gpx>', ''].join('\n')
  const prefix = opts.bom ? '﻿' : ''

  return {
    xml: prefix + xml,
    pointCount: body.length,
    skippedMissing,
    skippedOutOfRange,
  }
}

export function buildGpx(dataset: Dataset, options: GpxExportOptions = {}): GpxBuildResult {
  const opts = normalizeGpxOptions(dataset, options)
  const points = sortGpxPoints(dataset.points, opts)

  const body: string[] = []
  let skippedMissing = 0
  let skippedOutOfRange = 0
  let firstTime: number | undefined

  for (const point of points) {
    const result = buildTrkpt(point, opts)
    if (!result.xml) {
      if (result.reason === 'missing') skippedMissing++
      else skippedOutOfRange++
      continue
    }
    body.push(result.xml)
    if (firstTime === undefined && point.time !== undefined) firstTime = point.time
  }

  return composeGpxDocument(opts, points, body, skippedMissing, skippedOutOfRange, firstTime)
}
