// Tranche 6 Task 6.3 (UI). Lets a user pick two or more loaded datasets as
// fusion sources, assign a priority to each, and run Auto-Combine to
// produce one new fused dataset plus an audit report. There is no
// dedicated "Entity" management UI yet — every run treats the selected
// sources as one ad hoc entity, which is enough to exercise the fully
// tested core (contracts/grouping/scoring/autoCombine/report) without
// building a separate entity CRUD surface first.
import { useState } from 'react'
import type { Dataset } from '../core/model'
import { candidateFromSourcePoint, type SourceRegistration } from '../core/fusion/model'
import { groupCandidatesByTime } from '../core/fusion/grouping'
import { autoCombine } from '../core/fusion/autoCombine'
import { buildFusionReport, fusionReportToMarkdown } from '../core/fusion/report'
import type { FusionArtifact } from '../core/fusion/artifact'
import { withPoints } from '../core/transforms'
import { logger } from '../core/logger'

interface SourceConfig {
  included: boolean
  priority: number
}

const ENTITY_ID = 'adhoc'

export function FusionPanel({ datasets, onCreateDataset }: { datasets: Dataset[]; onCreateDataset: (dataset: Dataset, artifact: FusionArtifact) => void }) {
  const [configs, setConfigs] = useState<Record<string, SourceConfig>>({})
  const [timeToleranceMs, setTimeToleranceMs] = useState(2000)
  const [report, setReport] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Reconcile configs during render when the dataset list changes — same
  // pattern used for the Sources panel's display settings.
  const [trackedIds, setTrackedIds] = useState('')
  const currentIds = datasets.map((d) => d.id).join(',')
  if (currentIds !== trackedIds) {
    setTrackedIds(currentIds)
    setConfigs((current) => {
      const next: Record<string, SourceConfig> = {}
      for (const dataset of datasets) next[dataset.id] = current[dataset.id] ?? { included: false, priority: 1 }
      return next
    })
  }

  const includedDatasets = datasets.filter((dataset) => configs[dataset.id]?.included)

  const toggleIncluded = (id: string) => setConfigs((current) => ({ ...current, [id]: { ...current[id]!, included: !current[id]?.included } }))
  const setPriority = (id: string, priority: number) => setConfigs((current) => ({ ...current, [id]: { ...current[id]!, priority } }))

  const run = () => {
    setError(null)
    setReport(null)
    if (includedDatasets.length < 2) {
      setError('Select at least two datasets to fuse.')
      return
    }
    try {
      const sources: SourceRegistration[] = includedDatasets.map((dataset) => ({
        id: dataset.id, entityId: ENTITY_ID, datasetId: dataset.id, label: dataset.name, priority: configs[dataset.id]?.priority ?? 1,
      }))
      const candidates = includedDatasets.flatMap((dataset) =>
        dataset.points
          .map((point, index) => point.time !== undefined ? candidateFromSourcePoint(dataset.id, index, point) : null)
          .filter((candidate) => candidate !== null))
      if (candidates.length === 0) {
        setError('None of the selected datasets have timed points to fuse.')
        return
      }
      const groups = groupCandidatesByTime(candidates, { entityId: ENTITY_ID, timeToleranceMs })
      const result = autoCombine(groups, sources)
      const base = includedDatasets[0]!
      const fused = withPoints(base, result.points)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const fusedDataset: Dataset = { ...fused, id: `fused_${timestamp}`, name: `Fused_${timestamp}`, createdAt: Date.now() }
      const fusionReport = buildFusionReport(result.decisions, sources)
      const artifact: FusionArtifact = {
        id: `fusion_${timestamp}`,
        entityId: ENTITY_ID,
        fusedDatasetId: fusedDataset.id,
        sourceRegistrations: sources,
        timeToleranceMs,
        decisions: result.decisions,
        report: fusionReport,
        createdAt: Date.now(),
      }
      setReport(fusionReportToMarkdown(fusionReport))
      logger.success('fusion', `Created ${fusedDataset.name} from ${includedDatasets.length} sources (${groups.length} groups)`)
      onCreateDataset(fusedDataset, artifact)
    } catch (err) {
      const message = (err as Error).message
      setError(message)
      logger.error('fusion', `Auto-Combine failed: ${message}`)
    }
  }

  if (datasets.length < 2) return <div className="panel-empty">Load at least two datasets to fuse them into one track.</div>

  return (
    <div className="fusion-panel">
      <p className="muted small">
        Pick two or more loaded datasets to auto-combine into one fused track. Auto-Combine always
        selects a real point from one of the sources for each time-aligned group — it never
        averages or invents a position. Raw source datasets are never modified.
      </p>
      <table className="compact-table sources-table">
        <thead><tr><th>include</th><th>name</th><th>points</th><th>priority</th></tr></thead>
        <tbody>
          {datasets.map((dataset) => (
            <tr key={dataset.id}>
              <td><input type="checkbox" checked={configs[dataset.id]?.included ?? false} onChange={() => toggleIncluded(dataset.id)} aria-label={`Include ${dataset.name} as a fusion source`} /></td>
              <td>{dataset.name}</td>
              <td className="mono">{dataset.points.length.toLocaleString()}</td>
              <td><input type="number" min={0} step={1} value={configs[dataset.id]?.priority ?? 1} disabled={!configs[dataset.id]?.included} onChange={(event) => setPriority(dataset.id, Math.max(0, Number(event.target.value) || 0))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="num-field"><span>time tolerance (ms)</span><input type="number" min={1} value={timeToleranceMs} onChange={(event) => setTimeToleranceMs(Math.max(1, Number(event.target.value) || 1))} /></label>
      <button type="button" disabled={includedDatasets.length < 2} onClick={run}>Run Auto-Combine</button>
      {error && <p className="error-line small">⚠ {error}</p>}
      {report && <pre className="preview-body mono fusion-report">{report}</pre>}
    </div>
  )
}
