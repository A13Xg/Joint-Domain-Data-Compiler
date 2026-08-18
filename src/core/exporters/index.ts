// Exporter registry: a Dataset can be serialized to any registered format.

import { collectChannels, isValidLat, isValidLon, type Dataset, type TrackPoint } from '../model'
import { epochMsToIso, escapeXml, trimNumber } from '../format'
import { buildGpx, type GpxExportOptions } from './gpx'
import { buildEag, type EagExportOptions } from './eag'

export type ExportFormat = 'gpx' | 'csv' | 'geojson' | 'kml' | 'eag'

export interface ExportDescriptor {
  id: ExportFormat
  label: string
  extension: string
  mime: string
  description: string
}

export const EXPORTERS: ExportDescriptor[] = [
  {
    id: 'gpx',
    label: 'GPX 1.1',
    extension: 'gpx',
    mime: 'application/gpx+xml',
    description: 'Schema-valid GPX track. Best for GPS devices, Garmin, Strava, gpsbabel.',
  },
  {
    id: 'csv',
    label: 'CSV',
    extension: 'csv',
    mime: 'text/csv',
    description: 'Flat tabular export including all derived and extension channels.',
  },
  {
    id: 'geojson',
    label: 'GeoJSON',
    extension: 'geojson',
    mime: 'application/geo+json',
    description: 'RFC 7946 LineString + points. Best for web maps and GIS tooling.',
  },
  {
    id: 'kml',
    label: 'KML',
    extension: 'kml',
    mime: 'application/vnd.google-earth.kml+xml',
    description: 'Google Earth track with timestamps and altitude.',
  },
  {
    id: 'eag',
    label: 'EAG TSPI',
    extension: 'eag',
    mime: 'text/plain',
    description: 'European Air Group TSPI format (tab-delimited ECEF coordinates).',
  },
]

export interface ExportResult {
  text: string
  mime: string
  extension: string
  pointCount: number
  warnings: string[]
}

export function exportDataset(
  dataset: Dataset,
  format: ExportFormat,
  options: { gpx?: GpxExportOptions; eag?: EagExportOptions } = {},
): ExportResult {
  switch (format) {
    case 'gpx': {
      const result = buildGpx(dataset, options.gpx)
      const warnings: string[] = []
      if (result.skippedMissing) warnings.push(`${result.skippedMissing} points skipped (missing coordinates)`)
      if (result.skippedOutOfRange) warnings.push(`${result.skippedOutOfRange} points skipped (out of range)`)
      return { text: result.xml, mime: 'application/gpx+xml', extension: 'gpx', pointCount: result.pointCount, warnings }
    }
    case 'csv':
      return exportCsv(dataset)
    case 'geojson':
      return exportGeoJson(dataset)
    case 'kml':
      return exportKml(dataset)
    case 'eag': {
      const result = buildEag(dataset, options.eag)
      return { text: result.text, mime: 'text/plain', extension: 'eag', pointCount: result.pointCount, warnings: result.warnings }
    }
    default:
      throw new Error(`Unknown export format: ${String(format)}`)
  }
}

function validPoints(dataset: Dataset): TrackPoint[] {
  return dataset.points.filter((p) => isValidLat(p.lat) && isValidLon(p.lon))
}

function exportCsv(dataset: Dataset): ExportResult {
  const channels = collectChannels(dataset.points)
  const header = ['latitude', 'longitude', 'elevation_m', 'time_iso', 'name', 'description', ...channels]
  const rows = [header.map(csvCell).join(',')]

  for (const p of dataset.points) {
    const cells = [
      Number.isFinite(p.lat) ? String(p.lat) : '',
      Number.isFinite(p.lon) ? String(p.lon) : '',
      p.ele !== undefined ? String(p.ele) : '',
      p.time !== undefined ? epochMsToIso(p.time) : '',
      p.name ?? '',
      p.desc ?? '',
      ...channels.map((c) => {
        const v = p.ext?.[c]
        return v === undefined ? '' : String(v)
      }),
    ]
    rows.push(cells.map(csvCell).join(','))
  }

  return {
    text: rows.join('\r\n') + '\r\n',
    mime: 'text/csv',
    extension: 'csv',
    pointCount: dataset.points.length,
    warnings: [],
  }
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

function exportGeoJson(dataset: Dataset): ExportResult {
  const pts = validPoints(dataset)
  const coords = pts.map((p) =>
    p.ele !== undefined ? [round(p.lon), round(p.lat), p.ele] : [round(p.lon), round(p.lat)],
  )

  const features: unknown[] = [
    {
      type: 'Feature',
      properties: { name: dataset.name, kind: 'track', pointCount: pts.length },
      geometry: { type: 'LineString', coordinates: coords },
    },
  ]

  // Include named waypoints as discrete point features for GIS round-tripping.
  for (const p of pts) {
    if (p.name) {
      features.push({
        type: 'Feature',
        properties: {
          name: p.name,
          desc: p.desc,
          time: p.time !== undefined ? epochMsToIso(p.time) : undefined,
          ele: p.ele,
          ...p.ext,
        },
        geometry: { type: 'Point', coordinates: p.ele !== undefined ? [round(p.lon), round(p.lat), p.ele] : [round(p.lon), round(p.lat)] },
      })
    }
  }

  const fc = { type: 'FeatureCollection', features }
  return {
    text: JSON.stringify(fc, null, 2),
    mime: 'application/geo+json',
    extension: 'geojson',
    pointCount: pts.length,
    warnings: [],
  }
}

function round(n: number): number {
  return Math.round(n * 1e7) / 1e7
}

function exportKml(dataset: Dataset): ExportResult {
  const pts = validPoints(dataset)
  const coordString = pts
    .map((p) => `${trimNumber(p.lon, 7)},${trimNumber(p.lat, 7)},${p.ele !== undefined ? trimNumber(p.ele, 2) : 0}`)
    .join(' ')

  const hasTime = pts.some((p) => p.time !== undefined)
  const whenTags = hasTime
    ? pts
        .filter((p) => p.time !== undefined)
        .map((p) => `        <when>${epochMsToIso(p.time)}</when>`)
        .join('\n')
    : ''
  const gxCoords = hasTime
    ? pts
        .filter((p) => p.time !== undefined)
        .map((p) => `        <gx:coord>${trimNumber(p.lon, 7)} ${trimNumber(p.lat, 7)} ${p.ele !== undefined ? trimNumber(p.ele, 2) : 0}</gx:coord>`)
        .join('\n')
    : ''

  const track = hasTime
    ? `      <gx:Track>\n${whenTags}\n${gxCoords}\n      </gx:Track>`
    : ''

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <name>${escapeXml(dataset.name)}</name>
    <Placemark>
      <name>${escapeXml(dataset.name)} (path)</name>
      <LineString>
        <tessellate>1</tessellate>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>${coordString}</coordinates>
      </LineString>
    </Placemark>
${track ? `    <Placemark>\n      <name>${escapeXml(dataset.name)} (timed)</name>\n${track}\n    </Placemark>\n` : ''}  </Document>
</kml>
`

  return {
    text: xml,
    mime: 'application/vnd.google-earth.kml+xml',
    extension: 'kml',
    pointCount: pts.length,
    warnings: [],
  }
}
