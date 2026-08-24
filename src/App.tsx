import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CsvAnalysisResult, DetectedColumn } from './types/converter'
import type { Dataset, TrackPoint } from './core/model'
import { withPoints } from './core/transforms'
import { detectFormat, makeDataset, parseFileToDataset, INPUT_FORMATS, resolveTextFormat } from './core/parsers'
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
import { TrackHealthPanel } from './ui/TrackHealthPanel'
import { getSelectedPointIndex, getSelectedRange, restorePointSelection } from './state/pointSelection'
import type { ProjectArchive, ProjectDatasetHistory } from './persistence/project/archive'
import { namedRecipesFromManifest, type ProjectBookmark } from './persistence/project/manifest'
import type { FusionArtifact } from './core/fusion/artifact'
import { operationRecordsFromManifest } from './persistence/project/manifest'
import { parseKml } from './core/parsers/kml'
import { isDesktopKmlLibraryAvailable, readKmlLibraryText, saveKmlLibraryFile } from './desktop/kmlLibrary'
import { archiveFile } from './desktop/fileArchive'
import { insertDataset } from './core/ids'
import { DEFAULT_WORKSPACE_STATE, normalizeWorkspaceState, type WorkspaceState } from './state/workspace'
import type { MapOverlayState } from './state/mapOverlays'
import type { KmlLibraryEntry } from './types/desktop'
import { ensureBuiltinDerivationsRegistered } from './core/analytics/bootstrap'
import { fingerprintDataset } from './core/recipes/hash'
import type { OperationRecord, Recipe } from './core/recipes/model'
import { ensureBuiltinOperationsRegistered } from './core/operations/basic'
import { appendHistorySnapshot } from './state/history'
import { errorMessage } from './core/errors'

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
  const [namedRecipes, setNamedRecipes] = useState<Record<string, Recipe[]>>({})
  const [datasetDisplay, setDatasetDisplay] = useState<WorkspaceDisplay>({})
  const [bookmarks, setBookmarks] = useState<ProjectBookmark[]>([])
  const [fusionArtifacts, setFusionArtifacts] = useState<FusionArtifact[]>([])
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
  const [browserOverlayFiles, setBrowserOverlayFiles] = useState<Record<string, { entry: KmlLibraryEntry; text: string }>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [pendingCsv, setPendingCsv] = useState<PendingCsv | null>(null)
  const [building, setBuilding] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // A drill-down from the health panel: the target view consumes this and clears it, so
  // re-entering that tab later never replays an old jump.
  const [pendingJump, setPendingJump] = useState<'map' | 'charts' | null>(null)
  const cancelCsvRef = useRef(false)
  const csvWorkerRef = useRef<Worker | null>(null)
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

  const handleHealthDrillDown = useCallback((target: { preferredTab: 'map' | 'charts' }) => {
    setTab(target.preferredTab)
    setPendingJump(target.preferredTab)
  }, [])
  const clearPendingJump = useCallback(() => setPendingJump(null), [])

  useEffect(() => {
    if (!projectDirty) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = true
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [projectDirty])

  // Signature of only the source-identity fields (id/sourceKind/sourceKey/status)
  // of the fetchable overlay set. Opacity/visibility/zIndex changes (fired on
  // every slider/checkbox interaction in MapOverlayPanel) must not appear in
  // this signature — they're applied purely downstream in otherTracks/MapView
  // and re-fetching+re-parsing the source file for them would freeze the
  // renderer on a large overlay.
  const overlaySignature = useMemo(() => workspace.mapOverlays.overlays
    .filter((overlay) => (overlay.sourceKind === 'library' || overlay.sourceKind === 'bundled') && overlay.status !== 'missing')
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((overlay) => `${overlay.id}|${overlay.sourceKind}|${overlay.sourceKey}|${overlay.status ?? 'ready'}`)
    .join(','), [workspace.mapOverlays])

  useEffect(() => {
    let cancelled = false
    const overlayRefs = workspace.mapOverlays.overlays
      .filter((overlay) => (overlay.sourceKind === 'library' || overlay.sourceKind === 'bundled') && overlay.status !== 'missing')
      .sort((a, b) => a.zIndex - b.zIndex)
    void Promise.all(overlayRefs.map(async (overlay): Promise<OtherTrack | null> => {
      try {
        const text = isDesktopKmlLibraryAvailable()
          ? (await readKmlLibraryText(overlay.sourceKey)).text
          : browserOverlayFiles[overlay.sourceKey]?.text
        if (!text) return null
        return { id: overlay.id, name: overlay.name, color: '#7c3aed', opacity: overlay.opacity, points: parseKml(text).points }
      } catch (error) {
        // Distinguishable causes (unreadable file vs. malformed KML) both mark
        // the overlay unavailable, so the reason has to be logged or it is lost.
        logger.warn('map', `Overlay ${overlay.name} could not be loaded: ${errorMessage(error)}`, { sourceKey: overlay.sourceKey })
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
    }).catch((error: unknown) => {
      if (cancelled) return
      logger.error('map', `Map overlay refresh failed: ${errorMessage(error)}`)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on overlaySignature (source identity only) by design; see comment above
  }, [overlaySignature, browserOverlayFiles])

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

  useEffect(() => () => {
    csvWorkerRef.current?.terminate()
    csvWorkerRef.current = null
  }, [])

  const analyzeCsv = useCallback((file: File) => {
    try {
      assertByteBudget('csv', file.size)
    } catch (error) {
      logger.error('import', `CSV rejected: ${errorMessage(error)}`)
      flashToast(errorMessage(error))
      return
    }
    setBusy(`Analyzing ${file.name}`)
    setProgress(0)
    logger.info('import', `Analyzing CSV ${file.name} (${formatBytes(file.size)})`)
    const worker = new Worker(new URL('./workers/csvAnalyzer.worker.ts', import.meta.url), { type: 'module' })
    csvWorkerRef.current?.terminate()
    csvWorkerRef.current = worker

    // Every exit from the analysis has to clear the busy state. A path that
    // misses it leaves the shell spinning on a job that will never report back.
    const finish = () => {
      setBusy(null); setProgress(null)
      worker.terminate()
      if (csvWorkerRef.current === worker) csvWorkerRef.current = null
    }
    const fail = (reason: string) => {
      logger.error('import', `CSV analysis failed: ${reason}`)
      flashToast(`CSV analysis failed: ${reason}`)
      finish()
    }

    worker.onmessage = (event: MessageEvent) => {
      // The frame crosses a structured-clone boundary; reading .payload off a
      // malformed one would throw here and strand the busy state forever.
      const message = event.data as { type?: unknown; payload?: unknown } | null
      if (!message || typeof message !== 'object') return
      if (message.type === 'progress') {
        const progress = (message.payload as { progress?: unknown } | undefined)?.progress
        if (typeof progress === 'number' && Number.isFinite(progress)) setProgress(progress)
      } else if (message.type === 'error') {
        fail(errorMessage((message.payload as { message?: unknown } | undefined)?.message))
      } else if (message.type === 'complete') {
        const analysis = message.payload as CsvAnalysisResult | undefined
        if (!analysis || !Array.isArray(analysis.columns)) {
          fail('the analyzer returned an unrecognized result.')
          return
        }
        logger.success('import', `Analyzed ${file.name}: ${analysis.columns.length} columns`)
        setPendingCsv({ file, analysis, mapping: defaultMapping(analysis), additionalHeaders: false, dataStartRow: analysis.dataStartRow })
        finish(); setTab('mapping')
      }
    }
    worker.onerror = (event) => fail(event.message || 'the CSV analyzer worker failed to start.')
    // Without this a clone failure on the posted File silently drops the job.
    worker.onmessageerror = () => fail('the CSV analyzer could not read the posted file.')
    try {
      worker.postMessage({ type: 'analyze', payload: { file, sampleLimit: CSV_SAMPLE_LIMIT } })
    } catch (error) {
      fail(errorMessage(error))
    }
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
        logger.error('import', `CSV build failed: ${errorMessage(error)}`)
        flashToast(`CSV build failed: ${errorMessage(error)}`)
      }
    } finally { setBuilding(false); setBusy(null); setProgress(null) }
  }, [pendingCsv, addDataset, flashToast])

  const cancelCsvBuild = useCallback(() => { cancelCsvRef.current = true }, [])

  const reportUnhandled = useCallback((context: string) => (error: unknown) => {
    logger.error('ui', `${context}: ${errorMessage(error)}`)
    flashToast(`${context}: ${errorMessage(error)}`)
    setBusy(null); setProgress(null)
  }, [flashToast])

  const onBuildCsv = useCallback(() => {
    buildCsvDataset().catch(reportUnhandled('CSV build failed'))
  }, [buildCsvDataset, reportUnhandled])


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
      logger.error('parser', `Failed to parse ${name}: ${errorMessage(error)}`)
      flashToast(`Failed to parse ${name}: ${errorMessage(error)}`)
    }
  }, [addDataset, flashToast])
  const onImportOverlayAsTrack = useCallback((name: string, text: string, sourceBytes?: number) => {
    importKmlText(name, text, sourceBytes).catch(reportUnhandled(`Import of ${name} failed`))
  }, [importKmlText, reportUnhandled])

  const onMapOverlayStateChange = useCallback((next: MapOverlayState) => {
    setWorkspace((current) => ({ ...current, mapOverlays: next }))
    setProjectDirty(true)
  }, [])

  const onBrowserOverlayFile = useCallback((entry: KmlLibraryEntry, text: string | null) => {
    setBrowserOverlayFiles((current) => {
      if (text === null) {
        const next = { ...current }
        delete next[entry.name]
        return next
      }
      return { ...current, [entry.name]: { entry, text } }
    })
  }, [])

  const ingestFile = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase().split('.').pop() ?? ''
    if ((ext === 'kml' || ext === 'kmz') && isDesktopKmlLibraryAvailable()) {
      try {
        await saveKmlLibraryFile(file)
        logger.success('import', `Saved ${file.name} to persistent KML/KMZ library`)
      } catch (error) {
        logger.warn('import', `Could not save ${file.name} to KML/KMZ library: ${errorMessage(error)}`)
      }
    } else {
      // KML/KMZ already gets a durable copy via the persistent library above;
      // every other imported format is archived here instead.
      void archiveFile('inputs', file.name, file)
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
        logger.error('import', `Failed to read ${file.name} from the KML/KMZ library: ${errorMessage(error)}`)
        flashToast(`KMZ import failed: ${errorMessage(error)}`)
      }
      return
    }
    let format = detectFormat(file.name)
    if (!format) { logger.error('import', `Unsupported file type: ${file.name}`); flashToast(`Unsupported file type: ${file.name}`); return }

    // Disambiguate .txt files: might be EAG or CSV
    if (ext === 'txt' && format.id === 'csv') {
      try {
        const text = await file.text()
        const resolvedFormat = resolveTextFormat(text)
        format = INPUT_FORMATS.find((f) => f.id === resolvedFormat) ?? format
      } catch (error) {
        logger.warn('import', `Could not read ${file.name} for format detection: ${errorMessage(error)}`)
      }
    }

    if (format.needsMapping) { analyzeCsv(file); return }
    setBusy(`Parsing ${file.name}`); setProgress(null)
    try { addDataset(await parseFileToDataset(file, format)) }
    catch (error) { logger.error('import', `Failed to parse ${file.name}: ${errorMessage(error)}`); flashToast(`Failed to parse ${file.name}: ${errorMessage(error)}`) }
    finally { setBusy(null) }
  }, [analyzeCsv, addDataset, flashToast, importKmlText])

  const onFiles = useCallback((files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      // ingestFile handles its own parse errors; this catch exists so an
      // unexpected throw cannot leave `busy` set with nothing on screen.
      ingestFile(file).catch((error: unknown) => {
        logger.error('import', `Import of ${file.name} failed: ${errorMessage(error)}`)
        flashToast(`Import of ${file.name} failed: ${errorMessage(error)}`)
        setBusy(null); setProgress(null)
      })
    }
  }, [ingestFile, flashToast])

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

  const applyReplay = useCallback((replayed: Dataset, summary: string) => {
    if (!active) return
    const selectedPointIndex = getSelectedPointIndex(active.points)
    const selectedRange = getSelectedRange(active.points)
    setDatasets((current) => current.map((dataset) => dataset.id === active.id ? replayed : dataset))
    setHistories((current) => {
      const existing = current[active.id] ?? { past: [], future: [] }
      return { ...current, [active.id]: { past: appendHistorySnapshot(existing.past, active), future: [] } }
    })
    setProjectDirty(true)
    restorePointSelection(
      replayed.points,
      replayed.points.length === active.points.length ? selectedPointIndex : null,
      replayed.points.length === active.points.length ? selectedRange : null,
    )
    flashToast(summary)
    logger.success('transform', summary)
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
    setNamedRecipes((current) => { const next = { ...current }; delete next[id]; return next })
    setBookmarks((current) => current.filter((bookmark) => bookmark.datasetId !== id))
    setFusionArtifacts((current) => current.filter((artifact) => artifact.fusedDatasetId !== id && !artifact.sourceRegistrations.some((source) => source.datasetId === id)))
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
    setFusionArtifacts(archive.manifest.fusionArtifacts)
    setOperationRecords(operationRecordsFromManifest(archive.manifest))
    setNamedRecipes(namedRecipesFromManifest(archive.manifest))
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
            {tab === 'mapping' && pendingCsv && <MappingPanel analysis={pendingCsv.analysis} mapping={pendingCsv.mapping} onChange={(mapping) => setPendingCsv((current) => current ? { ...current, mapping } : current)} additionalHeaders={pendingCsv.additionalHeaders} onToggleAdditionalHeaders={(additionalHeaders) => setPendingCsv((current) => current ? { ...current, additionalHeaders } : current)} dataStartRow={pendingCsv.dataStartRow} onDataStartRowChange={(dataStartRow) => setPendingCsv((current) => current ? { ...current, dataStartRow } : current)} onBuild={onBuildCsv} building={building} />}
            {tab === 'overview' && active && <div className="overview-panels"><TrackHealthPanel dataset={active} onDrillDown={handleHealthDrillDown} /><StatsPanel dataset={active} bookmarks={bookmarks} onBookmarksChange={(next) => { setBookmarks(next); setProjectDirty(true) }} /></div>}
            {tab === 'map' && <MapView points={active?.points ?? []} channels={active?.channels ?? []} workspace={workspace.map} onWorkspaceChange={(map) => { setWorkspace((current) => ({ ...current, map })); setProjectDirty(true) }} otherTracks={otherTracks} overlayState={workspace.mapOverlays} onOverlayStateChange={onMapOverlayStateChange} onImportOverlayAsTrack={onImportOverlayAsTrack} browserOverlayFiles={browserOverlayFiles} onBrowserOverlayFile={onBrowserOverlayFile} jumpRequested={pendingJump === 'map'} onJumpHandled={clearPendingJump} />}
            {tab === 'charts' && active && <TimeSeriesChart points={active.points} channels={active.channels} jumpRequested={pendingJump === 'charts'} onJumpHandled={clearPendingJump} />}
            {tab === 'table' && active && <DataTable points={active.points} channels={active.channels} />}
            {tab === 'compare' && <ComparisonPanel datasets={datasets} activeId={activeId} workspace={workspace.comparison} onWorkspaceChange={(comparison) => { setWorkspace((current) => ({ ...current, comparison })); setProjectDirty(true) }} onSelectReferenceSample={(datasetId, pointIndex) => { const reference = datasets.find((dataset) => dataset.id === datasetId); if (!reference) return; restorePointSelection(reference.points, pointIndex, null); setActiveId(datasetId) }} />}
            {tab === 'scene3d' && active && <Trajectory3dPanel dataset={active} datasets={datasets} workspace={workspace.scene3d} onWorkspaceChange={(scene3d) => { setWorkspace((current) => ({ ...current, scene3d })); setProjectDirty(true) }} />}
            {tab === 'transform' && active && <div className="transform-workspace"><TransformPanel dataset={active} onApply={applyTransform} onUndo={undo} onRedo={redo} canUndo={!!history && history.past.length > 0} canRedo={!!history && history.future.length > 0} operationHistory={operationRecords[active.id] ?? []} replaySource={history?.past[0]} namedRecipes={namedRecipes[active.id] ?? []} onSaveRecipe={(recipe) => { setNamedRecipes((current) => ({ ...current, [active.id]: [...(current[active.id] ?? []), recipe] })); setProjectDirty(true) }} onDeleteRecipe={(recipeId) => { setNamedRecipes((current) => ({ ...current, [active.id]: (current[active.id] ?? []).filter((recipe) => recipe.id !== recipeId) })); setProjectDirty(true) }} onReplay={applyReplay} /><NotionalSmoothingPanel dataset={active} onCreateDataset={addDataset} /></div>}
            {tab === 'project' && <ProjectPanel datasets={datasets} histories={histories} activeId={activeId} activeTab={workspace.lastWorkspaceTab} workspace={workspace} datasetDisplay={syncedDisplay} bookmarks={bookmarks} operationRecords={operationRecords} namedRecipes={namedRecipes} fusionArtifacts={fusionArtifacts} projectName={projectName} projectNotes={projectNotes} projectDirty={projectDirty} onWorkspaceChange={(next) => { setWorkspace(next); setProjectDirty(true) }} onProjectNameChange={(name) => { setProjectName(name); setProjectDirty(true) }} onProjectNotesChange={(notes) => { setProjectNotes(notes); setProjectDirty(true) }} onProjectSaved={() => setProjectDirty(false)} onRestoreProject={restoreProject} />}

            {tab === 'export' && active && <ExportPanel dataset={active} />}
            {tab === 'sources' && <SourcesPanel datasets={datasets} activeId={activeId} display={syncedDisplay} onDisplayChange={(next) => { setDatasetDisplay(next); setProjectDirty(true) }} onSelectActive={setActiveId} />}
            {tab === 'fusion' && <FusionPanel datasets={datasets} fusionArtifacts={fusionArtifacts} onCreateDataset={(dataset, artifact) => { addDataset(dataset); setFusionArtifacts((current) => [...current, artifact]); setProjectDirty(true); setTab('fusion') }} />}
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
