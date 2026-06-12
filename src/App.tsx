import { useCallback, useMemo, useRef, useState } from 'react'
import type { CsvAnalysisResult, DetectedColumn } from './types/converter'
import type { Dataset, TrackPoint } from './core/model'
import { withPoints } from './core/transforms'
import { detectFormat, makeDataset, parseFileToDataset, INPUT_FORMATS } from './core/parsers'
import { buildPointsFromCsvRows, parseCsvFile, type CsvMapping } from './core/parsers/csv'
import { logger } from './core/logger'
import { formatBytes } from './core/format'
import { Spinner, ProgressBar } from './ui/Spinner'
import { LogConsole } from './ui/LogConsole'
import { MapView } from './ui/MapView'
import { TimeSeriesChart } from './ui/TimeSeriesChart'
import { DataTable } from './ui/DataTable'
import { StatsPanel } from './ui/StatsPanel'
import { TransformPanel } from './ui/TransformPanel'
import { ExportPanel } from './ui/ExportPanel'
import { MappingPanel } from './ui/MappingPanel'

type Tab = 'import' | 'mapping' | 'overview' | 'map' | 'charts' | 'table' | 'transform' | 'export'

interface History {
  past: Dataset[]
  future: Dataset[]
}

interface PendingCsv {
  file: File
  analysis: CsvAnalysisResult
  mapping: CsvMapping
}

const CSV_SAMPLE_LIMIT = 5000

function suggestColumn(columns: DetectedColumn[], field: string, threshold = 0.45): string {
  let best = ''
  let bestScore = 0
  for (const c of columns) {
    const s = c.candidates.find((cand) => cand.field === field)?.score ?? 0
    if (s > bestScore) {
      bestScore = s
      best = c.name
    }
  }
  return bestScore >= threshold ? best : ''
}

function defaultMapping(analysis: CsvAnalysisResult): CsvMapping {
  return {
    latitude: suggestColumn(analysis.columns, 'latitude'),
    longitude: suggestColumn(analysis.columns, 'longitude'),
    elevation: suggestColumn(analysis.columns, 'elevation'),
    timestamp: suggestColumn(analysis.columns, 'timestamp'),
    name: suggestColumn(analysis.columns, 'name'),
    description: suggestColumn(analysis.columns, 'description'),
    elevationUnit: 'meters',
    timeFormat: 'auto',
  }
}

export default function App() {
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [histories, setHistories] = useState<Record<string, History>>({})
  const [tab, setTab] = useState<Tab>('import')
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [pendingCsv, setPendingCsv] = useState<PendingCsv | null>(null)
  const [building, setBuilding] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const active = useMemo(() => datasets.find((d) => d.id === activeId) ?? null, [datasets, activeId])
  const history = activeId ? histories[activeId] : undefined

  const flashToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200)
  }, [])

  const addDataset = useCallback(
    (dataset: Dataset) => {
      setDatasets((prev) => [...prev, dataset])
      setActiveId(dataset.id)
      setHistories((prev) => ({ ...prev, [dataset.id]: { past: [], future: [] } }))
      setTab('overview')
      flashToast(`Loaded ${dataset.points.length.toLocaleString()} points from ${dataset.name}`)
    },
    [flashToast],
  )

  // --- CSV analysis via web worker -----------------------------------------
  const analyzeCsv = useCallback((file: File) => {
    setBusy(`Analyzing ${file.name}`)
    setProgress(0)
    logger.info('import', `Analyzing CSV ${file.name} (${formatBytes(file.size)})`)
    const worker = new Worker(new URL('./workers/csvAnalyzer.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data
      if (msg.type === 'progress') {
        setProgress(msg.payload.progress)
      } else if (msg.type === 'error') {
        logger.error('import', `CSV analysis failed: ${msg.payload.message}`)
        flashToast(`CSV analysis failed: ${msg.payload.message}`)
        setBusy(null)
        setProgress(null)
        worker.terminate()
      } else if (msg.type === 'complete') {
        const analysis = msg.payload as CsvAnalysisResult
        logger.success('import', `Analyzed ${file.name}: ${analysis.columns.length} columns`)
        setPendingCsv({ file, analysis, mapping: defaultMapping(analysis) })
        setBusy(null)
        setProgress(null)
        setTab('mapping')
        worker.terminate()
      }
    }
    worker.onerror = (err) => {
      logger.error('import', `Worker error: ${err.message}`)
      setBusy(null)
      setProgress(null)
    }
    worker.postMessage({ type: 'analyze', payload: { file, sampleLimit: CSV_SAMPLE_LIMIT } })
  }, [flashToast])

  const buildCsvDataset = useCallback(async () => {
    if (!pendingCsv) return
    setBuilding(true)
    setBusy(`Building dataset from ${pendingCsv.file.name}`)
    setProgress(0)
    try {
      const { rows, columns } = await logger.time('import', `Full CSV parse ${pendingCsv.file.name}`, () =>
        parseCsvFile(pendingCsv.file, pendingCsv.analysis.delimiter, (f) => setProgress(f * 100)),
      )
      const result = buildPointsFromCsvRows(rows, pendingCsv.mapping, columns)
      for (const w of result.warnings) logger.warn('import', `${pendingCsv.file.name}: ${w}`)
      const dataset = makeDataset(pendingCsv.file.name, 'csv', result, pendingCsv.file.size)
      logger.success('import', `Built ${dataset.points.length.toLocaleString()} points from ${pendingCsv.file.name}`)
      setPendingCsv(null)
      addDataset(dataset)
    } catch (err) {
      logger.error('import', `CSV build failed: ${(err as Error).message}`)
      flashToast(`CSV build failed: ${(err as Error).message}`)
    } finally {
      setBuilding(false)
      setBusy(null)
      setProgress(null)
    }
  }, [pendingCsv, addDataset, flashToast])

  // --- generic file ingest --------------------------------------------------
  const ingestFile = useCallback(
    async (file: File) => {
      const format = detectFormat(file.name)
      if (!format) {
        logger.error('import', `Unsupported file type: ${file.name}`)
        flashToast(`Unsupported file type: ${file.name}`)
        return
      }
      if (format.needsMapping) {
        analyzeCsv(file)
        return
      }
      setBusy(`Parsing ${file.name}`)
      setProgress(null)
      try {
        const dataset = await parseFileToDataset(file, format)
        addDataset(dataset)
      } catch (err) {
        logger.error('import', `Failed to parse ${file.name}: ${(err as Error).message}`)
        flashToast(`Failed to parse ${file.name}: ${(err as Error).message}`)
      } finally {
        setBusy(null)
      }
    },
    [analyzeCsv, addDataset, flashToast],
  )

  const onFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return
      for (const file of Array.from(files)) void ingestFile(file)
    },
    [ingestFile],
  )

  // --- transforms with undo/redo -------------------------------------------
  const applyTransform = useCallback(
    (points: TrackPoint[], summary: string) => {
      if (!active) return
      const next = withPoints(active, points)
      setDatasets((prev) => prev.map((d) => (d.id === active.id ? next : d)))
      setHistories((prev) => {
        const h = prev[active.id] ?? { past: [], future: [] }
        return { ...prev, [active.id]: { past: [...h.past, active], future: [] } }
      })
      flashToast(summary)
    },
    [active, flashToast],
  )

  const undo = useCallback(() => {
    if (!active || !history || history.past.length === 0) return
    const prevDataset = history.past[history.past.length - 1]
    setDatasets((prev) => prev.map((d) => (d.id === active.id ? prevDataset : d)))
    setHistories((prev) => {
      const h = prev[active.id]
      return { ...prev, [active.id]: { past: h.past.slice(0, -1), future: [active, ...h.future] } }
    })
    logger.info('transform', 'Undo')
  }, [active, history])

  const redo = useCallback(() => {
    if (!active || !history || history.future.length === 0) return
    const nextDataset = history.future[0]
    setDatasets((prev) => prev.map((d) => (d.id === active.id ? nextDataset : d)))
    setHistories((prev) => {
      const h = prev[active.id]
      return { ...prev, [active.id]: { past: [...h.past, active], future: h.future.slice(1) } }
    })
    logger.info('transform', 'Redo')
  }, [active, history])

  const removeDataset = useCallback(
    (id: string) => {
      setDatasets((prev) => prev.filter((d) => d.id !== id))
      setHistories((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      if (activeId === id) {
        const remaining = datasets.filter((d) => d.id !== id)
        setActiveId(remaining.length ? remaining[0].id : null)
      }
    },
    [activeId, datasets],
  )

  const tabs: Array<{ id: Tab; label: string; enabled: boolean }> = [
    { id: 'import', label: 'Import', enabled: true },
    { id: 'mapping', label: 'CSV Mapping', enabled: !!pendingCsv },
    { id: 'overview', label: 'Overview', enabled: !!active },
    { id: 'map', label: 'Map', enabled: !!active },
    { id: 'charts', label: 'Charts', enabled: !!active },
    { id: 'table', label: 'Table', enabled: !!active },
    { id: 'transform', label: 'Transform', enabled: !!active },
    { id: 'export', label: 'Export', enabled: !!active },
  ]

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">JD</span>
          <div>
            <h1>Joint Domain Data Compiler</h1>
            <p>TSPI flight-data conversion &amp; analysis workbench</p>
          </div>
        </div>
        <div className="header-status">
          {busy ? (
            <Spinner label={busy} />
          ) : (
            <span className="muted small">{datasets.length} dataset{datasets.length === 1 ? '' : 's'} loaded</span>
          )}
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <button type="button" className="primary-action" onClick={() => fileInputRef.current?.click()}>
            + Load data
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden-input"
            accept=".csv,.tsv,.txt,.gpx,.geojson,.json,.kml,.nmea,.gps,.log,.gpb,.bin"
            onChange={(e) => {
              onFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <div className="dataset-list">
            {datasets.length === 0 && <p className="muted small pad">No datasets yet.</p>}
            {datasets.map((d) => (
              <div
                key={d.id}
                className={`dataset-item${d.id === activeId ? ' active' : ''}`}
                onClick={() => {
                  setActiveId(d.id)
                  if (tab === 'import' || tab === 'mapping') setTab('overview')
                }}
              >
                <div className="dataset-item-main">
                  <span className="dataset-name">{d.name}</span>
                  <span className="dataset-sub mono">
                    {d.sourceFormat} · {d.points.length.toLocaleString()} pts
                  </span>
                </div>
                <button
                  type="button"
                  className="dataset-remove"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeDataset(d.id)
                  }}
                  aria-label="Remove dataset"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="sidebar-foot">
            <span className="muted small">Supported in:</span>
            <div className="format-badges">
              {INPUT_FORMATS.map((f) => (
                <span key={f.id} className="badge" title={f.description}>{f.label}</span>
              ))}
            </div>
          </div>
        </aside>

        <main className="workspace">
          <nav className="tab-bar">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={!t.enabled}
                className={`tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
            {active && (
              <span className="tab-active-name mono">{active.name}</span>
            )}
          </nav>

          <section className="tab-content">
            {progress !== null && (
              <div className="global-progress">
                <ProgressBar value={progress} label={busy ?? 'Working'} />
              </div>
            )}

            {tab === 'import' && (
              <ImportView
                dragActive={dragActive}
                setDragActive={setDragActive}
                onFiles={onFiles}
                openPicker={() => fileInputRef.current?.click()}
              />
            )}

            {tab === 'mapping' && pendingCsv && (
              <MappingPanel
                analysis={pendingCsv.analysis}
                mapping={pendingCsv.mapping}
                onChange={(m) => setPendingCsv((p) => (p ? { ...p, mapping: m } : p))}
                onBuild={buildCsvDataset}
                building={building}
              />
            )}

            {tab === 'overview' && active && <StatsPanel dataset={active} />}
            {tab === 'map' && active && <MapView points={active.points} channels={active.channels} />}
            {tab === 'charts' && active && <TimeSeriesChart points={active.points} channels={active.channels} />}
            {tab === 'table' && active && <DataTable points={active.points} channels={active.channels} />}
            {tab === 'transform' && active && (
              <TransformPanel
                dataset={active}
                onApply={applyTransform}
                onUndo={undo}
                onRedo={redo}
                canUndo={!!history && history.past.length > 0}
                canRedo={!!history && history.future.length > 0}
              />
            )}
            {tab === 'export' && active && <ExportPanel dataset={active} />}
          </section>
        </main>
      </div>

      <section className="log-dock">
        <LogConsole />
      </section>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function ImportView({
  dragActive,
  setDragActive,
  onFiles,
  openPicker,
}: {
  dragActive: boolean
  setDragActive: (v: boolean) => void
  onFiles: (files: FileList | null) => void
  openPicker: () => void
}) {
  return (
    <div className="import-view">
      <div
        className={`dropzone${dragActive ? ' drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragActive(false)
          onFiles(e.dataTransfer.files)
        }}
        onClick={openPicker}
      >
        <div className="dropzone-inner">
          <div className="dropzone-icon">⬇</div>
          <h2>Drop TSPI data here</h2>
          <p>or click to browse</p>
          <div className="dropzone-formats">
            {INPUT_FORMATS.map((f) => (
              <span key={f.id} className="format-pill">
                <strong>{f.label}</strong>
                <span>.{f.extensions[0]}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="import-notes">
        <h3>Conversion matrix</h3>
        <p className="muted small">
          Any input format normalizes into a unified point model and can be exported to GPX, CSV,
          GeoJSON, KML, or the lossless GPB binary container. Coordinates accept decimal degrees, DMS,
          and comma decimals; timestamps auto-detect epoch s/ms/µs, Excel serial, and ISO-8601.
        </p>
      </div>
    </div>
  )
}
