import { useMemo } from 'react'
import type { Dataset } from '../core/model'
import {
  alignTracksByInterpolation,
  alignTracksByNearestTime,
  computeAlongCrossTrack,
  deriveInterpolatedRelativePosition,
  deriveRelativePosition,
  estimateClockDrift,
  type ClockDriftEstimate,
  type RelativePointSample,
} from '../core/analytics/relative'
import { assessDatasetCompatibility } from '../core/metadataCompatibility'
import { buildComparisonCsv } from '../core/analytics/comparisonReport'
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
  meanAlongTrack?: number
  meanCrossTrack?: number
  maxCrossTrack?: number
  drift?: ClockDriftEstimate
}

export function ComparisonPanel({ datasets, activeId, workspace, onWorkspaceChange, onSelectReferenceSample }: { datasets: Dataset[]; activeId: string | null; workspace: WorkspaceState['comparison']; onWorkspaceChange: (next: WorkspaceState['comparison']) => void; onSelectReferenceSample: (datasetId: string, pointIndex: number) => void }) {
  const referenceId = workspace.referenceDatasetId ?? activeId ?? datasets[0]?.id ?? ''
  const targetId = workspace.targetDatasetId ?? datasets.find((dataset) => dataset.id !== referenceId)?.id ?? ''
  const { toleranceMs, targetOffsetMs, interpolateTarget } = workspace

  const result = useMemo<ComparisonResult | null>(() => {
    const reference = datasets.find((dataset) => dataset.id === referenceId)
    const target = datasets.find((dataset) => dataset.id === targetId)
    if (!reference || !target || reference.id === target.id) return null
    const compatibility = assessDatasetCompatibility(reference, target)
    if (compatibility.level === 'blocked') return { samples: [], error: compatibility.reasons.join(' ') }
    try {
      const samples = interpolateTarget
        ? deriveInterpolatedRelativePosition(reference.points, target.points, alignTracksByInterpolation(reference.points, target.points, { maxBracketGapMs: toleranceMs, targetTimeOffsetMs: targetOffsetMs }))
        : deriveRelativePosition(reference.points, target.points, alignTracksByNearestTime(reference.points, target.points, { toleranceMs, targetTimeOffsetMs: targetOffsetMs }))
      if (samples.length === 0) return { samples, error: null }
      const ranges = samples.map((sample) => sample.slantRangeM)
      const horizontal = samples.map((sample) => sample.horizontalRangeM)
      const closures = samples.map((sample) => sample.closureRateMps).filter((value): value is number => value !== undefined)
      const minRange = Math.min(...ranges)
      const alongCross = computeAlongCrossTrack(reference.points, samples)
      const alongTrack = alongCross.map((sample) => sample.alongTrackM)
      const crossTrack = alongCross.map((sample) => sample.crossTrackM)
      // Interpolated samples set targetTimeMs = referenceTimeMs by construction
      // (see deriveInterpolatedRelativePosition), so estimating drift from them
      // would always yield a fabricated offset/rate of exactly zero rather than
      // a real measurement. Skip the estimate entirely in that mode instead of
      // showing a value indistinguishable from a genuine zero-drift result.
      let drift: ClockDriftEstimate | undefined
      if (!interpolateTarget) {
        try {
          drift = estimateClockDrift(samples.map((sample) => ({ referenceTimeMs: sample.referenceTimeMs, targetTimeMs: sample.targetTimeMs })))
        } catch {
          drift = undefined
        }
      }
      return {
        samples,
        error: null,
        minRange,
        maxRange: Math.max(...ranges),
        meanRange: mean(ranges),
        meanHorizontal: mean(horizontal),
        meanClosure: closures.length > 0 ? mean(closures) : undefined,
        closest: samples[ranges.indexOf(minRange)],
        meanAlongTrack: alongTrack.length > 0 ? mean(alongTrack) : undefined,
        meanCrossTrack: crossTrack.length > 0 ? mean(crossTrack) : undefined,
        maxCrossTrack: crossTrack.length > 0 ? Math.max(...crossTrack.map((value) => Math.abs(value))) : undefined,
        drift,
      }
    } catch (error) {
      return { samples: [], error: error instanceof Error ? error.message : String(error) }
    }
  }, [datasets, referenceId, targetId, toleranceMs, targetOffsetMs, interpolateTarget])

  if (datasets.length < 2) return <div className="panel-empty">Load at least two datasets to compare time-aligned relative position.</div>

  return (
    <div className="analysis-panel">
      <div className="analysis-toolbar">
        <Select label="reference dataset" value={referenceId} onChange={(referenceDatasetId) => onWorkspaceChange({ ...workspace, referenceDatasetId })} datasets={datasets} />
        <Select label="target dataset" value={targetId} onChange={(targetDatasetId) => onWorkspaceChange({ ...workspace, targetDatasetId })} datasets={datasets} />
        <NumberField label="tolerance (ms)" value={toleranceMs} min={0} onChange={(toleranceMs) => onWorkspaceChange({ ...workspace, toleranceMs })} />
        <NumberField label="target offset (ms)" value={targetOffsetMs} onChange={(targetOffsetMs) => onWorkspaceChange({ ...workspace, targetOffsetMs })} />
        <label className="chk"><input type="checkbox" checked={interpolateTarget} onChange={(event) => onWorkspaceChange({ ...workspace, interpolateTarget: event.target.checked })} />interpolate target positions</label>
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
            <Metric label="mean along-track" value={result.meanAlongTrack === undefined ? 'n/a' : `${format(result.meanAlongTrack)} m`} />
            <Metric label="mean cross-track" value={result.meanCrossTrack === undefined ? 'n/a' : `${format(result.meanCrossTrack)} m`} />
            <Metric label="max |cross-track|" value={result.maxCrossTrack === undefined ? 'n/a' : `${format(result.maxCrossTrack)} m`} />
            <Metric label="estimated clock offset" value={interpolateTarget ? 'n/a — not meaningful with interpolation enabled' : result.drift === undefined ? 'n/a' : `${format(result.drift.offsetMs)} ms`} />
            <Metric label="estimated clock drift" value={interpolateTarget ? 'n/a — not meaningful with interpolation enabled' : result.drift === undefined ? 'n/a' : `${format(result.drift.driftRatePerMs * 1_000_000)} ppm`} />
          </div>
          <button type="button" onClick={() => downloadComparison(result.samples, referenceId, targetId)}>Export comparison CSV</button>
          {result.closest && <div className="analysis-summary mono">Closest approach at reference index {result.closest.referenceIndex}, target index {result.closest.targetIndex}: bearing {format(result.closest.bearingDeg)}°, Δt {format(result.closest.deltaTimeMs)} ms, vertical separation {format(result.closest.relativeUpM)} m.</div>}
          <div className="compact-table"><table><thead><tr><th>Ref</th><th>Target</th><th>Kind</th><th>Δt ms</th><th>Slant m</th><th>Horizontal m</th><th>Bearing°</th><th>Up m</th><th>Closure m/s</th></tr></thead><tbody>{result.samples.slice(0, 250).map((sample) => <tr key={`${sample.referenceIndex}-${sample.targetIndex}`}><td><button type="button" className="link-button" aria-label={`Select reference point ${sample.referenceIndex}`} onClick={() => onSelectReferenceSample(referenceId, sample.referenceIndex)}>{sample.referenceIndex}</button></td><td>{sample.targetIndex}</td><td>{sample.derived ? 'interpolated' : 'observed'}</td><td>{format(sample.deltaTimeMs)}</td><td>{format(sample.slantRangeM)}</td><td>{format(sample.horizontalRangeM)}</td><td>{format(sample.bearingDeg)}</td><td>{format(sample.relativeUpM)}</td><td>{sample.closureRateMps === undefined ? '' : format(sample.closureRateMps)}</td></tr>)}</tbody></table></div>
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
function downloadComparison(samples: readonly RelativePointSample[], referenceId: string, targetId: string): void { const url = URL.createObjectURL(new Blob([buildComparisonCsv(samples)], { type: 'text/csv;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `jddc-comparison-${referenceId.slice(0, 8)}-${targetId.slice(0, 8)}.csv`; anchor.click(); URL.revokeObjectURL(url) }
