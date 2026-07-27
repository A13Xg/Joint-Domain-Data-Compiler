import { useMemo } from 'react'
import type { Dataset } from '../core/model'
import { alignTracksByNearestTime, deriveRelativePosition, type RelativePointSample } from '../core/analytics/relative'
import { assessDatasetCompatibility } from '../core/metadataCompatibility'
import type { WorkspaceState } from '../state/workspace'

interface ComparisonResult {
  samples: RelativePointSample[]
  error: string | null
  minRange?: number
  maxRange?: number
  meanRange?: number
  meanHorizontal?: number
  meanClosure?: number
  closest?: RelativePointSample
}

export function ComparisonPanel({ datasets, activeId, workspace, onWorkspaceChange }: { datasets: Dataset[]; activeId: string | null; workspace: WorkspaceState['comparison']; onWorkspaceChange: (next: WorkspaceState['comparison']) => void }) {
  const referenceId = workspace.referenceDatasetId ?? activeId ?? datasets[0]?.id ?? ''
  const targetId = workspace.targetDatasetId ?? datasets.find((dataset) => dataset.id !== referenceId)?.id ?? ''
  const { toleranceMs, targetOffsetMs } = workspace

  const result = useMemo<ComparisonResult | null>(() => {
    const reference = datasets.find((dataset) => dataset.id === referenceId)
    const target = datasets.find((dataset) => dataset.id === targetId)
    if (!reference || !target || reference.id === target.id) return null
    const compatibility = assessDatasetCompatibility(reference, target)
    if (compatibility.level === 'blocked') return { samples: [], error: compatibility.reasons.join(' ') }
    try {
      const pairs = alignTracksByNearestTime(reference.points, target.points, { toleranceMs, targetTimeOffsetMs: targetOffsetMs })
      const samples = deriveRelativePosition(reference.points, target.points, pairs)
      if (samples.length === 0) return { samples, error: null }
      const ranges = samples.map((sample) => sample.slantRangeM)
      const horizontal = samples.map((sample) => sample.horizontalRangeM)
      const closures = samples.map((sample) => sample.closureRateMps).filter((value): value is number => value !== undefined)
      const minRange = Math.min(...ranges)
      return {
        samples,
        error: null,
        minRange,
        maxRange: Math.max(...ranges),
        meanRange: mean(ranges),
        meanHorizontal: mean(horizontal),
        meanClosure: closures.length > 0 ? mean(closures) : undefined,
        closest: samples[ranges.indexOf(minRange)],
      }
    } catch (error) {
      return { samples: [], error: error instanceof Error ? error.message : String(error) }
    }
  }, [datasets, referenceId, targetId, toleranceMs, targetOffsetMs])

  if (datasets.length < 2) return <div className="panel-empty">Load at least two datasets to compare time-aligned relative position.</div>

  return (
    <div className="analysis-panel">
      <div className="analysis-toolbar">
        <Select label="reference dataset" value={referenceId} onChange={(referenceDatasetId) => onWorkspaceChange({ ...workspace, referenceDatasetId })} datasets={datasets} />
        <Select label="target dataset" value={targetId} onChange={(targetDatasetId) => onWorkspaceChange({ ...workspace, targetDatasetId })} datasets={datasets} />
        <NumberField label="tolerance (ms)" value={toleranceMs} min={0} onChange={(toleranceMs) => onWorkspaceChange({ ...workspace, toleranceMs })} />
        <NumberField label="target offset (ms)" value={targetOffsetMs} onChange={(targetOffsetMs) => onWorkspaceChange({ ...workspace, targetOffsetMs })} />
      </div>
      {referenceId === targetId && <div className="warn-line">Choose two different datasets.</div>}
      {result?.error && <div className="error-line">{result.error}</div>}
      {result && !result.error && result.samples.length === 0 && <div className="panel-empty">No timed samples aligned within the selected tolerance.</div>}
      {result && !result.error && result.samples.length > 0 && (
        <>
          <div className="metric-grid">
            <Metric label="aligned samples" value={result.samples.length.toLocaleString()} />
            <Metric label="closest slant range" value={`${format(result.minRange)} m`} />
            <Metric label="mean slant range" value={`${format(result.meanRange)} m`} />
            <Metric label="maximum slant range" value={`${format(result.maxRange)} m`} />
            <Metric label="mean horizontal range" value={`${format(result.meanHorizontal)} m`} />
            <Metric label="mean closure rate" value={result.meanClosure === undefined ? 'n/a' : `${format(result.meanClosure)} m/s`} />
          </div>
          {result.closest && <div className="analysis-summary mono">Closest approach at reference index {result.closest.referenceIndex}, target index {result.closest.targetIndex}: bearing {format(result.closest.bearingDeg)}°, Δt {format(result.closest.deltaTimeMs)} ms, vertical separation {format(result.closest.relativeUpM)} m.</div>}
          <div className="compact-table"><table><thead><tr><th>Ref</th><th>Target</th><th>Δt ms</th><th>Slant m</th><th>Horizontal m</th><th>Bearing°</th><th>Up m</th><th>Closure m/s</th></tr></thead><tbody>{result.samples.slice(0, 250).map((sample) => <tr key={`${sample.referenceIndex}-${sample.targetIndex}`}><td>{sample.referenceIndex}</td><td>{sample.targetIndex}</td><td>{format(sample.deltaTimeMs)}</td><td>{format(sample.slantRangeM)}</td><td>{format(sample.horizontalRangeM)}</td><td>{format(sample.bearingDeg)}</td><td>{format(sample.relativeUpM)}</td><td>{sample.closureRateMps === undefined ? '' : format(sample.closureRateMps)}</td></tr>)}</tbody></table></div>
          {result.samples.length > 250 && <div className="muted small">Showing the first 250 aligned samples.</div>}
        </>
      )}
    </div>
  )
}

function Select({ label, value, onChange, datasets }: { label: string; value: string; onChange: (value: string) => void; datasets: Dataset[] }) {
  return <label className="num-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label>
}

function NumberField({ label, value, min, onChange }: { label: string; value: number; min?: number; onChange: (value: number) => void }) {
  return <label className="num-field"><span>{label}</span><input type="number" min={min} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-card"><span className="metric-label">{label}</span><strong className="mono">{value}</strong></div>
}

function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length }
function format(value: number | undefined): string { if (value === undefined) return 'n/a'; if (Math.abs(value) >= 1000) return value.toFixed(0); if (Math.abs(value) >= 10) return value.toFixed(1); return value.toFixed(2) }
