// Parser registry + format detection. Maps a File to a Dataset, dispatching by
// extension and (for ambiguous cases) content sniffing. CSV is handled separately
// because it needs an interactive column mapping step.
import {
  collectChannels,
  inferChannelDefinitions,
  type Dataset,
  type ParseResult,
  type SourceFormat,
} from '../model'
import { logger } from '../logger'
import { createDatasetId } from '../ids'
import { parseGpx } from './gpx'
import { parseGeoJson } from './geojson'
import { parseKml } from './kml'
import { parseNmea } from './nmea'
import { parseGpb, looksLikeGpb } from './gpb'

export interface FormatDescriptor {
  id: SourceFormat
  label: string
  extensions: string[]
  binary: boolean
  needsMapping: boolean
  description: string
}

export const INPUT_FORMATS: FormatDescriptor[] = [
  { id: 'csv', label: 'CSV / TSV', extensions: ['csv', 'tsv', 'txt'], binary: false, needsMapping: true, description: 'Delimited tabular data with header row.' },
  { id: 'gpx', label: 'GPX', extensions: ['gpx'], binary: false, needsMapping: false, description: 'GPS Exchange tracks, routes, waypoints (1.0/1.1).' },
  { id: 'geojson', label: 'GeoJSON', extensions: ['geojson', 'json'], binary: false, needsMapping: false, description: 'RFC 7946 features and geometries.' },
  { id: 'kml', label: 'KML / KMZ', extensions: ['kml', 'kmz'], binary: false, needsMapping: false, description: 'Google Earth placemarks, gx:Track, and desktop KMZ library files.' },
  { id: 'nmea', label: 'NMEA 0183', extensions: ['nmea', 'gps', 'log'], binary: false, needsMapping: false, description: 'Raw receiver sentences (GGA/RMC/GLL).' },
  { id: 'gpb', label: 'GPB (binary)', extensions: ['gpb', 'bin'], binary: true, needsMapping: false, description: 'JDDC Geo Point Binary container.' },
]

export function detectFormat(fileName: string): FormatDescriptor | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  for (const fmt of INPUT_FORMATS) {
    if (fmt.extensions.includes(ext)) return fmt
  }
  return null
}

const PARSER_VERSION = '1'

export function makeDataset(
  name: string,
  format: SourceFormat,
  result: ParseResult,
  sourceBytes?: number,
): Dataset {
  const channels = result.channels.length > 0 ? result.channels : collectChannels(result.points)
  const createdAt = nowSafe()
  const channelDefinitions = result.channelDefinitions?.length
    ? result.channelDefinitions
    : inferChannelDefinitions(result.points, channels)

  return {
    id: createDatasetId(name),
    name,
    sourceFormat: format,
    points: result.points,
    warnings: result.warnings,
    channels,
    metadata: {
      coordinateSystem: result.coordinateSystem ?? 'EPSG:4326',
      altitudeReference: result.altitudeReference ?? 'UNKNOWN',
      timeReference: result.timeReference ?? 'UTC',
      channels: channelDefinitions,
      source: {
        filename: name,
        byteLength: sourceBytes,
        importedAt: createdAt,
        parserId: format,
        parserVersion: PARSER_VERSION,
      },
    },
    sourceBytes,
    createdAt,
  }
}

function nowSafe(): number {
  try {
    return Date.now()
  } catch {
    return 0
  }
}

/** Parse a non-CSV file fully into a Dataset. */
export async function parseFileToDataset(file: File, format: FormatDescriptor): Promise<Dataset> {
  return logger.time('parser', `Parse ${file.name} as ${format.label}`, async () => {
    let result: ParseResult
    if (format.binary) {
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      if (format.id === 'gpb' || looksLikeGpb(bytes)) {
        result = parseGpb(buffer)
      } else {
        throw new Error(`No binary parser available for ${file.name}.`)
      }
    } else {
      const text = await file.text()
      switch (format.id) {
        case 'gpx':
          result = parseGpx(text)
          break
        case 'geojson':
          result = parseGeoJson(text)
          break
        case 'kml':
          result = parseKml(text)
          break
        case 'nmea':
          result = parseNmea(text)
          break
        default:
          throw new Error(`Format ${format.id} must be imported through the CSV mapping flow.`)
      }
    }

    for (const warning of result.warnings) logger.warn('parser', `${file.name}: ${warning}`)
    const dataset = makeDataset(file.name, format.id, result, file.size)
    logger.success('parser', `Loaded ${dataset.points.length} points from ${file.name}`, {
      format: format.id,
      channels: dataset.channels,
    })
    return dataset
  })
}
