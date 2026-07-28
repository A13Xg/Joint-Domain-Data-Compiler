import { useMemo, useRef, useState } from 'react'
import type { Dataset } from '../core/model'
import { EMPTY_WORKSPACE_SELECTION } from '../core/selection'
import { usePointSelection } from '../state/pointSelection'
import type { WorkspaceState } from '../state/workspace'
import type { WorkspaceDisplay } from '../state/workspaceDisplay'
import type { ProjectBookmark } from '../persistence/project/manifest'
import { buildDiagnosticBundle, serializeDiagnosticBundle } from '../core/diagnostics/bundle'
import { logger } from '../core/logger'
import { buildHtmlAnalysisReport } from '../core/reports/htmlReport'
import type { OperationRecord } from '../core/recipes/model'
import {
  archiveSummary,
  buildProjectManifest,
  createProjectArchive,
  decodeProjectArchive,
  encodeProjectArchive,
  serializeProjectManifest,
  type ProjectArchive,
  type ProjectDatasetHistory,
} from '../persistence/project/archive'

interface Props {
  datasets: Dataset[]
  histories: Record<string, ProjectDatasetHistory>
  activeId: string | null
  activeTab: string
  workspace: WorkspaceState
  datasetDisplay: WorkspaceDisplay
  bookmarks: ProjectBookmark[]
  operationRecords: Record<string, OperationRecord[]>
  projectName: string
  projectNotes: string
  projectDirty: boolean
  onProjectNameChange: (name: string) => void
  onProjectNotesChange: (notes: string) => void
  onProjectSaved: () => void
  onRestoreProject: (archive: ProjectArchive) => void
}

export function ProjectPanel({ datasets, histories, activeId, activeTab, workspace, datasetDisplay, bookmarks, operationRecords, projectName, projectNotes, projectDirty, onProjectNameChange, onProjectNotesChange, onProjectSaved, onRestoreProject }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [diagnosticNote, setDiagnosticNote] = useState('')
  const [reportTitle, setReportTitle] = useState('')
  const [reportFilename, setReportFilename] = useState('')
  const [reportOptions, setReportOptions] = useState({ includeQualityEvents: true, includeWarnings: true, includeOperations: true, includeBookmarks: true })
  const activeDataset = datasets.find((dataset) => dataset.id === activeId) ?? null
  const activeSelection = usePointSelection(activeDataset?.points ?? EMPTY_POINTS)

  const manifest = useMemo(() => buildProjectManifest({
    datasets,
    activeDatasetId: activeId,
    activeTab,
    selection: activeId ? {
      ...EMPTY_WORKSPACE_SELECTION,
      datasetId: activeId,
      pointIndex: activeSelection.pointIndex,
      indexRange: activeSelection.indexRange,
    } : EMPTY_WORKSPACE_SELECTION,
    workspace,
    datasetDisplay,
    bookmarks,
    operationRecords,
    projectName: projectName.trim() || undefined,
    notes: projectNotes,
    applicationVersion: '0.1.0',
  }), [datasets, activeId, activeTab, activeSelection.pointIndex, activeSelection.indexRange, projectName, projectNotes, workspace, datasetDisplay, bookmarks, operationRecords])

  const archive = useMemo(() => createProjectArchive({ manifest, datasets, histories }), [manifest, datasets, histories])
  const summary = useMemo(() => archiveSummary(archive), [archive])

  const saveProject = async () => {
    setBusy(true)
    setError(null)
    try {
      const blob = await encodeProjectArchive(archive)
      downloadBlob(blob, `${safeName(manifest.name)}.jddc-project`)
      onProjectSaved()
      setStatus(`Saved ${summary.datasets} dataset(s), ${summary.currentPoints.toLocaleString()} current points, and ${summary.historySnapshots.toLocaleString()} history snapshot(s).`)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const exportManifest = () => {
    downloadBlob(new Blob([serializeProjectManifest(manifest)], { type: 'application/json' }), `${safeName(manifest.name)}.manifest.json`)
    setStatus('Exported the human-readable project manifest without embedded data.')
  }

  const exportReport = () => {
    const title = reportTitle.trim() || `${manifest.name} — Analysis Report`
    const filename = safeName(reportFilename.trim() || `${manifest.name}-report`)
    const html = buildHtmlAnalysisReport({
      title,
      generatedAt: Date.now(),
      applicationVersion: '0.1.0',
      datasets,
      bookmarks,
      operationRecords,
      options: reportOptions,
    })
    downloadBlob(new Blob([html], { type: 'text/html' }), `${filename}.html`)
    setStatus('Exported a self-contained HTML analysis report. Open it in a browser to print or save as PDF.')
  }

  const exportDiagnostics = async () => {
    setBusy(true)
    setError(null)
    try {
      const desktop = window.jointDomainCompiler
      const text = serializeDiagnosticBundle(buildDiagnosticBundle({
        appVersion: '0.1.0',
        platform: desktop ? `electron-${desktop.platform}` : 'web',
        packaged: Boolean(desktop && window.location.protocol === 'file:'),
        datasets: datasets.map((dataset) => ({
          id: dataset.id,
          name: dataset.name,
          sourceFormat: dataset.sourceFormat,
          pointCount: dataset.points.length,
          warningCount: dataset.warnings.length,
        })),
        workspace,
        logEntries: logger.getEntries(),
        generatedAt: Date.now(),
        userNote: diagnosticNote.trim() || undefined,
      }))
      if (desktop?.diagnostics) {
        const savedPath = await desktop.diagnostics.save(text)
        setStatus(savedPath ? 'Saved the diagnostic bundle.' : 'Diagnostic bundle save canceled.')
      } else {
        downloadBlob(new Blob([text], { type: 'application/json' }), `jddc-diagnostics-${new Date().toISOString().slice(0, 10)}.json`)
        setStatus('Downloaded the diagnostic bundle.')
      }
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const openProject = async (file: File) => {
    if (projectDirty && !window.confirm('Open this project and discard unsaved workspace changes?')) return
    setBusy(true)
    setError(null)
    try {
      const loaded = await decodeProjectArchive(file)
      onRestoreProject(loaded)
      const loadedSummary = archiveSummary(loaded)
      setStatus(`Restored ${loadedSummary.datasets} dataset(s), ${loadedSummary.currentPoints.toLocaleString()} current points, and ${loadedSummary.historySnapshots.toLocaleString()} history snapshot(s).`)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="analysis-panel">
      <div className="analysis-toolbar">
        {projectDirty && <span className="badge">Unsaved changes</span>}
        <label className="num-field"><span>project name</span><input type="text" value={projectName} placeholder={manifest.name} onChange={(event) => onProjectNameChange(event.target.value)} /></label>
        <button type="button" className="export-btn" disabled={datasets.length === 0 || busy} onClick={() => void saveProject()}>{busy ? 'Working…' : 'Save complete project'}</button>
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>Open project</button>
        <button type="button" disabled={datasets.length === 0 || busy} onClick={exportManifest}>Export manifest only</button>
        <button type="button" disabled={datasets.length === 0 || busy} onClick={exportReport}>Export HTML report</button>
        <input ref={inputRef} className="hidden-input" type="file" accept=".jddc-project,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void openProject(file); event.target.value = '' }} />
      </div>
      <p className="muted small">A <code>.jddc-project</code> file is a self-contained, gzip-compressed workspace archive. It embeds current datasets, semantic metadata, undo/redo snapshots, the active dataset and tab, and point/range selection. The manifest remains versioned and fingerprint-verified during restore.</p>
      <label className="field"><span>Project notes</span><textarea rows={3} value={projectNotes} placeholder="Purpose, assumptions, provenance, or handoff notes." onChange={(event) => onProjectNotesChange(event.target.value)} /></label>
      <details className="analysis-summary">
        <summary>HTML report options</summary>
        <div className="field-grid">
          <label className="field"><span>Visible report title</span><input value={reportTitle} placeholder={`${manifest.name} — Analysis Report`} onChange={(event) => setReportTitle(event.target.value)} /></label>
          <label className="field"><span>Download filename</span><input value={reportFilename} placeholder={`${safeName(manifest.name)}-report`} onChange={(event) => setReportFilename(event.target.value)} /></label>
        </div>
        <p className="muted small">Filename characters are sanitized independently from the visible title. Disabled evidence categories are omitted from the generated report.</p>
        {(['includeQualityEvents', 'includeWarnings', 'includeOperations', 'includeBookmarks'] as const).map((key) => <label className="header-compat-toggle" key={key}><input type="checkbox" checked={reportOptions[key]} onChange={(event) => setReportOptions((current) => ({ ...current, [key]: event.target.checked }))} />{key.replace('include', 'Include ')}</label>)}
      </details>
      <div className="metric-grid">
        <Metric label="loaded datasets" value={summary.datasets.toLocaleString()} />
        <Metric label="current points" value={summary.currentPoints.toLocaleString()} />
        <Metric label="history snapshots" value={summary.historySnapshots.toLocaleString()} />
        <Metric label="history points" value={summary.historyPoints.toLocaleString()} />
        <Metric label="active dataset" value={datasets.find((dataset) => dataset.id === activeId)?.name ?? 'none'} />
        <Metric label="active tab" value={activeTab} />
      </div>
      <h3>Diagnostics</h3>
      <p className="muted small">Export app/workspace configuration, dataset summaries, and the most recent application logs for a bug report. Raw trajectory points and KML/KMZ library files are excluded. Review the JSON and your optional note before sharing it.</p>
      <label className="field">
        <span>Optional note</span>
        <textarea rows={3} value={diagnosticNote} placeholder="Describe what happened and how to reproduce it." onChange={(event) => setDiagnosticNote(event.target.value)} />
      </label>
      <button type="button" disabled={busy} onClick={() => void exportDiagnostics()}>Export diagnostic bundle</button>
      {error && <div className="error-line">{error}</div>}
      {status && <div className="analysis-summary">{status}</div>}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-card"><span className="metric-label">{label}</span><strong className="mono">{value}</strong></div>
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'jddc-project'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

const EMPTY_POINTS: Dataset['points'] = []
