// Transform workbench: stackable, previewable data-massaging operations with
// full undo/redo. Each action returns a new point array and a summary that is
// logged and surfaced to the user.
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

  const run = (fn: () => TransformResult) => {
    try {
      const result = fn()
      logger.info('transform', result.summary)
      onApply(result.points, result.summary)
    } catch (err) {
      logger.error('transform', `Transform failed: ${(err as Error).message}`)
    }
  }

  const pts = dataset.points

  return (
    <div className="transform-panel">
      <div className="transform-history">
        <button type="button" disabled={!canUndo} onClick={onUndo}>↶ Undo</button>
        <button type="button" disabled={!canRedo} onClick={onRedo}>↷ Redo</button>
        <span className="muted small">{pts.length.toLocaleString()} points</span>
      </div>

      <div className="transform-grid">
        <Op title="Sort by time" desc="Order points chronologically. Required by most track players.">
          <button type="button" onClick={() => run(() => sortByTime(pts))}>Apply</button>
        </Op>

        <Op title="Swap lat / lon" desc="Fix transposed coordinate columns.">
          <button type="button" onClick={() => run(() => swapLatLon(pts))}>Apply</button>
        </Op>

        <Op title="Drop invalid" desc="Remove points outside valid lat/lon ranges.">
          <button type="button" onClick={() => run(() => dropInvalid(pts))}>Apply</button>
        </Op>

        <Op title="Dedupe" desc="Collapse consecutive points within a distance tolerance.">
          <NumField label="tolerance (m)" value={dedupeTol} onChange={setDedupeTol} min={0} step={1} />
          <button type="button" onClick={() => run(() => dedupe(pts, dedupeTol))}>Apply</button>
        </Op>

        <Op title="Decimate" desc="Keep every Nth point for fast thinning.">
          <NumField label="factor" value={decimateFactor} onChange={setDecimateFactor} min={2} step={1} />
          <button type="button" onClick={() => run(() => decimate(pts, decimateFactor))}>Apply</button>
        </Op>

        <Op title="Simplify (Douglas–Peucker)" desc="Shape-preserving reduction within an epsilon.">
          <NumField label="ε (m)" value={simplifyEps} onChange={setSimplifyEps} min={0.1} step={0.5} />
          <button type="button" onClick={() => run(() => simplify(pts, simplifyEps))}>Apply</button>
        </Op>

        <Op title="Smooth" desc="Moving-average filter to reduce GPS jitter.">
          <NumField label="window" value={smoothWindow} onChange={setSmoothWindow} min={2} step={1} />
          <label className="chk"><input type="checkbox" checked={smoothCoords} onChange={(e) => setSmoothCoords(e.target.checked)} /> position</label>
          <label className="chk"><input type="checkbox" checked={smoothEle} onChange={(e) => setSmoothEle(e.target.checked)} /> elevation</label>
          <button type="button" onClick={() => run(() => smooth(pts, smoothWindow, { coords: smoothCoords, elevation: smoothEle }))}>Apply</button>
        </Op>

        <Op title="Derive kinematics" desc="Compute distance, speed, and heading channels.">
          <button type="button" onClick={() => run(() => deriveKinematics(pts))}>Apply</button>
        </Op>

        <Op title="Shift time" desc="Add a fixed offset to every timestamp (clock alignment).">
          <NumField label="seconds" value={timeShift} onChange={setTimeShift} step={1} />
          <button type="button" onClick={() => run(() => shiftTime(pts, timeShift))}>Apply</button>
        </Op>

        <Op title="Offset elevation" desc="Datum correction across all points.">
          <NumField label="meters" value={eleOffset} onChange={setEleOffset} step={1} />
          <button type="button" onClick={() => run(() => offsetElevation(pts, eleOffset))}>Apply</button>
        </Op>

        <Op title="Remove elevation outliers" desc="MAD-based spike rejection on elevation.">
          <NumField label="σ threshold" value={outlierSigma} onChange={setOutlierSigma} min={1} step={0.5} />
          <button type="button" onClick={() => run(() => removeElevationOutliers(pts, outlierSigma))}>Apply</button>
        </Op>
      </div>
    </div>
  )
}

function Op({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="op-card">
      <div className="op-head">
        <h4>{title}</h4>
        <p className="op-desc">{desc}</p>
      </div>
      <div className="op-controls">{children}</div>
    </div>
  )
}

function NumField({
  label,
  value,
  onChange,
  min,
  step,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  step?: number
}) {
  return (
    <label className="num-field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
