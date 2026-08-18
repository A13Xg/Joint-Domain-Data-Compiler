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
import { sha256Hex } from '../checksum'
import { parseGpx } from './gpx'
import { parseGeoJson } from './geojson'
import { parseKml } from './kml'
import { parseNmea } from './nmea'
import { parseGpb, looksLikeGpb } from './gpb'
import { parseEag } from './eag'
import { assertByteBudget, assertPointBudget, DEFAULT_FORMAT_BUDGETS } from './limits'
import { describeSignatureMismatch, sniffBinarySignature, sniffTextSignature } from './contentSignature'

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
  { id: 'eag', label: 'EAG TSPI', extensions: ['eag', 'txt'], binary: false, needsMapping: false, description: 'European Air Group TSPI (tab-delimited ECEF coordinates from NATO range instrumentation).' },
]

export function detectFormat(fileName: string): FormatDescriptor | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  for (const fmt of INPUT_FORMATS) {
    if (fmt.extensions.includes(ext)) return fmt
  }
  return null
}

export function resolveTextFormat(text: string): SourceFormat {
  // Check for EAG header shape: 7 tab-separated fields on first line, and 11 fields on data rows
  const lines = text.trim().split(/\r?\n/)
  if (lines.length >= 2) {
    const headerFields = lines[0]!.split('\t')
    const firstDataFields = lines[1]!.split('\t')
    // EAG: header has 7 fields, data rows have 11 fields
    if (headerFields.length === 7 && firstDataFields.length === 11) {
      return 'eag'
    }
  }
  // Default to CSV for ambiguous .txt files
  return 'csv'
}

const PARSER_VERSION = '1'

export function makeDataset(
  name: string,
  format: SourceFormat,
  result: ParseResult,
  sourceBytes?: number,
  checksum?: string,
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
        checksum,
        parserId: format,
        parserVersion: PARSER_VERSION,
      },
      meta: result.meta,
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
    assertByteBudget(format.id, file.size)

    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    const checksum = await sha256Hex(bytes)

    let result: ParseResult
    let mismatch: string | null
    let resolvedFormat: SourceFormat = format.id

    if (format.binary) {
      if (format.id === 'gpb' || looksLikeGpb(bytes)) {
        result = parseGpb(buffer, DEFAULT_FORMAT_BUDGETS.gpb.maxPoints)
      } else {
        throw new Error(`No binary parser available for ${file.name}.`)
      }
      mismatch = describeSignatureMismatch(format.id, sniffBinarySignature(bytes))
    } else {
      const text = new TextDecoder('utf-8').decode(bytes)

      // Disambiguate .txt files: EAG vs CSV via content sniffing
      if (format.id === 'csv' && file.name.toLowerCase().endsWith('.txt')) {
        resolvedFormat = resolveTextFormat(text)
      }

      mismatch = describeSignatureMismatch(resolvedFormat, sniffTextSignature(text))
      switch (resolvedFormat) {
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
        case 'eag':
          result = parseEag(text, file.name)
          break
        default:
          throw new Error(`Format ${resolvedFormat} must be imported through the CSV mapping flow.`)
      }
    }
    if (mismatch) result.warnings.push(mismatch)

    assertPointBudget(resolvedFormat, result.points.length)

    for (const warning of result.warnings) logger.warn('parser', `${file.name}: ${warning}`)
    const dataset = makeDataset(file.name, resolvedFormat, result, file.size, checksum)
    logger.success('parser', `Loaded ${dataset.points.length} points from ${file.name}`, {
      format: format.id,
      channels: dataset.channels,
      checksum,
      warnings: dataset.warnings.length,
    })
    return dataset
  })
}
