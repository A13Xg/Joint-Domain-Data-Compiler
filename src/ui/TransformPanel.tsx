import { useEffect, useRef, useState } from 'react'
import type { Dataset, TrackPoint } from '../core/model'
import {
  decimate, dedupe, dejitterTimestamps, dropInvalid, exponentialMovingAverageElevation, hampelFilterElevation, medianFilterElevation,
  removeElevationOutliers, simplify, smooth, sortByTime, swapLatLon, type DuplicateTimestampPolicy, type TransformResult,
} from '../core/transforms'

import { fixedRateResampleOperation, type InterpolationMode, type ResampleParams } from '../core/operations/resample'
import { applyTransformToRange } from '../core/rangeTransform'
import { computeOperationPreview, describeOperationPreview } from '../core/recipes/preview'
import type { OperationRecord, Recipe } from '../core/recipes/model'
import { buildRecipe, executeOperation, replayRecipe } from '../core/recipes/executor'
import { getOperation } from '../core/recipes/registry'
import { usePointSelection } from '../state/pointSelection'
import { ComputeClient, type ComputeRunHandle } from '../compute/client'
import { logger } from '../core/logger'

interface Props {
  dataset: Dataset
  onApply: (points: TrackPoint[], summary: string, preserveSelection: boolean, record?: OperationRecord) => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  operationHistory: OperationRecord[]
  replaySource?: Dataset
  namedRecipes: Recipe[]
  onSaveRecipe: (recipe: Recipe) => void
  onDeleteRecipe: (recipeId: string) => void
  onReplay: (dataset: Dataset, summary: string) => void
}

interface ResampleWorkerResult { dataset: Dataset; summary: string; warnings?: string[] }

export function TransformPanel({ dataset, onApply, onUndo, onRedo, canUndo, canRedo, operationHistory, replaySource, namedRecipes, onSaveRecipe, onDeleteRecipe, onReplay }: Props) {
  const [dedupeTol, setDedupeTol] = useState(0)
  const [decimateFactor, setDecimateFactor] = useState(2)
  const [simplifyEps, setSimplifyEps] = useState(5)
  const [smoothWindow, setSmoothWindow] = useState(5)
  const [smoothCoords, setSmoothCoords] = useState(false)
  const [smoothEle, setSmoothEle] = useState(true)
  const [timeShift, setTimeShift] = useState(0)
  const [eleOffset, setEleOffset] = useState(0)
  const [outlierSigma, setOutlierSigma] = useState(4)
  const [medianWindow, setMedianWindow] = useState(5)
  const [emaAlpha, setEmaAlpha] = useState(0.25)
  const [hampelWindow, setHampelWindow] = useState(11)
  const [hampelSigma, setHampelSigma] = useState(3)
  const [replayError, setReplayError] = useState<string | null>(null)
  const [recipeName, setRecipeName] = useState('')
  const [loadedRecipeId, setLoadedRecipeId] = useState<string | null>(null)
  const [resampleRateHz, setResampleRateHz] = useState(1)
  const [resampleMode, setResampleMode] = useState<InterpolationMode>('linear')
  const replayHistory = () => {
    if (!replaySource || operationHistory.length === 0) return
    try {
      const recipe: Recipe = { schemaVersion: 1, id: 'current-history', name: 'Current operation history', createdAt: operationHistory[0]!.createdAt, sourceDatasetHash: operationHistory[0]!.inputDatasetHash, operations: operationHistory }
      const replayed = replayRecipe(replaySource, recipe)
      onReplay(replayed, `Replayed ${operationHistory.length} verified operation(s)`)
      setReplayError(null)
    } catch (error) { setReplayError((error as Error).message) }
  }
  const replayableHistory = operationHistory.length > 0 && operationHistory.every((record) => getOperation(record.operationId)?.version === record.operationVersion)
  const saveRecipe = () => {
    if (!replaySource || !replayableHistory) return
    const recipe = buildRecipe(recipeName, replaySource, operationHistory)
    onSaveRecipe(recipe)
    setLoadedRecipeId(recipe.id)
    setRecipeName('')
    setReplayError(null)
  }
  const replayNamedRecipe = (recipe: Recipe) => {
    if (!replaySource) { setReplayError('No retained source snapshot is available for this recipe.'); return }
    try {
      onReplay(replayRecipe(replaySource, recipe), `Replayed recipe “${recipe.name}”`)
      setReplayError(null)
    } catch (error) { setReplayError((error as Error).message) }
  }
  const [resampleMaxGapSeconds, setResampleMaxGapSeconds] = useState(10)
  const [limitResampleGaps, setLimitResampleGaps] = useState(true)
  const [resampleProgress, setResampleProgress] = useState<string | null>(null)
  const [dejitterPolicy, setDejitterPolicy] = useState<DuplicateTimestampPolicy>('nudge')
  const [dejitterEpsilonMs, setDejitterEpsilonMs] = useState(1)
  const [distanceIntervalMeters, setDistanceIntervalMeters] = useState(10)
  const [scopeToSelection, setScopeToSelection] = useState(false)
  const { indexRange } = usePointSelection(dataset.points)
  const computeClientRef = useRef<ComputeClient | null>(null)
  const activeResampleRef = useRef<ComputeRunHandle<ResampleWorkerResult> | null>(null)

  useEffect(() => () => computeClientRef.current?.dispose(), [])

  const run = (fn: () => TransformResult & { warnings?: string[] }, preserveSelection = true) => {
    try {
      const result = fn()
      const preview = computeOperationPreview(dataset, { ...dataset, points: result.points }, { indexRange })
      if (preview.isDestructive) {
        const proceed = window.confirm(`This will change ${describeOperationPreview(preview)}. Continue?`)
        if (!proceed) {
          logger.info('transform', `Declined: ${result.summary} (${describeOperationPreview(preview)})`)
          return
        }
      }
      logger.info('transform', result.summary)
      for (const warning of result.warnings ?? []) logger.warn('transform', warning)
      onApply(result.points, result.summary, preserveSelection)
    } catch (error) {
      logger.error('transform', `Transform failed: ${(error as Error).message}`)
    }
  }

  const runScoped = (transform: (points: TrackPoint[]) => TransformResult) => {
    if (scopeToSelection && indexRange) { run(() => applyTransformToRange(dataset.points, indexRange, transform)); return }
    run(() => transform(dataset.points))
  }

  const runReplayable = (operationId: string, params: unknown) => {
    try {
      const execution = executeOperation(dataset, operationId, params)
      const preview = computeOperationPreview(dataset, execution.dataset, { indexRange })
      if (preview.isDestructive && !window.confirm(`This will change ${describeOperationPreview(preview)}. Continue?`)) return
      logger.info('transform', execution.record.summary)
      for (const warning of execution.record.warnings) logger.warn('transform', warning)
      onApply(execution.dataset.points, execution.record.summary, true, execution.record)
    } catch (error) {
      logger.error('transform', `Transform failed: ${(error as Error).message}`)
    }
  }

  const runResample = async () => {
    try {
      const params: ResampleParams = fixedRateResampleOperation.validateParams({
        rateHz: resampleRateHz,
        interpolation: resampleMode,
        maxGapMs: limitResampleGaps ? resampleMaxGapSeconds * 1000 : undefined,
      })
      if (!computeClientRef.current) {
        const worker = new Worker(new URL('../compute/worker.ts', import.meta.url), { type: 'module' })
        computeClientRef.current = new ComputeClient(worker)
      }
      setResampleProgress('Starting resampling worker')
      const handle = computeClientRef.current.run<{ points: TrackPoint[]; params: ResampleParams }, ResampleWorkerResult>(
        'fixed-rate-resample', 1, { points: dataset.points, params },
        { onProgress: (progress) => setResampleProgress(progress.message ?? `${progress.completed}/${progress.total ?? '?'}`) },
      )
      activeResampleRef.current = handle
      const result = await handle.promise
      logger.info('transform', result.summary)
      for (const warning of result.warnings ?? []) logger.warn('transform', warning)
      onApply(result.dataset.points, result.summary, false)
    } catch (error) {
      if ((error as Error).name === 'AbortError') logger.warn('transform', 'Resampling cancelled')
      else logger.error('transform', `Resampling failed: ${(error as Error).message}`)
    } finally {
      activeResampleRef.current = null
      setResampleProgress(null)
    }
  }

  const points = dataset.points
  const scoped = scopeToSelection && indexRange !== null
  // 'drop'/'average' change point count, which applyTransformToRange rejects
  // outright — block Apply (with a visible reason, not a silent log line)
  // whenever scoping to a selection makes the current policy unusable.
  const dejitterPolicyLocked = scoped && dejitterPolicy !== 'nudge'

  return (
    <div className="transform-panel">
      <div className="transform-history">
        <button type="button" disabled={!canUndo} onClick={onUndo}>↶ Undo</button>
        <button type="button" disabled={!canRedo} onClick={onRedo}>↷ Redo</button>
        <span className="muted small">{points.length.toLocaleString()} points</span>
        <label className="chk"><input type="checkbox" checked={scopeToSelection} disabled={!indexRange} onChange={(event) => setScopeToSelection(event.target.checked)} />selected range only{indexRange ? ` (${indexRange.start}–${indexRange.end})` : ''}</label>
      </div>
      {operationHistory.length > 0 && <details className="operation-history"><summary>Operation history ({operationHistory.length})</summary><p className="muted small">Only registered operations with matching versions can be replayed. Legacy history remains visible but is not represented as a reproducible recipe.</p><ul>{[...operationHistory].reverse().slice(0, 20).map((record) => {
        const registered = getOperation(record.operationId)
        const replayable = registered?.version === record.operationVersion
        return <li key={record.id} className="mono small"><span className="muted">{new Date(record.createdAt).toLocaleTimeString()}</span> {record.summary}{!replayable && <span className="warn"> — not replayable: {registered ? `requires v${registered.version}` : 'operation unavailable'}</span>}</li>
      })}</ul></details>}
      {operationHistory.length > 0 && <div className="analysis-toolbar"><button type="button" disabled={!replaySource} onClick={replayHistory}>Replay verified history</button>{!replaySource && <span className="muted small">No retained source snapshot is available for replay.</span>}{replayError && <span className="error-line">Replay blocked: {replayError}</span>}</div>}
      {operationHistory.length > 0 && <div className="recipe-capture analysis-toolbar"><label className="field"><span>Recipe name</span><input aria-label="Recipe name" value={recipeName} placeholder="e.g. clean and derive" onChange={(event) => setRecipeName(event.target.value)} /></label><button type="button" disabled={!replayableHistory || !replaySource || !recipeName.trim()} onClick={saveRecipe}>Save named recipe</button>{!replayableHistory && <span className="warn small">Cannot save: one or more history records are not replayable at the current operation version.</span>}{replayableHistory && !replaySource && <span className="warn small">Cannot save: no retained source snapshot is available.</span>}</div>}
      {namedRecipes.length > 0 && <details className="named-recipes" open><summary>Named recipes ({namedRecipes.length})</summary><ul>{namedRecipes.map((recipe) => <li key={recipe.id} className="analysis-toolbar"><span><strong>{recipe.name}</strong> <span className="muted small">{recipe.operations.length} operation(s)</span>{recipe.id === loadedRecipeId && <span className="muted small"> — loaded</span>}</span><span><button type="button" onClick={() => setLoadedRecipeId(recipe.id)}>Load</button><button type="button" disabled={!replaySource} onClick={() => replayNamedRecipe(recipe)}>Replay</button><button type="button" onClick={() => { if (window.confirm(`Delete recipe “${recipe.name}”?`)) onDeleteRecipe(recipe.id) }}>Delete</button></span></li>)}</ul>{loadedRecipeId && <p className="muted small">Loaded recipe is ready to replay from the retained source snapshot.</p>}</details>}
      <div className="transform-grid">
        <Op title="Sort by time" desc="Order points chronologically. Required by most track players."><button type="button" onClick={() => run(() => sortByTime(points), false)}>Apply</button></Op>
        <Op title="Swap lat / lon" desc="Fix transposed coordinate columns. Supports selected-range scope."><button type="button" onClick={() => runScoped((selected) => swapLatLon(selected))}>Apply{scoped ? ' to range' : ''}</button></Op>
        <Op title="Drop invalid" desc="Remove points outside valid lat/lon ranges. Full dataset only."><button type="button" onClick={() => run(() => dropInvalid(points), false)}>Apply</button></Op>
        <Op title="Dedupe" desc="Collapse consecutive points within a distance tolerance. Full dataset only."><NumField label="tolerance (m)" value={dedupeTol} onChange={setDedupeTol} min={0} step={1} /><button type="button" onClick={() => run(() => dedupe(points, dedupeTol), false)}>Apply</button></Op>
        <Op title="Decimate" desc="Keep every Nth point for fast thinning. Full dataset only."><NumField label="factor" value={decimateFactor} onChange={setDecimateFactor} min={2} step={1} /><button type="button" onClick={() => run(() => decimate(points, decimateFactor), false)}>Apply</button></Op>
        <Op title="Resample to fixed rate" desc="Generate evenly timed samples off the renderer thread with progress and cancellation.">
          <NumField label="rate (Hz)" value={resampleRateHz} onChange={setResampleRateHz} min={0.001} step={0.5} />
          <label className="num-field"><span>interpolation</span><select value={resampleMode} onChange={(event) => setResampleMode(event.target.value as InterpolationMode)}><option value="linear">linear</option><option value="step">step / hold</option></select></label>
          <label className="chk"><input type="checkbox" checked={limitResampleGaps} onChange={(event) => setLimitResampleGaps(event.target.checked)} /> skip large gaps</label>
          {limitResampleGaps && <NumField label="max gap (s)" value={resampleMaxGapSeconds} onChange={setResampleMaxGapSeconds} min={0.001} step={1} />}
          {resampleProgress ? <><span className="muted small">{resampleProgress}</span><button type="button" onClick={() => activeResampleRef.current?.cancel()}>Cancel</button></> : <button type="button" onClick={() => void runResample()}>Apply</button>}
        </Op>
        <Op title="Simplify (Douglas–Peucker)" desc="Shape-preserving reduction within an epsilon. Full dataset only."><NumField label="ε (m)" value={simplifyEps} onChange={setSimplifyEps} min={0.1} step={0.5} /><button type="button" onClick={() => run(() => simplify(points, simplifyEps), false)}>Apply</button></Op>
        <Op title="Smooth" desc="Moving-average filter to reduce GPS jitter. Supports selected-range scope."><NumField label="window" value={smoothWindow} onChange={setSmoothWindow} min={2} step={1} /><label className="chk"><input type="checkbox" checked={smoothCoords} onChange={(event) => setSmoothCoords(event.target.checked)} /> position</label><label className="chk"><input type="checkbox" checked={smoothEle} onChange={(event) => setSmoothEle(event.target.checked)} /> elevation</label><button type="button" onClick={() => runScoped((selected) => smooth(selected, smoothWindow, { coords: smoothCoords, elevation: smoothEle }))}>Apply{scoped ? ' to range' : ''}</button></Op>
        <Op title="Derive kinematics" desc="Compute distance, ground/vertical speed, heading, turn rate, acceleration, and sample timing. Full dataset only."><button type="button" onClick={() => runReplayable('standard-kinematics', {})}>Apply</button></Op>
        <Op title="Shift time" desc="Add a fixed offset to timestamps. Full dataset operation with replayable parameters."><NumField label="seconds" value={timeShift} onChange={setTimeShift} step={1} /><button type="button" onClick={() => runReplayable('shift-time', { seconds: timeShift })}>Apply</button></Op>
        <Op title="Offset elevation" desc="Datum correction. Full dataset operation with replayable parameters."><NumField label="meters" value={eleOffset} onChange={setEleOffset} step={1} /><button type="button" onClick={() => runReplayable('offset-elevation', { meters: eleOffset })}>Apply</button></Op>
        <Op title="Remove elevation outliers" desc="MAD-based spike rejection on elevation. Supports selected-range scope."><NumField label="σ threshold" value={outlierSigma} onChange={setOutlierSigma} min={1} step={0.5} /><button type="button" onClick={() => runScoped((selected) => removeElevationOutliers(selected, outlierSigma))}>Apply{scoped ? ' to range' : ''}</button></Op>
        <Op title="Median filter (elevation)" desc="Rolling median; robust to spikes without dropping points. Supports selected-range scope."><NumField label="window" value={medianWindow} onChange={setMedianWindow} min={3} step={2} /><button type="button" onClick={() => runScoped((selected) => medianFilterElevation(selected, medianWindow))}>Apply{scoped ? ' to range' : ''}</button></Op>
        <Op title="EMA filter (elevation)" desc="Causal exponential smoothing; alpha controls response to new samples. Supports selected-range scope."><NumField label="alpha" value={emaAlpha} onChange={setEmaAlpha} min={0.01} step={0.05} /><button type="button" onClick={() => runScoped((selected) => exponentialMovingAverageElevation(selected, emaAlpha))}>Apply{scoped ? ' to range' : ''}</button></Op>
        <Op title="Hampel filter (elevation)" desc="Replaces local outliers with the rolling median instead of removing points. Supports selected-range scope."><NumField label="window" value={hampelWindow} onChange={setHampelWindow} min={5} step={2} /><NumField label="σ threshold" value={hampelSigma} onChange={setHampelSigma} min={1} step={0.5} /><button type="button" onClick={() => runScoped((selected) => hampelFilterElevation(selected, hampelSigma, hampelWindow))}>Apply{scoped ? ' to range' : ''}</button></Op>
        <Op title="De-jitter timestamps" desc="Enforce strictly-increasing timestamps; resolves duplicate/backward-drift timestamps by nudge, drop, or average. Supports selected-range scope (nudge only — drop/average change point count).">
          <label className="num-field"><span>duplicate policy</span><select value={dejitterPolicy} onChange={(event) => setDejitterPolicy(event.target.value as DuplicateTimestampPolicy)}><option value="nudge">nudge (+ε)</option><option value="drop" disabled={scoped}>drop{scoped ? ' (full dataset only)' : ''}</option><option value="average" disabled={scoped}>average / merge{scoped ? ' (full dataset only)' : ''}</option></select></label>
          {scoped && <p className="muted small">drop/average change point count and cannot be scoped to a selection — full dataset only.</p>}
          <NumField label="ε (ms)" value={dejitterEpsilonMs} onChange={setDejitterEpsilonMs} min={0.001} step={1} />
          <button type="button" disabled={dejitterPolicyLocked} onClick={() => runScoped((selected) => dejitterTimestamps(selected, { duplicatePolicy: dejitterPolicy, epsilonMs: dejitterEpsilonMs }))}>Apply{scoped ? ' to range' : ''}</button>
        </Op>
        <Op title="Resample by distance (monotone cubic)" desc="Fixed-distance resampling using Fritsch-Carlson monotone cubic interpolation; unlike a naive spline it cannot overshoot past neighboring samples. Full dataset operation with replayable parameters.">
          <NumField label="interval (m)" value={distanceIntervalMeters} onChange={setDistanceIntervalMeters} min={0.001} step={1} />
          <button type="button" onClick={() => runReplayable('resample-distance-monotone-cubic', { intervalMeters: distanceIntervalMeters })}>Apply</button>
        </Op>
      </div>
    </div>
  )
}

function Op({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) { return <div className="op-card"><div className="op-head"><h4>{title}</h4><p className="op-desc">{desc}</p></div><div className="op-controls">{children}</div></div> }
function NumField({ label, value, onChange, min, step }: { label: string; value: number; onChange: (value: number) => void; min?: number; step?: number }) { return <label className="num-field"><span>{label}</span><input type="number" value={value} min={min} step={step} onChange={(event) => onChange(Number(event.target.value))} /></label> }
