import { useEffect, useMemo, useState } from 'react'
import type { LatLngBoundsExpression, LatLngTuple } from 'leaflet'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { convertCsvToGpx } from './lib/gpx'
import type {
  CsvAnalysisResult,
  DetectedColumn,
  ElevationUnit,
  MappingState,
  TimeUnit,
} from './types/converter'

type WorkerMessage =
  | {
      type: 'progress'
      payload: {
        progress: number
        sampled: number
      }
    }
  | {
      type: 'complete'
      payload: CsvAnalysisResult
    }
  | {
      type: 'error'
      payload: {
        message: string
      }
    }

interface PreviewPoint {
  lat: number
  lon: number
  label: string
  timestamp: number | null
}

type MapDisplayMode = 'both' | 'path' | 'points'

interface FieldHelpContent {
  title: string
  description: string
  examples: string[]
}

const FIELD_HELP: Record<string, FieldHelpContent> = {
  latitude: {
    title: 'Latitude Column',
    description: 'North/south position in decimal degrees. Valid range is -90 to 90.',
    examples: ['47.620500', '-33.868820', '51,507351 (comma decimals are accepted)'],
  },
  longitude: {
    title: 'Longitude Column',
    description: 'East/west position in decimal degrees. Valid range is -180 to 180.',
    examples: ['-122.349300', '151.209300', '0.127758'],
  },
  elevation: {
    title: 'Elevation Column',
    description: 'Height value for each point. Values are exported to GPX in meters.',
    examples: ['132.4 (meters)', '548.2 (feet, when unit is set to Feet)'],
  },
  elevationUnit: {
    title: 'Elevation Unit',
    description: 'Unit used by your CSV elevation values before GPX conversion.',
    examples: ['Meters: 132.4 -> 132.4 m', 'Feet: 548.2 -> 167.091 m'],
  },
  timestamp: {
    title: 'Timestamp Column',
    description: 'Date/time value per point. Pair this with the correct timestamp format.',
    examples: ['2026-06-10T14:35:22Z', '1718036122', '1718036122000', '45450.52431'],
  },
  timeUnit: {
    title: 'Timestamp Format',
    description: 'How timestamp values are interpreted. Epoch is sometimes written as EPOC.',
    examples: [
      'ISO 8601: 2026-06-10T14:35:22Z',
      'Epoch seconds (EPOC): 1718036122',
      'Epoch milliseconds (EPOC ms): 1718036122000',
      'Excel serial: 45450.52431',
    ],
  },
  name: {
    title: 'Name Column',
    description: 'Optional short point title. Exported to GPX as point name.',
    examples: ['Checkpoint 12', 'Trailhead', 'WP-0007'],
  },
  description: {
    title: 'Description Column',
    description: 'Optional detailed note for each point. Exported as GPX desc/cmt text.',
    examples: ['Gate near tower', 'Surface changed to gravel at km 3.2'],
  },
}

function FieldHelp({ helpKey }: { helpKey: keyof typeof FIELD_HELP }) {
  const help = FIELD_HELP[helpKey]

  return (
    <span className="field-help">
      <button
        type="button"
        className="field-help-trigger"
        aria-label={`${help.title} help`}
      >
        i
      </button>
      <span className="field-help-popover" role="tooltip">
        <strong>{help.title}</strong>
        <span>{help.description}</span>
        {help.examples.map((example) => (
          <span key={`${helpKey}-${example}`}>{example}</span>
        ))}
      </span>
    </span>
  )
}

const INITIAL_MAPPING: MappingState = {
  latitude: '',
  longitude: '',
  elevation: '',
  timestamp: '',
  name: '',
  description: '',
  elevationUnit: 'meters',
  timeUnit: 'iso',
}

function normalizeFileStem(fileName: string): string {
  const withoutExt = fileName.replace(/\.[^.]+$/, '')
  return withoutExt || 'converted-track'
}

function createDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function parseNumber(rawValue: string): number | null {
  const value = rawValue.trim()
  if (!value) {
    return null
  }

  const normalized = /^-?\d+,\d+$/.test(value)
    ? value.replace(',', '.')
    : value.replaceAll(',', '')

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function parseTimestamp(rawValue: string, mode: TimeUnit): number | null {
  const value = rawValue.trim()
  if (!value) {
    return null
  }

  if (mode === 'iso') {
    const date = new Date(value)
    return Number.isNaN(date.valueOf()) ? null : date.valueOf()
  }

  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return null
  }

  if (mode === 'epoch_seconds') {
    return numeric * 1000
  }

  if (mode === 'epoch_milliseconds') {
    return numeric
  }

  return (numeric - 25569) * 86400 * 1000
}

function suggestedColumn(columns: DetectedColumn[], field: string): string {
  const winner = columns
    .map((column) => ({
      name: column.name,
      score: column.candidates.find((candidate) => candidate.field === field)?.score ?? 0,
    }))
    .sort((a, b) => b.score - a.score)[0]

  return winner && winner.score >= 0.45 ? winner.name : ''
}

function computePreviewPoints(
  analysis: CsvAnalysisResult | null,
  mapping: MappingState,
): { points: PreviewPoint[]; validCount: number } {
  if (!analysis || !mapping.latitude || !mapping.longitude) {
    return {
      points: [],
      validCount: 0,
    }
  }

  const previewPoints: PreviewPoint[] = []

  for (const row of analysis.sampleRows) {
    const latitude = parseNumber(row[mapping.latitude] ?? '')
    const longitude = parseNumber(row[mapping.longitude] ?? '')

    if (latitude === null || longitude === null) {
      continue
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      continue
    }

    const label = mapping.name ? (row[mapping.name] ?? '') : ''
    const timestamp = mapping.timestamp
      ? parseTimestamp(row[mapping.timestamp] ?? '', mapping.timeUnit)
      : null

    previewPoints.push({
      lat: latitude,
      lon: longitude,
      label,
      timestamp,
    })
  }

  const sorted = mapping.timestamp
    ? [...previewPoints].sort((a, b) => {
        if (a.timestamp === null && b.timestamp === null) {
          return 0
        }

        if (a.timestamp === null) {
          return 1
        }

        if (b.timestamp === null) {
          return -1
        }

        return a.timestamp - b.timestamp
      })
    : previewPoints

  if (sorted.length <= 1600) {
    return {
      points: sorted,
      validCount: sorted.length,
    }
  }

  const step = Math.ceil(sorted.length / 1600)
  const reduced = sorted.filter((_, index) => index % step === 0)

  return {
    points: reduced,
    validCount: sorted.length,
  }
}

function countValidCoordinatesForColumns(
  analysis: CsvAnalysisResult | null,
  latitudeColumn: string,
  longitudeColumn: string,
): number {
  if (!analysis || !latitudeColumn || !longitudeColumn) {
    return 0
  }

  let validCount = 0

  for (const row of analysis.sampleRows) {
    const latitude = parseNumber(row[latitudeColumn] ?? '')
    const longitude = parseNumber(row[longitudeColumn] ?? '')

    if (latitude === null || longitude === null) {
      continue
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      continue
    }

    validCount += 1
  }

  return validCount
}

function FitPreviewBounds({ points }: { points: LatLngTuple[] }) {
  const map = useMap()

  useEffect(() => {
    if (points.length === 0) {
      return
    }

    const bounds: LatLngBoundsExpression = points
    map.fitBounds(bounds, {
      padding: [24, 24],
      maxZoom: 15,
    })
  }, [map, points])

  return null
}

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [analysis, setAnalysis] = useState<CsvAnalysisResult | null>(null)
  const [mapping, setMapping] = useState<MappingState>(INITIAL_MAPPING)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState(0)
  const [sampledRows, setSampledRows] = useState(0)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [lastExport, setLastExport] = useState('')
  const [mapMode, setMapMode] = useState<MapDisplayMode>('both')
  const [trackNameOverride, setTrackNameOverride] = useState('')
  const [lastExportStats, setLastExportStats] = useState<{
    processedRows: number
    skippedMissingCoordinates: number
    skippedOutOfRangeCoordinates: number
    includedElevation: number
    includedTimestamp: number
  } | null>(null)

  const columnOptions = analysis?.columns ?? []
  const canExport = Boolean(file && mapping.latitude && mapping.longitude)

  const previewResult = useMemo(() => computePreviewPoints(analysis, mapping), [analysis, mapping])
  const swappedValidCount = useMemo(
    () => countValidCoordinatesForColumns(analysis, mapping.longitude, mapping.latitude),
    [analysis, mapping.latitude, mapping.longitude],
  )
  const mappingDiagnostics = useMemo(() => {
    const currentValidCount = previewResult.validCount
    const suggestedSwap =
      currentValidCount > 0 &&
      swappedValidCount >= Math.max(14, Math.round(currentValidCount * 1.6))

    return {
      currentValidCount,
      swappedValidCount,
      suggestedSwap,
    }
  }, [previewResult.validCount, swappedValidCount])
  const mapPositions = useMemo<LatLngTuple[]>(
    () => previewResult.points.map((point) => [point.lat, point.lon]),
    [previewResult.points],
  )

  const delimiterLabel = useMemo(() => {
    if (!analysis?.delimiter) {
      return 'Auto'
    }

    if (analysis.delimiter === ',') {
      return 'Comma (,)'
    }

    if (analysis.delimiter === ';') {
      return 'Semicolon (;)'
    }

    if (analysis.delimiter === '\t') {
      return 'Tab (\\t)'
    }

    return `Custom (${analysis.delimiter})`
  }, [analysis])

  const onFileSelected = (nextFile: File | null) => {
    setFile(nextFile)
    setAnalysis(null)
    setMapping(INITIAL_MAPPING)
    setAnalysisProgress(0)
    setSampledRows(0)
    setError('')
    setLastExport('')
    setLastExportStats(null)
    setTrackNameOverride(nextFile ? normalizeFileStem(nextFile.name) : '')

    if (!nextFile) {
      return
    }

    setAnalyzing(true)

    const worker = new Worker(new URL('./workers/csvAnalyzer.worker.ts', import.meta.url), {
      type: 'module',
    })

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data

      if (message.type === 'progress') {
        setAnalysisProgress(message.payload.progress)
        setSampledRows(message.payload.sampled)
      }

      if (message.type === 'error') {
        setError(message.payload.message)
        setAnalyzing(false)
        worker.terminate()
      }

      if (message.type === 'complete') {
        setAnalysis(message.payload)
        setAnalyzing(false)
        setMapping((current) => ({
          ...current,
          latitude: suggestedColumn(message.payload.columns, 'latitude'),
          longitude: suggestedColumn(message.payload.columns, 'longitude'),
          elevation: suggestedColumn(message.payload.columns, 'elevation'),
          timestamp: suggestedColumn(message.payload.columns, 'timestamp'),
          name: suggestedColumn(message.payload.columns, 'name'),
          description: suggestedColumn(message.payload.columns, 'description'),
        }))
        worker.terminate()
      }
    }

    worker.postMessage({
      type: 'analyze',
      payload: {
        file: nextFile,
        sampleLimit: 5000,
      },
    })
  }

  const updateMapping = (key: keyof MappingState, value: string) => {
    setMapping((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const updateElevationUnit = (value: ElevationUnit) => {
    setMapping((current) => ({
      ...current,
      elevationUnit: value,
    }))
  }

  const updateTimeUnit = (value: TimeUnit) => {
    setMapping((current) => ({
      ...current,
      timeUnit: value,
    }))
  }

  const runExport = async () => {
    if (!file || !canExport) {
      return
    }

    setExporting(true)
    setError('')
    setLastExport('')
    setLastExportStats(null)

    try {
      const defaultTrackName = normalizeFileStem(file.name)
      const trackName = trackNameOverride.trim() || defaultTrackName
      const result = await convertCsvToGpx({
        file,
        mapping,
        delimiter: analysis?.delimiter,
        trackName,
        onProgress: setExportProgress,
      })

      const outputName = `${trackName}.gpx`
      createDownload(result.blob, outputName)
      setLastExport(`Exported ${result.pointCount.toLocaleString()} points to ${outputName}`)
      setLastExportStats(result.stats)
      setExportProgress(100)
    } catch (conversionError) {
      if (conversionError instanceof Error) {
        setError(conversionError.message)
      } else {
        setError('Conversion failed for an unknown reason.')
      }
    } finally {
      setExporting(false)
    }
  }

  return (
    <main className="app-shell noir">
      <section className="hero-panel compact-hero">
        <div>
          <p className="kicker noir-accent">Joint-Domain Data Compiler</p>
          <h1>Universal CSV to GPX Converter</h1>
        </div>
        <p className="hero-copy">
          Dense local workflow for profiling large CSVs, validating mappings, previewing routes,
          and exporting GPX without freezing the UI.
        </p>
      </section>

      <section className="dashboard-grid">
        <section className="panel compact-panel">
          <div className="panel-title-row">
            <h2>1. Source File</h2>
            {file && <span className="status-pill">{file.name}</span>}
          </div>
          <label className="file-input-wrap">
            <span>Select CSV File</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => onFileSelected(event.target.files?.[0] ?? null)}
            />
          </label>
          {analyzing && (
            <div className="progress-wrap compact-progress">
              <p>Profiling {sampledRows.toLocaleString()} sampled rows</p>
              <progress value={analysisProgress} max={100}></progress>
            </div>
          )}
          {analysis && (
            <div className="inline-meta-grid">
              <span>delimiter <strong>{delimiterLabel}</strong></span>
              <span>sampled <strong>{analysis.rowCountSampled.toLocaleString()}</strong></span>
              <span>columns <strong>{analysis.columns.length.toLocaleString()}</strong></span>
            </div>
          )}
        </section>

        <section className="panel compact-panel panel-actions">
          <h2>5. Export GPX</h2>
          <label className="track-name-field">
            Track Name
            <input
              type="text"
              value={trackNameOverride}
              onChange={(event) => setTrackNameOverride(event.target.value)}
              placeholder={file ? normalizeFileStem(file.name) : 'converted-track'}
            />
          </label>
          <p className="compact-copy">
            Requires latitude + longitude. Optional values are injected only when valid.
          </p>
          <button type="button" disabled={!canExport || exporting} onClick={runExport}>
            {exporting ? 'Converting...' : 'Export Universal GPX'}
          </button>
          {exporting && (
            <div className="progress-wrap compact-progress">
              <p>Building GPX from streamed chunks</p>
              <progress value={exportProgress} max={100}></progress>
            </div>
          )}
          {lastExport && <p className="success-line">{lastExport}</p>}
          {lastExportStats && (
            <div className="export-stats compact-export-stats">
              <span>rows processed {lastExportStats.processedRows.toLocaleString()}</span>
              <span>missing coords skipped {lastExportStats.skippedMissingCoordinates.toLocaleString()}</span>
              <span>out-of-range skipped {lastExportStats.skippedOutOfRangeCoordinates.toLocaleString()}</span>
              <span>elevation included {lastExportStats.includedElevation.toLocaleString()}</span>
              <span>timestamps included {lastExportStats.includedTimestamp.toLocaleString()}</span>
            </div>
          )}
          {error && <p className="error-line">{error}</p>}
        </section>
      </section>

      <details className="panel compact-panel collapsible-panel">
        <summary className="collapsible-summary">
          <span>2. Column Intelligence</span>
          {analysis ? (
            <span className="summary-meta">
              {analysis.columns.length} fields analyzed, hover sample badges for values
            </span>
          ) : (
            <span className="summary-meta">Upload a CSV to inspect types and field guesses</span>
          )}
        </summary>
        {!analysis && <p className="compact-copy">Upload a CSV file to analyze headers and value patterns.</p>}
        {analysis && (
          <div className="table-wrap dense-table-wrap">
            <table className="dense-table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Sample</th>
                  <th>Likely Meaning</th>
                  <th>Estimated</th>
                  <th>Patterns</th>
                  <th>Stats</th>
                </tr>
              </thead>
              <tbody>
                {analysis.columns.map((column) => (
                  <tr key={column.name}>
                    <td className="column-name-cell">{column.name}</td>
                    <td>
                      <div className="sample-hover-card">
                        <span className="sample-trigger noir-accent">hover sample</span>
                        <div className="sample-popover">
                          {column.sampleValues.length === 0 && <span>No sample values</span>}
                          {column.sampleValues.map((value, index) => (
                            <span key={`${column.name}-sample-${index}`}>{value}</span>
                          ))}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="candidate-list compact-candidates">
                        {column.candidates.length === 0 && <span className="candidate">Unknown</span>}
                        {column.candidates.map((candidate) => (
                          <span key={`${column.name}-${candidate.field}`} className="candidate">
                            {candidate.field} ({Math.round(candidate.score * 100)}%)
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className="candidate">
                        {column.estimatedType} ({Math.round(column.estimatedConfidence * 100)}%)
                      </span>
                    </td>
                    <td>
                      <div className="candidate-list compact-candidates">
                        {column.patterns.length === 0 && <span className="candidate">No pattern</span>}
                        {column.patterns.map((pattern) => (
                          <span key={`${column.name}-${pattern}`} className="candidate">
                            {pattern}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div className="stat-grid compact-stats">
                        <span>filled {Math.round(column.stats.nonEmptyRatio * 100)}%</span>
                        <span>unique {Math.round(column.stats.uniqueRatio * 100)}%</span>
                        <span>numeric {Math.round(column.stats.numericRatio * 100)}%</span>
                        <span>datetime {Math.round(column.stats.datetimeRatio * 100)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

      <section className="panel compact-panel">
        <h2>3. Mapping and Units</h2>
        {mappingDiagnostics.suggestedSwap && (
          <p className="warn-line">
            Mapping warning: reversing latitude and longitude would produce more valid points in
            this sample ({mappingDiagnostics.swappedValidCount.toLocaleString()} vs{' '}
            {mappingDiagnostics.currentValidCount.toLocaleString()}).
            <button
              type="button"
              className="inline-action"
              onClick={() => {
                setMapping((current) => ({
                  ...current,
                  latitude: current.longitude,
                  longitude: current.latitude,
                }))
              }}
            >
              Swap now
            </button>
          </p>
        )}
        <div className="mapping-grid">
          <label>
            <span className="field-label-line">
              Latitude Column
              <FieldHelp helpKey="latitude" />
            </span>
            <select
              value={mapping.latitude}
              onChange={(event) => updateMapping('latitude', event.target.value)}
            >
              <option value="">Select column</option>
              {columnOptions.map((column) => (
                <option key={`lat-${column.name}`} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label-line">
              Longitude Column
              <FieldHelp helpKey="longitude" />
            </span>
            <select
              value={mapping.longitude}
              onChange={(event) => updateMapping('longitude', event.target.value)}
            >
              <option value="">Select column</option>
              {columnOptions.map((column) => (
                <option key={`lon-${column.name}`} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label-line">
              Elevation Column (Optional)
              <FieldHelp helpKey="elevation" />
            </span>
            <select
              value={mapping.elevation}
              onChange={(event) => updateMapping('elevation', event.target.value)}
            >
              <option value="">None</option>
              {columnOptions.map((column) => (
                <option key={`ele-${column.name}`} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label-line">
              Elevation Unit
              <FieldHelp helpKey="elevationUnit" />
            </span>
            <select
              value={mapping.elevationUnit}
              onChange={(event) => updateElevationUnit(event.target.value as ElevationUnit)}
            >
              <option value="meters">Meters</option>
              <option value="feet">Feet</option>
            </select>
          </label>
          <label>
            <span className="field-label-line">
              Timestamp Column (Optional)
              <FieldHelp helpKey="timestamp" />
            </span>
            <select
              value={mapping.timestamp}
              onChange={(event) => updateMapping('timestamp', event.target.value)}
            >
              <option value="">None</option>
              {columnOptions.map((column) => (
                <option key={`time-${column.name}`} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label-line">
              Timestamp Format
              <FieldHelp helpKey="timeUnit" />
            </span>
            <select
              value={mapping.timeUnit}
              onChange={(event) => updateTimeUnit(event.target.value as TimeUnit)}
            >
              <option value="iso">ISO 8601</option>
              <option value="epoch_seconds">Epoch Seconds</option>
              <option value="epoch_milliseconds">Epoch Milliseconds</option>
              <option value="excel_serial">Excel Serial Date</option>
            </select>
          </label>
          <label>
            <span className="field-label-line">
              Name Column (Optional)
              <FieldHelp helpKey="name" />
            </span>
            <select
              value={mapping.name}
              onChange={(event) => updateMapping('name', event.target.value)}
            >
              <option value="">None</option>
              {columnOptions.map((column) => (
                <option key={`name-${column.name}`} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label-line">
              Description Column (Optional)
              <FieldHelp helpKey="description" />
            </span>
            <select
              value={mapping.description}
              onChange={(event) => updateMapping('description', event.target.value)}
            >
              <option value="">None</option>
              {columnOptions.map((column) => (
                <option key={`desc-${column.name}`} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="panel compact-panel">
        <h2>4. Live Map Preview</h2>
        {!analysis && <p>Upload and analyze a CSV file to enable map preview.</p>}
        {analysis && !mapping.latitude && !mapping.longitude && (
          <p>Select latitude and longitude columns to display the route.</p>
        )}
        {analysis && (mapping.latitude || mapping.longitude) && (
          <>
            <div className="map-toolbar">
              <label>
                Display Mode
                <select
                  value={mapMode}
                  onChange={(event) => setMapMode(event.target.value as MapDisplayMode)}
                >
                  <option value="both">Path + Points</option>
                  <option value="path">Path only</option>
                  <option value="points">Points only</option>
                </select>
              </label>
            </div>
            <p className="meta-line">
              Plotted sample points: <strong>{previewResult.points.length.toLocaleString()}</strong>
              {' '}
              from valid coordinates:{' '}
              <strong>{previewResult.validCount.toLocaleString()}</strong>
            </p>
            {previewResult.points.length === 0 && (
              <p className="error-line small-line">
                No valid coordinates found for the current column selections.
              </p>
            )}
            {previewResult.points.length > 0 && (
              <div className="map-wrap">
                <MapContainer center={mapPositions[0]} zoom={8} className="map-canvas" scrollWheelZoom>
                  <TileLayer
                    attribution="&copy; OpenStreetMap contributors"
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  {mapMode !== 'points' && (
                    <Polyline positions={mapPositions} pathOptions={{ color: '#ea4f2f', weight: 3 }} />
                  )}
                  {mapMode !== 'path' &&
                    previewResult.points.map((point, index) => (
                      <CircleMarker
                        key={`${point.lat}-${point.lon}-${index}`}
                        center={[point.lat, point.lon]}
                        radius={2.6}
                        pathOptions={{
                          color: '#0f8c6f',
                          fillColor: '#0f8c6f',
                          fillOpacity: 0.68,
                          weight: 0,
                        }}
                      >
                        {point.label && <Tooltip>{point.label}</Tooltip>}
                      </CircleMarker>
                    ))}
                  <FitPreviewBounds points={mapPositions} />
                </MapContainer>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  )
}

export default App
