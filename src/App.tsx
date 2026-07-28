import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CsvAnalysisResult, DetectedColumn } from './types/converter'
import type { Dataset, TrackPoint } from './core/model'
import { withPoints } from './core/transforms'
import { detectFormat, makeDataset, parseFileToDataset, INPUT_FORMATS } from './core/parsers'
import { streamCsvFileToPoints, CsvImportCancelledError, type CsvMapping } from './core/parsers/csv'
import { assertByteBudget, assertPointBudget, DEFAULT_FORMAT_BUDGETS } from './core/parsers/limits'
import { describeSignatureMismatch, sniffTextSignature } from './core/parsers/contentSignature'
import { sha256Hex } from './core/checksum'
import { logger } from './core/logger'
import { formatBytes } from './core/format'
import { Spinner, ProgressBar } from './ui/Spinner'
import { LogConsole } from './ui/LogConsole'
import { MapView, type OtherTrack } from './ui/MapView'
import { SourcesPanel } from './ui/SourcesPanel'
import { restoreWorkspaceDisplay, syncWorkspaceDisplay, type WorkspaceDisplay } from './state/workspaceDisplay'
import { TimeSeriesChart } from './ui/TimeSeriesChart'
import { DataTable } from './ui/DataTable'
import { StatsPanel } from './ui/StatsPanel'
import { TransformPanel } from './ui/TransformPanel'
import { NotionalSmoothingPanel } from './ui/NotionalSmoothingPanel'
import { FusionPanel } from './ui/FusionPanel'
import { ExportPanel } from './ui/ExportPanel'
import { MappingPanel } from './ui/MappingPanel'
import { ImportView } from './ui/ImportView'
import { ComparisonPanel } from './ui/ComparisonPanel'
import { Trajectory3dPanel } from './ui/Trajectory3dPanel'
import { ProjectPanel } from './ui/ProjectPanel'
import { KmlLibraryPanel } from './ui/KmlLibraryPanel'
import { getSelectedPointIndex, getSelectedRange, restorePointSelection } from './state/pointSelection'
import type { ProjectArchive, ProjectDatasetHistory } from './persistence/project/archive'
import type { ProjectBookmark } from './persistence/project/manifest'
import { operationRecordsFromManifest } from './persistence/project/manifest'
import { parseKml } from './core/parsers/kml'
import { isDesktopKmlLibraryAvailable, readKmlLibraryText, saveKmlLibraryFile } from './desktop/kmlLibrary'
import { insertDataset } from './core/ids'
import { DEFAULT_WORKSPACE_STATE, normalizeWorkspaceState, type WorkspaceState } from './state/workspace'
import { ensureBuiltinDerivationsRegistered } from './core/analytics/bootstrap'
import { fingerprintDataset } from './core/recipes/hash'
import type { OperationRecord } from './core/recipes/model'
import { ensureBuiltinOperationsRegistered } from './core/operations/basic'
import { appendHistorySnapshot } from './state/history'

ensureBuiltinDerivationsRegistered()
ensureBuiltinOperationsRegistered()

export type Tab = 'import' | 'mapping' | 'overview' | 'map' | 'charts' | 'table' | 'compare' | 'scene3d' | 'transform' | 'project' | 'export' | 'sources' | 'fusion'

type History = ProjectDatasetHistory
interface PendingCsv { file: File; analysis: CsvAnalysisResult; mapping: CsvMapping; additionalHeaders: boolean; dataStartRow: number }
const CSV_SAMPLE_LIMIT = 5000

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'transform'
}

function suggestColumn(columns: DetectedColumn[], field: string, threshold = 0.45): string {
  let best = ''
  let bestScore = 0
  for (const column of columns) {
    const score = column.candidates.find((candidate) => candidate.field === field)?.score ?? 0
    if (score > bestScore) { bestScore = score; best = column.name }
  }
  return bestScore >= threshold ? best : ''
}

function defaultMapping(analysis: CsvAnalysisResult): CsvMapping {
  const elevation = suggestColumn(analysis.columns, 'elevation')
  const elevationColumn = analysis.columns.find((column) => column.name === elevation)
  const elevationLabels = elevationColumn?.headerCandidates.join(' ') ?? ''
  return {
    latitude: suggestColumn(analysis.columns, 'latitude'), longitude: suggestColumn(analysis.columns, 'longitude'), elevation,
    timestamp: suggestColumn(analysis.columns, 'timestamp'), name: suggestColumn(analysis.columns, 'name'),
    description: suggestColumn(analysis.columns, 'description'),
    elevationUnit: /\bf(?:ee|oo)?t\b|_ft\b|\bft_/i.test(elevationLabels) ? 'feet' : 'meters', timeFormat: 'auto',
  }
}

export default function App() {
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [histories, setHistories] = useState<Record<string, History>>({})
  const [operationRecords, setOperationRecords] = useState<Record<string, OperationRecord[]>>({})
  const [datasetDisplay, setDatasetDisplay] = useState<WorkspaceDisplay>({})
  const [bookmarks, setBookmarks] = useState<ProjectBookmark[]>([])
  const [projectName, setProjectName] = useState('')
  const [projectNotes, setProjectNotes] = useState('')
  const [projectDirty, setProjectDirty] = useState(false)
  // Reconcile display settings (new datasets get a color; removed datasets'
  // entries are dropped) during render when the dataset list changes,
  // rather than in an effect — same "adjusting state during render"
  // pattern used for MapView's basemap-status reset.
  const syncedDisplay = syncWorkspaceDisplay(datasetDisplay, datasets)
  if (syncedDisplay !== datasetDisplay) setDatasetDisplay(syncedDisplay)
  const [tab, setTab] = useState<Tab>('import')
  const [workspace, setWorkspace] = useState<WorkspaceState>(DEFAULT_WORKSPACE_STATE)
  const [mapOverlayTracks, setMapOverlayTracks] = useState<OtherTrack[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [pendingCsv, setPendingCsv] = useState<PendingCsv | null>(null)
  const [building, setBuilding] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const cancelCsvRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const active = useMemo(() => datasets.find((dataset) => dataset.id === activeId) ?? null, [datasets, activeId])
  const history = activeId ? histories[activeId] : undefined
  const selectTab = useCallback((next: Tab) => {
    setTab(next)
    if (isWorkspaceTab(next)) {
      setWorkspace((current) => ({ ...current, lastWorkspaceTab: next }))
      setProjectDirty(true)
    }
  }, [])

  useEffect(() => {
    if (!projectDirty) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = true
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [projectDirty])

  useEffect(() => {
    if (!isDesktopKmlLibraryAvailable()) return
    let cancelled = false
    const overlayRefs = workspace.mapOverlays.overlays.filter((overlay) => overlay.sourceKind === 'library' && overlay.status !== 'missing')
    void Promise.all(overlayRefs.map(async (overlay) => {
      try {
        const source = await readKmlLibraryText(overlay.sourceKey)
        return { id: overlay.id, name: overlay.name, color: '#7c3aed', points: parseKml(source.text).points } satisfies OtherTrack
      } catch {
        return null
      }
    })).then((loaded) => {
      if (cancelled) return
      setMapOverlayTracks(loaded.filter((track): track is OtherTrack => track !== null))
      const missingIds = new Set(overlayRefs.flatMap((overlay, index) => loaded[index] === null ? [overlay.id] : []))
      if (missingIds.size > 0) {
        setWorkspace((current) => ({
          ...current,
          mapOverlays: {
            overlays: current.mapOverlays.overlays.map((overlay) => missingIds.has(overlay.id)
              ? { ...overlay, status: 'missing', visible: false }
              : overlay),
          },
        }))
      }
    })
    return () => { cancelled = true }
  }, [workspace.mapOverlays])

  const flashToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast((current) => current === message ? null : current), 3200)
  }, [])

  const addDataset = useCallback((dataset: Dataset) => {
    if (datasets.some((current) => current.id === dataset.id)) {
      flashToast(`Could not load ${dataset.name}: duplicate dataset identity.`)
      return
    }
    setDatasets((current) => insertDataset(current, dataset))
    setActiveId(dataset.id)
    setHistories((current) => ({ ...current, [dataset.id]: { past: [], future: [] } }))
    setProjectDirty(true)
    setTab('overview')
    const warningNote = dataset.warnings.length > 0 ? `, ${dataset.warnings.length} warning(s)` : ''
    flashToast(`Loaded ${dataset.points.length.toLocaleString()} points from ${dataset.name}${warningNote}`)
  }, [datasets, flashToast])

  const analyzeCsv = useCallback((file: File) => {
    try {
      assertByteBudget('csv', file.size)
    } catch (error) {
      logger.error('import', `CSV rejected: ${(error as Error).message}`)
      flashToast((error as Error).message)
      return
    }
    setBusy(`Analyzing ${file.name}`)
    setProgress(0)
    logger.info('import', `Analyzing CSV ${file.name} (${formatBytes(file.size)})`)
    const worker = new Worker(new URL('./workers/csvAnalyzer.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data
      if (message.type === 'progress') setProgress(message.payload.progress)
      else if (message.type === 'error') {
        logger.error('import', `CSV analysis failed: ${message.payload.message}`)
        flashToast(`CSV analysis failed: ${message.payload.message}`)
        setBusy(null); setProgress(null); worker.terminate()
      } else if (message.type === 'complete') {
        const analysis = message.payload as CsvAnalysisResult
        logger.success('import', `Analyzed ${file.name}: ${analysis.columns.length} columns`)
        setPendingCsv({ file, analysis, mapping: defaultMapping(analysis), additionalHeaders: false, dataStartRow: analysis.dataStartRow })
        setBusy(null); setProgress(null); setTab('mapping'); worker.terminate()
      }
    }
    worker.onerror = (error) => { logger.error('import', `Worker error: ${error.message}`); setBusy(null); setProgress(null); worker.terminate() }
    worker.postMessage({ type: 'analyze', payload: { file, sampleLimit: CSV_SAMPLE_LIMIT } })
  }, [flashToast])

  const buildCsvDataset = useCallback(async () => {
    if (!pendingCsv) return
    cancelCsvRef.current = false
    setBuilding(true); setBusy(`Building dataset from ${pendingCsv.file.name}`); setProgress(0)
    try {
      // Rows are mapped into TrackPoints as each chunk streams in, so only the
      // point array — the representation the rest of the app needs — is held
      // for the lifetime of the import; a full raw-row array is never built
      // alongside it.
      const result = await logger.time('import', `Streaming CSV parse ${pendingCsv.file.name}`, () => streamCsvFileToPoints(
        pendingCsv.file, pendingCsv.analysis.delimiter, pendingCsv.analysis.columns.map((column) => column.name),
        pendingCsv.dataStartRow, pendingCsv.mapping,
        {
          onProgress: (fraction) => setProgress(fraction * 100),
          isCancelled: () => cancelCsvRef.current,
          maxPoints: DEFAULT_FORMAT_BUDGETS.csv.maxPoints,
        },
      ))
      // Full-file checksum/signature read is separate from the streamed
      // point construction above; it is a one-time cost paid once per
      // import, not held alongside the growing point array.
      const bytes = new Uint8Array(await pendingCsv.file.arrayBuffer())
      const checksum = await sha256Hex(bytes)
      const mismatch = describeSignatureMismatch('csv', sniffTextSignature(new TextDecoder('utf-8').decode(bytes)))
      if (mismatch) result.warnings.push(mismatch)
      for (const warning of result.warnings) logger.warn('import', `${pendingCsv.file.name}: ${warning}`)
      const dataset = makeDataset(pendingCsv.file.name, 'csv', result, pendingCsv.file.size, checksum)
      logger.success('import', `Built ${dataset.points.length.toLocaleString()} points from ${pendingCsv.file.name}`, {
        checksum,
        warnings: dataset.warnings.length,
      })
      setPendingCsv(null); addDataset(dataset)
    } catch (error) {
      if (error instanceof CsvImportCancelledError) {
        logger.info('import', `CSV build cancelled for ${pendingCsv.file.name}`)
        flashToast('CSV import cancelled.')
      } else {
        logger.error('import', `CSV build failed: ${(error as Error).message}`)
        flashToast(`CSV build failed: ${(error as Error).message}`)
      }
    } finally { setBuilding(false); setBusy(null); setProgress(null) }
  }, [pendingCsv, addDataset, flashToast])

  const cancelCsvBuild = useCallback(() => { cancelCsvRef.current = true }, [])

  const importKmlText = useCallback(async (name: string, text: string, sourceBytes?: number) => {
    try {
      const result = parseKml(text)
      const mismatch = describeSignatureMismatch('kml', sniffTextSignature(text))
      if (mismatch) result.warnings.push(mismatch)
      assertPointBudget('kml', result.points.length)
      for (const warning of result.warnings) logger.warn('parser', `${name}: ${warning}`)
      const checksum = await sha256Hex(new TextEncoder().encode(text))
      addDataset(makeDataset(name, 'kml', result, sourceBytes, checksum))
    } catch (error) {
      logger.error('parser', `Failed to parse ${name}: ${(error as Error).message}`)
      flashToast(`Failed to parse ${name}: ${(error as Error).message}`)
    }
  }, [addDataset, flashToast])

  const addKmlMapOverlay = useCallback((name: string, text: string) => {
    try {
      const result = parseKml(text)
      const id = `kml-overlay:${name}`
      setMapOverlayTracks((current) => [...current.filter((track) => track.id !== id), { id, name, color: '#7c3aed', points: result.points }])
      setWorkspace((current) => ({
        ...current,
        mapOverlays: {
          overlays: [...current.mapOverlays.overlays.filter((overlay) => overlay.sourceKey !== name), { id, sourceKind: 'library', sourceKey: name, name, visible: true, opacity: 0.8, zIndex: current.mapOverlays.overlays.length, status: 'ready' }],
        },
      }))
      setProjectDirty(true)
      setTab('map')
    } catch (error) {
      logger.error('map', `Failed to load KML/KMZ overlay ${name}: ${(error as Error).message}`)
      flashToast(`Could not add overlay ${name}: ${(error as Error).message}`)
    }
  }, [flashToast])

  const ingestFile = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase().split('.').pop() ?? ''
    if ((ext === 'kml' || ext === 'kmz') && isDesktopKmlLibraryAvailable()) {
      try {
        await saveKmlLibraryFile(file)
        logger.success('import', `Saved ${file.name} to persistent KML/KMZ library`)
      } catch (error) {
        logger.warn('import', `Could not save ${file.name} to KML/KMZ library: ${(error as Error).message}`)
      }
    }
    if (ext === 'kmz') {
      if (!isDesktopKmlLibraryAvailable()) {
        flashToast('KMZ import requires the Electron desktop KML/KMZ library.')
        return
      }
      try {
        const result = await readKmlLibraryText(file.name)
        await importKmlText(file.name, result.text, file.size)
      } catch (error) {
        logger.error('import', `Failed to read ${file.name} from the KML/KMZ library: ${(error as Error).message}`)
        flashToast(`KMZ import failed: ${(error as Error).message}`)
      }
      return
    }
    const format = detectFormat(file.name)
    if (!format) { logger.error('import', `Unsupported file type: ${file.name}`); flashToast(`Unsupported file type: ${file.name}`); return }
    if (format.needsMapping) { analyzeCsv(file); return }
    setBusy(`Parsing ${file.name}`); setProgress(null)
    try { addDataset(await parseFileToDataset(file, format)) }
    catch (error) { logger.error('import', `Failed to parse ${file.name}: ${(error as Error).message}`); flashToast(`Failed to parse ${file.name}: ${(error as Error).message}`) }
    finally { setBusy(null) }
  }, [analyzeCsv, addDataset, flashToast, importKmlText])

  const onFiles = useCallback((files: FileList | null) => { if (files) for (const file of Array.from(files)) void ingestFile(file) }, [ingestFile])

  const applyTransform = useCallback((points: TrackPoint[], summary: string, preserveSelection: boolean, suppliedRecord?: OperationRecord) => {
    if (!active) return
    const next = withPoints(active, points)
    const selectedPointIndex = getSelectedPointIndex(active.points)
    const selectedRange = getSelectedRange(active.points)
    const record: OperationRecord = suppliedRecord ?? {
      id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      operationId: slugify(summary),
      operationVersion: 1,
      params: {},
      inputDatasetHash: fingerprintDataset(active),
      outputDatasetHash: fingerprintDataset(next),
      createdAt: Date.now(),
      summary,
      warnings: [],
    }
    setDatasets((current) => current.map((dataset) => dataset.id === active.id ? next : dataset))
    setHistories((current) => {
      const existing = current[active.id] ?? { past: [], future: [] }
      return { ...current, [active.id]: { past: appendHistorySnapshot(existing.past, active), future: [] } }
    })
    setOperationRecords((current) => ({ ...current, [active.id]: [...(current[active.id] ?? []), record] }))
    setProjectDirty(true)
    // Index-stable transforms keep linked selection attached to the replacement
    // array. Reductions and reordering declare that they cannot prove an index
    // mapping and clear selection deliberately.
    restorePointSelection(
      next.points,
      preserveSelection && next.points.length === active.points.length ? selectedPointIndex : null,
      preserveSelection && next.points.length === active.points.length ? selectedRange : null,
    )
    flashToast(summary)
  }, [active, flashToast])

  const undo = useCallback(() => {
    if (!active || !history || history.past.length === 0) return
    const previousDataset = history.past[history.past.length - 1]!
    setDatasets((current) => current.map((dataset) => dataset.id === active.id ? previousDataset : dataset))
    setHistories((current) => { const existing = current[active.id]!; return { ...current, [active.id]: { past: existing.past.slice(0, -1), future: [active, ...existing.future] } } })
    setProjectDirty(true)
    logger.info('transform', 'Undo')
  }, [active, history])

  const redo = useCallback(() => {
    if (!active || !history || history.future.length === 0) return
    const nextDataset = history.future[0]!
    setDatasets((current) => current.map((dataset) => dataset.id === active.id ? nextDataset : dataset))
    setHistories((current) => { const existing = current[active.id]!; return { ...current, [active.id]: { past: appendHistorySnapshot(existing.past, active), future: existing.future.slice(1) } } })
    setProjectDirty(true)
    logger.info('transform', 'Redo')
  }, [active, history])

  const removeDataset = useCallback((id: string) => {
    const remaining = datasets.filter((dataset) => dataset.id !== id)
    setDatasets(remaining)
    setHistories((current) => { const next = { ...current }; delete next[id]; return next })
    setOperationRecords((current) => { const next = { ...current }; delete next[id]; return next })
    setBookmarks((current) => current.filter((bookmark) => bookmark.datasetId !== id))
    // Reference/target dataset selectors in the comparison workspace state
    // can point at a removed dataset; reconcile them with the same
    // validation used on project restore rather than leaving a phantom ID
    // (which would silently break the comparison with no explanation).
    setWorkspace((current) => normalizeWorkspaceState(current, new Set(remaining.map((dataset) => dataset.id))))
    setProjectDirty(true)
    if (activeId === id) setActiveId(remaining[0]?.id ?? null)
  }, [activeId, datasets])

  const restoreProject = useCallback((archive: ProjectArchive) => {
    const restoredDatasets = archive.datasets
    const restoredActiveId = archive.manifest.view.activeDatasetId ?? restoredDatasets[0]?.id ?? null
    const requestedTab = archive.manifest.view.activeTab
    const restoredTab: Tab = isTab(requestedTab) ? requestedTab : restoredActiveId ? 'overview' : 'import'
    setDatasets(restoredDatasets)
    setHistories(archive.histories)
    setWorkspace(normalizeWorkspaceState(archive.manifest.view.workspace, new Set(restoredDatasets.map((dataset) => dataset.id))))
    setDatasetDisplay(restoreWorkspaceDisplay(archive.manifest.view.datasetDisplay, restoredDatasets))
    setBookmarks(archive.manifest.bookmarks)
    setOperationRecords(operationRecordsFromManifest(archive.manifest))
    setProjectName(archive.manifest.name)
    setProjectNotes(archive.manifest.notes ?? '')
    setActiveId(restoredActiveId)
    setPendingCsv(null)
    setTab(restoredTab)
    setProjectDirty(false)
    const activeDataset = restoredDatasets.find((dataset) => dataset.id === restoredActiveId)
    if (activeDataset) {
      const selection = archive.manifest.view.selection
      restorePointSelection(activeDataset.points, selection.pointIndex, selection.indexRange)
    }
    flashToast(`Restored project ${archive.manifest.name}`)
    logger.success('project', `Restored ${restoredDatasets.length} dataset(s) from ${archive.manifest.name}`)
  }, [flashToast])

  const tabs: Array<{ id: Tab; label: string; enabled: boolean }> = [
    { id: 'import', label: 'Import', enabled: true }, { id: 'mapping', label: 'CSV Mapping', enabled: !!pendingCsv },
    { id: 'overview', label: 'Overview', enabled: !!active }, { id: 'map', label: 'Map', enabled: !!active || isDesktopKmlLibraryAvailable() },
    { id: 'charts', label: 'Charts', enabled: !!active }, { id: 'table', label: 'Table', enabled: !!active },
    { id: 'compare', label: 'Compare', enabled: datasets.length >= 2 }, { id: 'scene3d', label: '3D', enabled: !!active },
    { id: 'transform', label: 'Transform', enabled: !!active }, { id: 'project', label: 'Project', enabled: datasets.length > 0 },
    { id: 'export', label: 'Export', enabled: !!active },
    { id: 'sources', label: 'Sources', enabled: datasets.length > 0 },
    { id: 'fusion', label: 'Fusion', enabled: datasets.length >= 2 },
  ]

  const otherTracks: OtherTrack[] = (active
    ? datasets
      .filter((dataset) => dataset.id !== active.id && (syncedDisplay[dataset.id]?.visible ?? true))
      .map((dataset) => ({ id: dataset.id, name: dataset.name, color: syncedDisplay[dataset.id]?.color ?? '#475569', points: dataset.points }))
    : []).concat(mapOverlayTracks.flatMap((track) => {
      const overlay = workspace.mapOverlays.overlays.find((candidate) => candidate.id === track.id)
      return overlay?.visible === false ? [] : [{ ...track, opacity: overlay?.opacity ?? 0.8 }]
    }))

  return (
    <div className="app">
      <header className="app-header"><div className="brand"><span className="brand-mark">JD</span><div><h1>Joint Domain Data Compiler</h1><p>TSPI flight-data conversion &amp; analysis workbench</p></div></div><div className="header-status">{busy ? <Spinner label={busy} /> : <span className="muted small">{datasets.length} dataset{datasets.length === 1 ? '' : 's'} loaded</span>}</div></header>
      <div className="app-body">
        <aside className="sidebar">
          <button type="button" className="primary-action" onClick={() => fileInputRef.current?.click()}>+ Load data</button>
          <input ref={fileInputRef} type="file" multiple className="hidden-input" accept=".csv,.tsv,.txt,.gpx,.geojson,.json,.kml,.kmz,.nmea,.gps,.log,.gpb,.bin" onChange={(event) => { onFiles(event.target.files); event.target.value = '' }} />
          <div className="dataset-list">{datasets.length === 0 && <p className="muted small pad">No datasets yet.</p>}{datasets.map((dataset) => <div key={dataset.id} className={`dataset-item${dataset.id === activeId ? ' active' : ''}`} onClick={() => { setActiveId(dataset.id); if (tab === 'import' || tab === 'mapping') setTab('overview') }}><div className="dataset-item-main"><span className="dataset-name">{dataset.name}</span><span className="dataset-sub mono">{dataset.sourceFormat} · {dataset.points.length.toLocaleString()} pts</span></div><button type="button" className="dataset-remove" onClick={(event) => { event.stopPropagation(); removeDataset(dataset.id) }} aria-label="Remove dataset">×</button></div>)}</div>
          <div className="sidebar-foot"><span className="muted small">Supported in:</span><div className="format-badges">{INPUT_FORMATS.map((format) => <span key={format.id} className="badge" title={format.description}>{format.label}</span>)}</div></div>
        </aside>
        <main className="workspace">
          <nav className="tab-bar">{tabs.map((item) => <button key={item.id} type="button" disabled={!item.enabled} className={`tab${tab === item.id ? ' active' : ''}`} onClick={() => selectTab(item.id)}>{item.label}</button>)}{active && <span className="tab-active-name mono">{active.name}</span>}</nav>
          <section className="tab-content">
            {progress !== null && <div className="global-progress"><ProgressBar value={progress} label={busy ?? 'Working'} />{building && <button type="button" onClick={cancelCsvBuild}>Cancel</button>}</div>}
            {tab === 'import' && <ImportView dragActive={dragActive} setDragActive={setDragActive} onFiles={onFiles} openPicker={() => fileInputRef.current?.click()} />}
            {tab === 'mapping' && pendingCsv && <MappingPanel analysis={pendingCsv.analysis} mapping={pendingCsv.mapping} onChange={(mapping) => setPendingCsv((current) => current ? { ...current, mapping } : current)} additionalHeaders={pendingCsv.additionalHeaders} onToggleAdditionalHeaders={(additionalHeaders) => setPendingCsv((current) => current ? { ...current, additionalHeaders } : current)} dataStartRow={pendingCsv.dataStartRow} onDataStartRowChange={(dataStartRow) => setPendingCsv((current) => current ? { ...current, dataStartRow } : current)} onBuild={buildCsvDataset} building={building} />}
            {tab === 'overview' && active && <StatsPanel dataset={active} bookmarks={bookmarks} onBookmarksChange={(next) => { setBookmarks(next); setProjectDirty(true) }} />}
            {tab === 'map' && <><KmlLibraryPanel onImportKmlText={importKmlText} onAddMapOverlay={addKmlMapOverlay} />
              {workspace.mapOverlays.overlays.length > 0 && <div className="analysis-panel"><h3>Map overlays</h3>{workspace.mapOverlays.overlays.map((overlay) => <div className="analysis-toolbar" key={overlay.id}><label className="header-compat-toggle"><input type="checkbox" checked={overlay.visible} disabled={overlay.status === 'missing'} onChange={(event) => { setWorkspace((current) => ({ ...current, mapOverlays: { overlays: current.mapOverlays.overlays.map((item) => item.id === overlay.id ? { ...item, visible: event.target.checked } : item) } })); setProjectDirty(true) }} />{overlay.name}{overlay.status === 'missing' && <span className="warn">source missing</span>}</label><label className="header-compat-toggle">Opacity <input type="range" min="0" max="1" step="0.05" value={overlay.opacity} onChange={(event) => { const opacity = Number(event.target.value); setWorkspace((current) => ({ ...current, mapOverlays: { overlays: current.mapOverlays.overlays.map((item) => item.id === overlay.id ? { ...item, opacity } : item) } })); setProjectDirty(true) }} /></label><button type="button" onClick={() => { setMapOverlayTracks((current) => current.filter((track) => track.id !== overlay.id)); setWorkspace((current) => ({ ...current, mapOverlays: { overlays: current.mapOverlays.overlays.filter((item) => item.id !== overlay.id) } })); setProjectDirty(true) }}>Remove overlay</button></div>)}</div>}
              <MapView points={active?.points ?? []} channels={active?.channels ?? []} workspace={workspace.map} onWorkspaceChange={(map) => { setWorkspace((current) => ({ ...current, map })); setProjectDirty(true) }} otherTracks={otherTracks} /></>}
            {tab === 'charts' && active && <TimeSeriesChart points={active.points} channels={active.channels} />}
            {tab === 'table' && active && <DataTable points={active.points} channels={active.channels} />}
            {tab === 'compare' && <ComparisonPanel datasets={datasets} activeId={activeId} workspace={workspace.comparison} onWorkspaceChange={(comparison) => { setWorkspace((current) => ({ ...current, comparison })); setProjectDirty(true) }} onSelectReferenceSample={(datasetId, pointIndex) => { const reference = datasets.find((dataset) => dataset.id === datasetId); if (!reference) return; restorePointSelection(reference.points, pointIndex, null); setActiveId(datasetId) }} />}
            {tab === 'scene3d' && active && <Trajectory3dPanel dataset={active} datasets={datasets} workspace={workspace.scene3d} onWorkspaceChange={(scene3d) => { setWorkspace((current) => ({ ...current, scene3d })); setProjectDirty(true) }} />}
            {tab === 'transform' && active && <><TransformPanel dataset={active} onApply={applyTransform} onUndo={undo} onRedo={redo} canUndo={!!history && history.past.length > 0} canRedo={!!history && history.future.length > 0} operationHistory={operationRecords[active.id] ?? []} /><NotionalSmoothingPanel dataset={active} onCreateDataset={addDataset} /></>}
            {tab === 'project' && <ProjectPanel datasets={datasets} histories={histories} activeId={activeId} activeTab={workspace.lastWorkspaceTab} workspace={workspace} datasetDisplay={syncedDisplay} bookmarks={bookmarks} operationRecords={operationRecords} projectName={projectName} projectNotes={projectNotes} projectDirty={projectDirty} onProjectNameChange={(name) => { setProjectName(name); setProjectDirty(true) }} onProjectNotesChange={(notes) => { setProjectNotes(notes); setProjectDirty(true) }} onProjectSaved={() => setProjectDirty(false)} onRestoreProject={restoreProject} />}

            {tab === 'export' && active && <ExportPanel dataset={active} />}
            {tab === 'sources' && <SourcesPanel datasets={datasets} activeId={activeId} display={syncedDisplay} onDisplayChange={(next) => { setDatasetDisplay(next); setProjectDirty(true) }} onSelectActive={setActiveId} />}
            {tab === 'fusion' && <FusionPanel datasets={datasets} onCreateDataset={(dataset) => { addDataset(dataset); setTab('fusion') }} />}
          </section>
        </main>
      </div>
      <section className="log-dock"><LogConsole /></section>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function isTab(value: unknown): value is Tab {
  return typeof value === 'string' && ['import', 'mapping', 'overview', 'map', 'charts', 'table', 'compare', 'scene3d', 'transform', 'project', 'export'].includes(value)
}

function isWorkspaceTab(tab: Tab): tab is Exclude<Tab, 'import' | 'mapping' | 'project' | 'export' | 'sources' | 'fusion'> {
  return ['overview', 'map', 'charts', 'table', 'compare', 'scene3d', 'transform'].includes(tab)
}
