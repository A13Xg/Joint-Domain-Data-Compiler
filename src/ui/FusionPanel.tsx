// Tranche 6 Task 6.3 (UI). Lets a user pick two or more loaded datasets as
// fusion sources, assign a priority to each, and run Auto-Combine to
// produce one new fused dataset plus an audit report. There is no
// dedicated "Entity" management UI yet — every run treats the selected
// sources as one ad hoc entity, which is enough to exercise the fully
// tested core (contracts/grouping/scoring/autoCombine/report) without
// building a separate entity CRUD surface first.
import { useState } from 'react'
import type { Dataset } from '../core/model'
import { candidateFromSourcePoint, type SelectedIntervalOverride, type SelectedPointOverride, type SourceRegistration } from '../core/fusion/model'
import { groupCandidatesByTime } from '../core/fusion/grouping'
import { autoCombine } from '../core/fusion/autoCombine'
import { buildFusionReport, fusionReportToMarkdown } from '../core/fusion/report'
import type { FusionArtifact } from '../core/fusion/artifact'
import { withPoints } from '../core/transforms'
import { logger } from '../core/logger'
import { assessFusionCompatibility } from '../core/metadataCompatibility'
import { fingerprintDataset } from '../core/recipes/hash'

interface SourceConfig {
  included: boolean
  priority: number
}

const ENTITY_ID = 'adhoc'

export function FusionPanel({ datasets, fusionArtifacts = [], onCreateDataset }: { datasets: Dataset[]; fusionArtifacts?: FusionArtifact[]; onCreateDataset: (dataset: Dataset, artifact: FusionArtifact) => void }) {
  const [configs, setConfigs] = useState<Record<string, SourceConfig>>({})
  const [timeToleranceMs, setTimeToleranceMs] = useState(2000)
  const [report, setReport] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pointGroupId, setPointGroupId] = useState('')
  const [pointSourceId, setPointSourceId] = useState('')
  const [intervalStart, setIntervalStart] = useState('')
  const [intervalEnd, setIntervalEnd] = useState('')
  const [intervalSourceId, setIntervalSourceId] = useState('')

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
  const includedSources: SourceRegistration[] = includedDatasets.map((dataset) => ({ id: dataset.id, entityId: ENTITY_ID, datasetId: dataset.id, label: dataset.name, priority: configs[dataset.id]?.priority ?? 1 }))
  const compatibility = assessFusionCompatibility(includedDatasets)
  const previewGroups = (() => {
    const candidates = includedDatasets.flatMap((dataset) => dataset.points.map((point, index) => point.time !== undefined ? candidateFromSourcePoint(dataset.id, index, point) : null).filter((candidate) => candidate !== null))
    return candidates.length > 0 ? groupCandidatesByTime(candidates, { entityId: ENTITY_ID, timeToleranceMs }) : []
  })()

  const toggleIncluded = (id: string) => setConfigs((current) => ({ ...current, [id]: { ...current[id]!, included: !current[id]?.included } }))
  const setPriority = (id: string, priority: number) => setConfigs((current) => ({ ...current, [id]: { ...current[id]!, priority } }))

  const run = () => {
    setError(null)
    setReport(null)
    if (includedDatasets.length < 2) {
      setError('Select at least two datasets to fuse.')
      return
    }
    if (compatibility.level === 'blocked') {
      const message = `Fusion blocked: ${compatibility.reasons.join(' ')}`
      setError(message)
      logger.warn('fusion', message)
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
      const pointOverrides: SelectedPointOverride[] = pointGroupId && pointSourceId ? [{ entityId: ENTITY_ID, groupId: pointGroupId, sourceId: pointSourceId }] : []
      const startMs = intervalStart ? Date.parse(intervalStart) : NaN
      const endMs = intervalEnd ? Date.parse(intervalEnd) : NaN
      const intervalOverrides: SelectedIntervalOverride[] = intervalStart || intervalEnd || intervalSourceId
        ? [{ entityId: ENTITY_ID, sourceId: intervalSourceId, startMs, endMs }]
        : []
      const result = autoCombine(groups, sources, { pointOverrides, intervalOverrides })
      const base = includedDatasets[0]!
      const fused = withPoints(base, result.points)
      const runTime = new Date()
      const timestamp = runTime.toISOString().replace(/[:.]/g, '-')
      const fusedDataset: Dataset = { ...fused, id: `fused_${timestamp}`, name: `Fused_${timestamp}`, createdAt: runTime.getTime() }
      const fusionReport = buildFusionReport(result.decisions, sources)
      fusionReport.compatibility = compatibility
      const artifact: FusionArtifact = {
        id: `fusion_${timestamp}`,
        entityId: ENTITY_ID,
        fusedDatasetId: fusedDataset.id,
        sourceDatasetHashes: Object.fromEntries(sources.map((source) => [source.id, fingerprintDataset(includedDatasets.find((dataset) => dataset.id === source.datasetId)!)])),
        fusedDatasetHash: fingerprintDataset(fusedDataset),
        sourceRegistrations: sources,
        timeToleranceMs,
        pointOverrides,
        intervalOverrides,
        decisions: result.decisions,
        report: fusionReport,
        createdAt: runTime.getTime(),
        compatibility,
      }
      setReport(fusionReportToMarkdown(fusionReport, { pointOverrides, intervalOverrides }))
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
      <details className="analysis-summary">
        <summary>Manual source overrides (optional)</summary>
        <p className="muted small">Overrides select an existing source point; raw datasets remain unchanged. Point selection is by the aligned group time.</p>
        <div className="field-grid">
          <label className="field"><span>Point group</span><select value={pointGroupId} onChange={(event) => setPointGroupId(event.target.value)}><option value="">No point override</option>{previewGroups.map((group) => <option key={group.id} value={group.id}>{new Date(group.groupTimeMs).toISOString()} ({group.id})</option>)}</select></label>
          <label className="field"><span>Point source</span><select value={pointSourceId} disabled={!pointGroupId} onChange={(event) => setPointSourceId(event.target.value)}><option value="">Select source</option>{(previewGroups.find((group) => group.id === pointGroupId)?.candidates ?? []).map((candidate) => <option key={candidate.sourceId} value={candidate.sourceId}>{includedSources.find((source) => source.id === candidate.sourceId)?.label ?? candidate.sourceId}</option>)}</select></label>
          <label className="field"><span>Interval start (local)</span><input type="datetime-local" value={intervalStart} onChange={(event) => setIntervalStart(event.target.value)} /></label>
          <label className="field"><span>Interval end (local)</span><input type="datetime-local" value={intervalEnd} onChange={(event) => setIntervalEnd(event.target.value)} /></label>
          <label className="field"><span>Interval source</span><select value={intervalSourceId} disabled={!intervalStart && !intervalEnd} onChange={(event) => setIntervalSourceId(event.target.value)}><option value="">Select source</option>{includedSources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}</select></label>
        </div>
      </details>
      <button type="button" disabled={includedDatasets.length < 2} onClick={run}>Run Auto-Combine</button>
      {includedDatasets.length >= 2 && <p className={`small ${compatibility.level === 'blocked' ? 'error-line' : 'muted'}`}>
        {compatibility.level === 'blocked' ? '⚠ Fusion blocked: ' : 'Compatibility gate: '}{compatibility.reasons.length > 0 ? compatibility.reasons.join(' ') : 'Selected sources declare matching references and comparable spatial coverage.'}
      </p>}
      {error && <p className="error-line small">⚠ {error}</p>}
      {report && <pre className="preview-body mono fusion-report">{report}</pre>}
      {fusionArtifacts.length > 0 && <details className="analysis-summary" open><summary>Fusion evidence ({fusionArtifacts.length} persisted run{fusionArtifacts.length === 1 ? '' : 's'})</summary>{fusionArtifacts.map((artifact) => <FusionEvidence key={artifact.id} artifact={artifact} datasets={datasets} />)}</details>}
    </div>
  )
}

function FusionEvidence({ artifact, datasets }: { artifact: FusionArtifact; datasets: Dataset[] }) {
  const sourceLabels = new Map(artifact.sourceRegistrations.map((source) => [source.id, source.label]))
  const fusedDataset = datasets.find((dataset) => dataset.id === artifact.fusedDatasetId)
  const rows = artifact.decisions.map((decision, index) => ({
    decision,
    index,
    time: decision.groupTimeMs ?? fusedDataset?.points[index]?.time,
  })).sort((a, b) => (a.time ?? Number.POSITIVE_INFINITY) - (b.time ?? Number.POSITIVE_INFINITY) || a.decision.groupId.localeCompare(b.decision.groupId) || a.index - b.index)

  return <section className="fusion-evidence" aria-labelledby={`fusion-evidence-${artifact.id}`}>
    <h3 id={`fusion-evidence-${artifact.id}`}>Run {artifact.id}</h3>
    <p className="small muted">Created {formatFusionTime(artifact.createdAt)} · {artifact.decisions.length.toLocaleString()} groups · {artifact.pointOverrides?.length ?? 0} point, {artifact.intervalOverrides?.length ?? 0} interval override(s)</p>
    <div className="compact-table fusion-timeline">
      <table>
        <caption>Fusion decision timeline for {artifact.id}</caption>
        <thead><tr><th scope="col">timestamp</th><th scope="col">group</th><th scope="col">chosen source</th><th scope="col">skipped sources</th><th scope="col">reason / confidence</th><th scope="col">override</th></tr></thead>
        <tbody>{rows.map(({ decision, time }) => <tr key={`${artifact.id}-${decision.groupId}`}>
          <td className="mono">{formatFusionTime(time)}</td>
          <td className="mono">{decision.groupId}</td>
          <td>{sourceLabels.get(decision.chosenSourceId) ?? decision.chosenSourceId}</td>
          <td>{decision.skippedSourceIds.length > 0 ? decision.skippedSourceIds.map((id) => sourceLabels.get(id) ?? id).join(', ') : '—'}</td>
          <td>{decision.reason}<br /><span className="muted mono">{decision.confidence.toFixed(3)}</span></td>
          <td>{overrideForDecision(artifact, decision.groupId, time) ?? '—'}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <pre className="preview-body mono fusion-report">{fusionReportToMarkdown(artifact.report, artifact).replace('# Fusion Report', '# Fusion Report — Evidence')}</pre>
  </section>
}

function overrideForDecision(artifact: FusionArtifact, groupId: string, time: number | undefined): string | undefined {
  if (artifact.pointOverrides?.some((override) => override.groupId === groupId)) return 'point'
  if (time !== undefined && artifact.intervalOverrides?.some((override) => time >= override.startMs && time <= override.endMs)) return 'interval'
  return undefined
}

function formatFusionTime(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) ? new Date(value).toISOString() : 'Unavailable'
}
