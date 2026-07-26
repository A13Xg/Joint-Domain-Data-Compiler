import { useRef, useState } from 'react'
import type { Dataset } from '../core/model'
import { fingerprintDataset } from '../core/recipes/hash'
import { EMPTY_WORKSPACE_SELECTION } from '../core/selection'
import { parseProjectManifest, serializeProjectManifest, type ProjectManifest } from '../persistence/project/manifest'

export function ProjectPanel({ datasets, activeId, activeTab, onActivateDataset }: { datasets: Dataset[]; activeId: string | null; activeTab: string; onActivateDataset: (id: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [loadedManifest, setLoadedManifest] = useState<ProjectManifest | null>(null)
  const [error, setError] = useState<string | null>(null)

  const exportManifest = () => {
    const now = Date.now()
    const manifest: ProjectManifest = {
      schema: 'jddc-project', schemaVersion: 1, projectId: `project_${now}`,
      name: datasets.length === 1 ? datasets[0]!.name : `JDDC workspace (${datasets.length} datasets)`,
      createdAt: now, updatedAt: now, applicationVersion: '0.1.0',
      datasets: datasets.map((dataset) => ({
        id: dataset.id, name: dataset.name, sourceFormat: dataset.sourceFormat,
        sourceHash: fingerprintDataset(dataset), sourceFileName: dataset.metadata?.source.filename ?? dataset.name,
        recipeIds: [], visible: true,
      })),
      recipes: [], bookmarks: [],
      view: { activeDatasetId: activeId, activeTab, selection: { ...EMPTY_WORKSPACE_SELECTION, datasetId: activeId }, chartLayoutIds: [] },
    }
    const blob = new Blob([serializeProjectManifest(manifest)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${safeName(manifest.name)}.jddc-project.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const importManifest = async (file: File) => {
    try {
      const manifest = parseProjectManifest(await file.text())
      setLoadedManifest(manifest)
      setError(null)
      const manifestActive = manifest.view.activeDatasetId
      if (manifestActive && datasets.some((dataset) => dataset.id === manifestActive)) onActivateDataset(manifestActive)
    } catch (cause) {
      setLoadedManifest(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="analysis-panel">
      <div className="analysis-toolbar">
        <button type="button" className="export-btn" disabled={datasets.length === 0} onClick={exportManifest}>Export project manifest</button>
        <button type="button" onClick={() => inputRef.current?.click()}>Validate project manifest</button>
        <input ref={inputRef} className="hidden-input" type="file" accept=".json,.jddc-project" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importManifest(file); event.target.value = '' }} />
      </div>
      <p className="muted small">The current project implementation persists a validated manifest, dataset fingerprints, workspace state, and source references. Dataset payload embedding, recipe capture, and ZIP archive rehydration remain later roadmap increments.</p>
      <div className="metric-grid">
        <Metric label="loaded datasets" value={datasets.length.toLocaleString()} />
        <Metric label="active dataset" value={datasets.find((dataset) => dataset.id === activeId)?.name ?? 'none'} />
        <Metric label="active tab" value={activeTab} />
        <Metric label="manifest schema" value="jddc-project v1" />
      </div>
      {error && <div className="error-line">{error}</div>}
      {loadedManifest && <div className="analysis-summary"><strong>Validated manifest:</strong> {loadedManifest.name}<br />{loadedManifest.datasets.length} dataset reference(s), {loadedManifest.recipes.length} recipe(s), {loadedManifest.bookmarks.length} bookmark(s). Application version: {loadedManifest.applicationVersion}.</div>}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="metric-card"><span className="metric-label">{label}</span><strong className="mono">{value}</strong></div> }
function safeName(value: string): string { return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'jddc-project' }
