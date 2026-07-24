import { useState } from 'react'
import type { Dataset, TrackPoint } from '../core/model'
import {
  decimate,
  dedupe,
  deriveKinematics,
  dropInvalid,
  offsetElevation,
  removeElevationOutliers,
  shiftTime,
  simplify,
  smooth,
  sortByTime,
  swapLatLon,
  type TransformResult,
} from '../core/transforms'
import { fixedRateResampleOperation, type InterpolationMode } from '../core/operations/resample'
import { applyTransformToRange } from '../core/rangeTransform'
import { usePointSelection } from '../state/pointSelection'
import { logger } from '../core/logger'

interface Props {
  dataset: Dataset
  onApply: (points: TrackPoint[], summary: string) => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
}

export function TransformPanel({ dataset, onApply, onUndo, onRedo, canUndo, canRedo }: Props) {
  const [dedupeTol, setDedupeTol] = useState(0)
  const [decimateFactor, setDecimateFactor] = useState(2)
  const [simplifyEps, setSimplifyEps] = useState(5)
  const [smoothWindow, setSmoothWindow] = useState(5)
  const [smoothCoords, setSmoothCoords] = useState(false)
  const [smoothEle, setSmoothEle] = useState(true)
  const [timeShift, setTimeShift] = useState(0)
  const [eleOffset, setEleOffset] = useState(0)
  const [outlierSigma, setOutlierSigma] = useState(4)
  const [resampleRateHz, setResampleRateHz] = useState(1)
  const [resampleMode, setResampleMode] = useState<InterpolationMode>('linear')
  const [resampleMaxGapSeconds, setResampleMaxGapSeconds] = useState(10)
  const [limitResampleGaps, setLimitResampleGaps] = useState(true)
  const [scopeToSelection, setScopeToSelection] = useState(false)
  const { indexRange } = usePointSelection(dataset.points)

  const run = (fn: () => TransformResult) => {
    try {
      const result = fn()
      logger.info('transform', result.summary)
      onApply(result.points, result.summary)
    } catch (error) {
      logger.error('transform', `Transform failed: ${(error as Error).message}`)
    }
  }

  const runScoped = (transform: (points: TrackPoint[]) => TransformResult) => {
    if (scopeToSelection && indexRange) {
      run(() => applyTransformToRange(dataset.points, indexRange, transform))
      return
    }
    run(() => transform(dataset.points))
  }

  const runResample = () => {
    try {
      const params = fixedRateResampleOperation.validateParams({
        rateHz: resampleRateHz,
        interpolation: resampleMode,
        maxGapMs: limitResampleGaps ? resampleMaxGapSeconds * 1000 : undefined,
      })
      const result = fixedRateResampleOperation.execute({ dataset, params })
      logger.info('transform', result.summary)
      for (const warning of result.warnings ?? []) logger.warn('transform', warning)
      onApply(result.dataset.points, result.summary)
    } catch (error) {
      logger.error('transform', `Resampling failed: ${(error as Error).message}`)
    }
  }

  const points = dataset.points
  const scoped = scopeToSelection && indexRange !== null

  return (
    <div className="transform-panel">
      <div className="transform-history">
        <button type="button" disabled={!canUndo} onClick={onUndo}>↶ Undo</button>
        <button type="button" disabled={!canRedo} onClick={onRedo}>↷ Redo</button>
        <span className="muted small">{points.length.toLocaleString()} points</span>
        <label className="chk">
          <input
            type="checkbox"
            checked={scopeToSelection}
            disabled={!indexRange}
            onChange={(event) => setScopeToSelection(event.target.checked)}
          />
          selected range only{indexRange ? ` (${indexRange.start}–${indexRange.end})` : ''}
        </label>
      </div>

      <div className="transform-grid">
        <Op title="Sort by time" desc="Order points chronologically. Required by most track players.">
          <button type="button" onClick={() => run(() => sortByTime(points))}>Apply</button>
        </Op>

        <Op title="Swap lat / lon" desc="Fix transposed coordinate columns. Supports selected-range scope.">
          <button type="button" onClick={() => runScoped((selected) => swapLatLon(selected))}>Apply{scoped ? ' to range' : ''}</button>
        </Op>

        <Op title="Drop invalid" desc="Remove points outside valid lat/lon ranges. Full dataset only.">
          <button type="button" onClick={() => run(() => dropInvalid(points))}>Apply</button>
        </Op>

        <Op title="Dedupe" desc="Collapse consecutive points within a distance tolerance. Full dataset only.">
          <NumField label="tolerance (m)" value={dedupeTol} onChange={setDedupeTol} min={0} step={1} />
          <button type="button" onClick={() => run(() => dedupe(points, dedupeTol))}>Apply</button>
        </Op>

        <Op title="Decimate" desc="Keep every Nth point for fast thinning. Full dataset only.">
          <NumField label="factor" value={decimateFactor} onChange={setDecimateFactor} min={2} step={1} />
          <button type="button" onClick={() => run(() => decimate(points, decimateFactor))}>Apply</button>
        </Op>

        <Op title="Resample to fixed rate" desc="Generate evenly timed samples using linear or step interpolation. Full dataset only.">
          <NumField label="rate (Hz)" value={resampleRateHz} onChange={setResampleRateHz} min={0.001} step={0.5} />
          <label className="num-field"><span>interpolation</span><select value={resampleMode} onChange={(event) => setResampleMode(event.target.value as InterpolationMode)}><option value="linear">linear</option><option value="step">step / hold</option></select></label>
          <label className="chk"><input type="checkbox" checked={limitResampleGaps} onChange={(event) => setLimitResampleGaps(event.target.checked)} /> skip large gaps</label>
          {limitResampleGaps && <NumField label="max gap (s)" value={resampleMaxGapSeconds} onChange={setResampleMaxGapSeconds} min={0.001} step={1} />}
          <button type="button" onClick={runResample}>Apply</button>
        </Op>

        <Op title="Simplify (Douglas–Peucker)" desc="Shape-preserving reduction within an epsilon. Full dataset only.">
          <NumField label="ε (m)" value={simplifyEps} onChange={setSimplifyEps} min={0.1} step={0.5} />
          <button type="button" onClick={() => run(() => simplify(points, simplifyEps))}>Apply</button>
        </Op>

        <Op title="Smooth" desc="Moving-average filter to reduce GPS jitter. Supports selected-range scope.">
          <NumField label="window" value={smoothWindow} onChange={setSmoothWindow} min={2} step={1} />
          <label className="chk"><input type="checkbox" checked={smoothCoords} onChange={(event) => setSmoothCoords(event.target.checked)} /> position</label>
          <label className="chk"><input type="checkbox" checked={smoothEle} onChange={(event) => setSmoothEle(event.target.checked)} /> elevation</label>
          <button type="button" onClick={() => runScoped((selected) => smooth(selected, smoothWindow, { coords: smoothCoords, elevation: smoothEle }))}>Apply{scoped ? ' to range' : ''}</button>
        </Op>

        <Op title="Derive kinematics" desc="Compute distance, speed, and heading channels. Full dataset only.">
          <button type="button" onClick={() => run(() => deriveKinematics(points))}>Apply</button>
        </Op>

        <Op title="Shift time" desc="Add a fixed offset to timestamps. Supports selected-range scope.">
          <NumField label="seconds" value={timeShift} onChange={setTimeShift} step={1} />
          <button type="button" onClick={() => runScoped((selected) => shiftTime(selected, timeShift))}>Apply{scoped ? ' to range' : ''}</button>
        </Op>

        <Op title="Offset elevation" desc="Datum correction. Supports selected-range scope.">
          <NumField label="meters" value={eleOffset} onChange={setEleOffset} step={1} />
          <button type="button" onClick={() => runScoped((selected) => offsetElevation(selected, eleOffset))}>Apply{scoped ? ' to range' : ''}</button>
        </Op>

        <Op title="Remove elevation outliers" desc="MAD-based spike rejection on elevation. Supports selected-range scope.">
          <NumField label="σ threshold" value={outlierSigma} onChange={setOutlierSigma} min={1} step={0.5} />
          <button type="button" onClick={() => runScoped((selected) => removeElevationOutliers(selected, outlierSigma))}>Apply{scoped ? ' to range' : ''}</button>
        </Op>
      </div>
    </div>
  )
}

function Op({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return <div className="op-card"><div className="op-head"><h4>{title}</h4><p className="op-desc">{desc}</p></div><div className="op-controls">{children}</div></div>
}

function NumField({ label, value, onChange, min, step }: { label: string; value: number; onChange: (value: number) => void; min?: number; step?: number }) {
  return <label className="num-field"><span>{label}</span><input type="number" value={value} min={min} step={step} onChange={(event) => onChange(Number(event.target.value))} /></label>
}
