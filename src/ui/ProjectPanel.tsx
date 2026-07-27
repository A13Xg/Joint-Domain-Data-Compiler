import { useMemo, useRef, useState } from 'react'
import type { Dataset } from '../core/model'
import { EMPTY_WORKSPACE_SELECTION } from '../core/selection'
import { usePointSelection } from '../state/pointSelection'
import type { WorkspaceState } from '../state/workspace'
import type { ProjectBookmark } from '../persistence/project/manifest'
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
  bookmarks: ProjectBookmark[]
  onRestoreProject: (archive: ProjectArchive) => void
}

export function ProjectPanel({ datasets, histories, activeId, activeTab, workspace, bookmarks, onRestoreProject }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [projectName, setProjectName] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
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
    bookmarks,
    projectName: projectName.trim() || undefined,
    applicationVersion: '0.1.0',
  }), [datasets, activeId, activeTab, activeSelection.pointIndex, activeSelection.indexRange, projectName, workspace, bookmarks])

  const archive = useMemo(() => createProjectArchive({ manifest, datasets, histories }), [manifest, datasets, histories])
  const summary = useMemo(() => archiveSummary(archive), [archive])

  const saveProject = async () => {
    setBusy(true)
    setError(null)
    try {
      const blob = await encodeProjectArchive(archive)
      downloadBlob(blob, `${safeName(manifest.name)}.jddc-project`)
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

  const openProject = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const loaded = await decodeProjectArchive(file)
      onRestoreProject(loaded)
      const loadedSummary = archiveSummary(loaded)
      setProjectName(loaded.manifest.name)
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
        <label className="num-field"><span>project name</span><input type="text" value={projectName} placeholder={manifest.name} onChange={(event) => setProjectName(event.target.value)} /></label>
        <button type="button" className="export-btn" disabled={datasets.length === 0 || busy} onClick={() => void saveProject()}>{busy ? 'Working…' : 'Save complete project'}</button>
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>Open project</button>
        <button type="button" disabled={datasets.length === 0 || busy} onClick={exportManifest}>Export manifest only</button>
        <input ref={inputRef} className="hidden-input" type="file" accept=".jddc-project,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void openProject(file); event.target.value = '' }} />
      </div>
      <p className="muted small">A <code>.jddc-project</code> file is a self-contained, gzip-compressed workspace archive. It embeds current datasets, semantic metadata, undo/redo snapshots, the active dataset and tab, and point/range selection. The manifest remains versioned and fingerprint-verified during restore.</p>
      <div className="metric-grid">
        <Metric label="loaded datasets" value={summary.datasets.toLocaleString()} />
        <Metric label="current points" value={summary.currentPoints.toLocaleString()} />
        <Metric label="history snapshots" value={summary.historySnapshots.toLocaleString()} />
        <Metric label="history points" value={summary.historyPoints.toLocaleString()} />
        <Metric label="active dataset" value={datasets.find((dataset) => dataset.id === activeId)?.name ?? 'none'} />
        <Metric label="active tab" value={activeTab} />
      </div>
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
