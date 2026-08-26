import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dataset, TrackPoint } from '../core/model'
import type { DuplicateTimestampPolicy, UntimedPointPolicy } from '../core/transforms'
import type { ElevationFilterMode } from '../core/operations/filters'
import type { ReducePointsMode } from '../core/operations/reduce'
import type { OutlierChannel } from '../core/quality/outliers'
import { MOTION_PROFILES, MOTION_PROFILE_IDS, type MotionProfileId } from '../core/operations/motionProfiles'

import { fixedRateResampleOperation, type InterpolationMode, type ResampleParams } from '../core/operations/resample'
import { computeOperationPreview, describeOperationPreview } from '../core/recipes/preview'
import { computeTrackDiff, hasVisualizableChange } from '../core/repair/diff'
import { RepairPreviewDialog, type RepairPreviewRequest } from './RepairPreviewDialog'
import type { OperationRecord, OperationScope, Recipe } from '../core/recipes/model'
import { buildRecipe, executeOperation, recordExternalExecution, replayRecipe } from '../core/recipes/executor'
import { getOperation } from '../core/recipes/registry'
import { parseTimeToEpochMs, epochMsToIso } from '../core/format'
import { usePointSelection } from '../state/pointSelection'
import { useConfirm } from './confirmContext'
import { ComputeClient, type ComputeRunHandle } from '../compute/client'
import { logger } from '../core/logger'
import { errorMessage, isAbortError } from '../core/errors'

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
  onRestoreOriginal: () => void
  /** Surfaces an operation's outcome as a toast, since the log dock is collapsed by default. */
  onNotify: (message: string, tone: 'info' | 'success' | 'warn' | 'error', detail?: string) => void
  /**
   * Whether a repair is held at the graphical Accept/Revert gate. Owned by App
   * so it survives a tab switch — this panel unmounts whenever the user leaves
   * the tab, and a toggle that reset every time would be no use for the batch
   * work it exists for. Deliberately session state and not workspace state: a
   * saved project must not reopen with the safety gate quietly switched off.
   */
  previewRepairs: boolean
  onPreviewRepairsChange: (previewRepairs: boolean) => void
}

interface ResampleWorkerResult { dataset: Dataset; summary: string; warnings?: string[] }

/**
 * A repair that has been computed but not applied. Held here — never handed to
 * `onApply` — so every way of leaving the preview without pressing Accept ends
 * in the track being untouched.
 */
interface PendingRepair {
  /** The dataset the repair was computed against; accepting it onto any other would corrupt that track. */
  datasetId: string
  request: RepairPreviewRequest
  points: TrackPoint[]
  summary: string
  warnings: string[]
  preserveSelection: boolean
  record?: OperationRecord
}

/** Options for a single Apply. `scoped` opts an operation into the selected range. */
interface RunOptions { scoped?: boolean; preserveSelection?: boolean }

export function TransformPanel({ dataset, onApply, onUndo, onRedo, canUndo, canRedo, operationHistory, replaySource, namedRecipes, onSaveRecipe, onDeleteRecipe, onReplay, onRestoreOriginal, onNotify, previewRepairs, onPreviewRepairsChange }: Props) {
  const [reduceMode, setReduceMode] = useState<ReducePointsMode>('dedupe')
  const [dedupeTol, setDedupeTol] = useState(0)
  const [decimateFactor, setDecimateFactor] = useState(2)
  const [simplifyEps, setSimplifyEps] = useState(5)
  const [coordinateDecimals, setCoordinateDecimals] = useState(6)
  const [roundElevation, setRoundElevation] = useState(true)
  const [elevationDecimals, setElevationDecimals] = useState(2)
  const [roundChannels, setRoundChannels] = useState(false)
  const [channelDecimals, setChannelDecimals] = useState(3)
  const [smoothWindow, setSmoothWindow] = useState(5)
  const [smoothCoords, setSmoothCoords] = useState(false)
  const [smoothEle, setSmoothEle] = useState(true)
  const [timeShift, setTimeShift] = useState(0)
  const [eleOffset, setEleOffset] = useState(0)
  const [elevationFilterMode, setElevationFilterMode] = useState<ElevationFilterMode>('median')
  const [medianWindow, setMedianWindow] = useState(5)
  const [emaAlpha, setEmaAlpha] = useState(0.25)
  const [hampelWindow, setHampelWindow] = useState(11)
  const [hampelSigma, setHampelSigma] = useState(3)
  const [outlierChannels, setOutlierChannels] = useState<OutlierChannel[]>(['position', 'elevation', 'speed'])
  const [outlierWindow, setOutlierWindow] = useState(5)
  const [outlierSigma, setOutlierSigma] = useState(3)
  const [replayError, setReplayError] = useState<string | null>(null)
  const [recipeName, setRecipeName] = useState('')
  const [loadedRecipeId, setLoadedRecipeId] = useState<string | null>(null)
  const [resampleRateHz, setResampleRateHz] = useState(1)
  const [resampleMode, setResampleMode] = useState<InterpolationMode>('linear')
  const [resampleMaxGapSeconds, setResampleMaxGapSeconds] = useState(10)
  const [limitResampleGaps, setLimitResampleGaps] = useState(true)
  const [resampleProgress, setResampleProgress] = useState<string | null>(null)
  const [dejitterPolicy, setDejitterPolicy] = useState<DuplicateTimestampPolicy>('nudge')
  const [dejitterEpsilonMs, setDejitterEpsilonMs] = useState(1)
  const [distanceIntervalMeters, setDistanceIntervalMeters] = useState(10)
  const [gapThresholdSeconds, setGapThresholdSeconds] = useState(5)
  const [gapSampleSeconds, setGapSampleSeconds] = useState(1)
  const [gapContextPoints, setGapContextPoints] = useState(4)
  const [motionProfile, setMotionProfile] = useState<MotionProfileId>('unconstrained')
  const [clipStart, setClipStart] = useState('')
  const [clipEnd, setClipEnd] = useState('')
  const [untimedPolicy, setUntimedPolicy] = useState<UntimedPointPolicy>('keep')
  const [scopeToSelection, setScopeToSelection] = useState(false)
  const [pendingRepair, setPendingRepair] = useState<PendingRepair | null>(null)
  // A pending repair holds points computed from one dataset; accepting it onto
  // another would write that track's points over this one. Dropped during
  // render rather than in an effect — the same "adjust state during render"
  // pattern App uses for display sync — so the stale gate never gets a frame.
  if (pendingRepair && pendingRepair.datasetId !== dataset.id) setPendingRepair(null)
  const { indexRange, timeRange } = usePointSelection(dataset.points)
  const confirm = useConfirm()
  const computeClientRef = useRef<ComputeClient | null>(null)
  const activeResampleRef = useRef<ComputeRunHandle<ResampleWorkerResult> | null>(null)

  useEffect(() => () => computeClientRef.current?.dispose(), [])

  const timeBounds = useMemo(() => {
    let min: number | undefined
    let max: number | undefined
    for (const point of dataset.points) {
      if (point.time === undefined) continue
      if (min === undefined || point.time < min) min = point.time
      if (max === undefined || point.time > max) max = point.time
    }
    return min !== undefined && max !== undefined ? { min, max } : null
  }, [dataset.points])

  const originalPointCount = replaySource?.points.length ?? null
  const confirmRestoreOriginal = async () => {
    if (!replaySource) return
    const proceed = await confirm({
      title: 'Restore the original import',
      message: 'The track returns to exactly what was imported, and its operation history is cleared.',
      details: [
        `${operationHistory.length} operation(s) discarded`,
        `${dataset.points.length.toLocaleString()} points now → ${replaySource.points.length.toLocaleString()} points restored`,
        'Undoable: the current state goes onto the undo stack first',
      ],
      confirmLabel: 'Restore original',
    })
    if (proceed) onRestoreOriginal()
  }

  const replayHistory = () => {
    if (!replaySource || operationHistory.length === 0) return
    try {
      const recipe: Recipe = { schemaVersion: 1, id: 'current-history', name: 'Current operation history', createdAt: operationHistory[0]!.createdAt, sourceDatasetHash: operationHistory[0]!.inputDatasetHash, operations: operationHistory }
      const replayed = replayRecipe(replaySource, recipe)
      onReplay(replayed, `Replayed ${operationHistory.length} verified operation(s)`)
      setReplayError(null)
    } catch (error) { setReplayError(errorMessage(error)) }
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
    } catch (error) { setReplayError(errorMessage(error)) }
  }

  /**
   * The single Apply path for every card.
   *
   * Range scoping is passed to the operation as an `OperationScope` rather
   * than applied here, so the scope lands in the history record and replays
   * with the rest of the recipe. Applying it in the panel — as this component
   * used to — produced points nothing could reproduce.
   */
  const runReplayable = async (operationId: string, params: unknown, options: RunOptions = {}) => {
    try {
      const scope: OperationScope | undefined = options.scoped && indexRange ? { indexRange } : undefined
      const execution = executeOperation(dataset, operationId, params, scope)
      const label = getOperation(operationId)?.label ?? operationId
      const preserveSelection = options.preserveSelection ?? true

      if (gateRepair(label, execution.dataset.points, execution.record.summary, execution.record.warnings, preserveSelection, execution.record, scope !== undefined)) return

      const preview = computeOperationPreview(dataset, execution.dataset, { indexRange })
      if (preview.isDestructive) {
        const proceed = await confirm({
          title: label,
          message: `This changes ${describeOperationPreview(preview)}.`,
          details: [
            `${dataset.points.length.toLocaleString()} points → ${execution.dataset.points.length.toLocaleString()} points`,
            execution.record.summary,
            ...execution.record.warnings,
          ],
          confirmLabel: 'Apply',
        })
        if (!proceed) {
          logger.info('transform', `Declined: ${execution.record.summary}`)
          return
        }
      }
      commitRepair(execution.dataset.points, execution.record.summary, execution.record.warnings, preserveSelection, execution.record)
    } catch (error) {
      logger.error('transform', `Transform failed: ${errorMessage(error)}`)
      onNotify(`${getOperation(operationId)?.label ?? operationId} failed: ${errorMessage(error)}`, 'error')
    }
  }

  /**
   * Holds a computed repair at the graphical Accept/Revert gate, and reports
   * whether it did. Whether a repair *has* a graphical view is read off the
   * before/after diff rather than a list of operation ids: a derivation that
   * only writes computed channels has two identical paths to draw, so it goes
   * straight through instead of raising a preview that shows nothing.
   */
  const gateRepair = (
    label: string,
    points: TrackPoint[],
    summary: string,
    warnings: string[],
    preserveSelection: boolean,
    record: OperationRecord | undefined,
    scopedRun: boolean,
  ): boolean => {
    if (!previewRepairs) return false
    const diff = computeTrackDiff(dataset.points, points)
    if (!hasVisualizableChange(diff)) return false
    setPendingRepair({
      datasetId: dataset.id,
      points,
      summary,
      warnings,
      preserveSelection,
      record,
      request: {
        title: label,
        summary,
        warnings,
        before: dataset.points,
        after: points,
        diff,
        note: scopedRun && indexRange ? `Scoped to the selected range ${indexRange.start}–${indexRange.end}` : undefined,
      },
    })
    return true
  }

  // Logging lives here rather than at compute time: a repair that is previewed
  // and reverted never ran, and the log must not claim otherwise.
  const commitRepair = (points: TrackPoint[], summary: string, warnings: string[], preserveSelection: boolean, record?: OperationRecord) => {
    logger.info('transform', summary)
    for (const warning of warnings) logger.warn('transform', warning)
    // The applied-summary toast is raised by App.applyTransform, which is the
    // single place every apply path funnels through — including undo/redo and
    // replay. Raising one here as well produced two identical toasts.
    onApply(points, summary, preserveSelection, record)
  }

  const acceptPendingRepair = () => {
    const pending = pendingRepair
    setPendingRepair(null)
    if (!pending || pending.datasetId !== dataset.id) return
    commitRepair(pending.points, pending.summary, pending.warnings, pending.preserveSelection, pending.record)
  }

  const revertPendingRepair = () => {
    const pending = pendingRepair
    setPendingRepair(null)
    if (!pending) return
    logger.info('transform', `Reverted: ${pending.summary}`)
    onNotify(`Reverted ${pending.request.title} — the track is unchanged`, 'info')
  }

  const runResample = async () => {
    const rawParams = {
      rateHz: resampleRateHz,
      interpolation: resampleMode,
      maxGapMs: limitResampleGaps ? resampleMaxGapSeconds * 1000 : undefined,
    }
    try {
      const params: ResampleParams = fixedRateResampleOperation.validateParams(rawParams)
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
      // The worker ran the registered operation, so this run is replayable even
      // though executeOperation was not the caller.
      const record = recordExternalExecution(dataset, 'resample-fixed-rate', params, result.dataset.points, result.summary, result.warnings ?? [])
      // Resampling reaches this point by a different route than every other
      // card, and must not be the one repair that skips the gate.
      if (gateRepair(fixedRateResampleOperation.label, result.dataset.points, result.summary, result.warnings ?? [], false, record, false)) return
      commitRepair(result.dataset.points, result.summary, result.warnings ?? [], false, record)
    } catch (error) {
      if (isAbortError(error)) logger.warn('transform', 'Resampling cancelled')
      else logger.error('transform', `Resampling failed: ${errorMessage(error)}`)
    } finally {
      activeResampleRef.current = null
      setResampleProgress(null)
    }
  }

  const applyClip = () => {
    const startMs = resolveClipBound(clipStart, timeRange?.startMs ?? timeBounds?.min)
    const endMs = resolveClipBound(clipEnd, timeRange?.endMs ?? timeBounds?.max)
    if (startMs === null || endMs === null) {
      logger.error('transform', 'Clip to time window needs a start and end time; enter an ISO timestamp or epoch milliseconds.')
      return
    }
    void runReplayable('clip-time-range', { startMs, endMs, untimedPolicy }, { preserveSelection: false })
  }

  const toggleOutlierChannel = (channel: OutlierChannel, enabled: boolean) => {
    setOutlierChannels((current) => enabled ? [...current, channel].filter(unique) : current.filter((item) => item !== channel))
  }

  const points = dataset.points
  const scoped = scopeToSelection && indexRange !== null
  const suffix = scoped ? ' to range' : ''
  // 'drop'/'average' change point count, which a scoped run rejects outright —
  // block Apply (with a visible reason, not a silent log line) whenever
  // scoping to a selection makes the current policy unusable.
  const dejitterPolicyLocked = scoped && dejitterPolicy !== 'nudge'
  const clipWindowLabel = timeRange
    ? `selected window ${epochMsToIso(timeRange.startMs)} → ${epochMsToIso(timeRange.endMs)}`
    : timeBounds
      ? `full span ${epochMsToIso(timeBounds.min)} → ${epochMsToIso(timeBounds.max)}`
      : 'no timed points in this track'

  return (
    <div className="transform-panel">
      <div className="transform-history">
        <button type="button" disabled={!canUndo} onClick={onUndo}>↶ Undo</button>
        <button type="button" disabled={!canRedo} onClick={onRedo}>↷ Redo</button>
        <span className="muted small">{points.length.toLocaleString()} points</span>
        <label className="chk"><input type="checkbox" checked={scopeToSelection} disabled={!indexRange} onChange={(event) => setScopeToSelection(event.target.checked)} />selected range only{indexRange ? ` (${indexRange.start}–${indexRange.end})` : ''}</label>
        <label className="chk" title="Draw the original and the proposed repair on one frame, and apply nothing until you press Accept"><input type="checkbox" checked={previewRepairs} onChange={(event) => onPreviewRepairsChange(event.target.checked)} />preview repairs</label>
        <button type="button" className="danger" disabled={!originalPointCount} title={originalPointCount ? `Discard every operation and return to the ${originalPointCount.toLocaleString()}-point import` : 'No operations have been applied yet'} onClick={() => void confirmRestoreOriginal()}>Restore original</button>
      </div>
      {operationHistory.length > 0 && <details className="operation-history"><summary>Operation history ({operationHistory.length})</summary><p className="muted small">Only registered operations with matching versions can be replayed. Legacy history remains visible but is not represented as a reproducible recipe.</p><ul>{[...operationHistory].reverse().slice(0, 20).map((record) => {
        const registered = getOperation(record.operationId)
        const replayable = registered?.version === record.operationVersion
        return <li key={record.id} className="mono small"><span className="muted">{new Date(record.createdAt).toLocaleTimeString()}</span> {record.summary}{!replayable && <span className="warn"> — not replayable: {registered ? `requires v${registered.version}` : 'operation unavailable'}</span>}</li>
      })}</ul></details>}
      {operationHistory.length > 0 && <div className="analysis-toolbar"><button type="button" disabled={!replaySource} onClick={replayHistory}>Replay verified history</button>{!replaySource && <span className="muted small">No retained source snapshot is available for replay.</span>}{replayError && <span className="error-line">Replay blocked: {replayError}</span>}</div>}
      {operationHistory.length > 0 && <div className="recipe-capture analysis-toolbar"><label className="field"><span>Recipe name</span><input aria-label="Recipe name" value={recipeName} placeholder="e.g. clean and derive" onChange={(event) => setRecipeName(event.target.value)} /></label><button type="button" disabled={!replayableHistory || !replaySource || !recipeName.trim()} onClick={saveRecipe}>Save named recipe</button>{!replayableHistory && <span className="warn small">Cannot save: one or more history records are not replayable at the current operation version.</span>}{replayableHistory && !replaySource && <span className="warn small">Cannot save: no retained source snapshot is available.</span>}</div>}
      {namedRecipes.length > 0 && <details className="named-recipes" open><summary>Named recipes ({namedRecipes.length})</summary><ul>{namedRecipes.map((recipe) => <li key={recipe.id} className="analysis-toolbar"><span><strong>{recipe.name}</strong> <span className="muted small">{recipe.operations.length} operation(s)</span>{recipe.id === loadedRecipeId && <span className="muted small"> — loaded</span>}</span><span><button type="button" onClick={() => setLoadedRecipeId(recipe.id)}>Load</button><button type="button" disabled={!replaySource} onClick={() => replayNamedRecipe(recipe)}>Replay</button><button type="button" onClick={() => { void (async () => { if (await confirm({ title: 'Delete recipe', message: `“${recipe.name}” is removed from this project.`, details: [`${recipe.operations.length} operation(s)`, 'The track itself is unchanged'], confirmLabel: 'Delete' })) onDeleteRecipe(recipe.id) })() }}>Delete</button></span></li>)}</ul>{loadedRecipeId && <p className="muted small">Loaded recipe is ready to replay from the retained source snapshot.</p>}</details>}

      <OpGroup title="Validity & structure" desc="Put the track into a shape the rest of the toolset can rely on.">
        <Op title="Sort by time" desc="Order points chronologically. Untimed points sort to the end. Full dataset only."><button type="button" onClick={() => void runReplayable('sort-by-time', {}, { preserveSelection: false })}>Apply</button></Op>
        <Op title="Swap lat / lon" desc="Fix transposed coordinate columns. Supports selected-range scope."><button type="button" onClick={() => void runReplayable('swap-lat-lon', {}, { scoped })}>Apply{suffix}</button></Op>
        <Op title="Drop invalid" desc="Remove points outside valid lat/lon ranges. Full dataset only."><button type="button" onClick={() => void runReplayable('drop-invalid', {}, { preserveSelection: false })}>Apply</button></Op>
        <Op title="De-jitter timestamps" desc="Enforce strictly-increasing timestamps; resolves duplicate/backward-drift timestamps by nudge, drop, or average. Supports selected-range scope (nudge only — drop/average change point count).">
          <label className="num-field"><span>duplicate policy</span><select value={dejitterPolicy} onChange={(event) => setDejitterPolicy(event.target.value as DuplicateTimestampPolicy)}><option value="nudge">nudge (+ε)</option><option value="drop" disabled={scoped}>drop{scoped ? ' (full dataset only)' : ''}</option><option value="average" disabled={scoped}>average / merge{scoped ? ' (full dataset only)' : ''}</option></select></label>
          {scoped && <p className="muted small">drop/average change point count and cannot be scoped to a selection — full dataset only.</p>}
          <NumField label="ε (ms)" value={dejitterEpsilonMs} onChange={setDejitterEpsilonMs} min={0.001} step={1} />
          <button type="button" disabled={dejitterPolicyLocked} onClick={() => void runReplayable('dejitter-timestamps', { duplicatePolicy: dejitterPolicy, epsilonMs: dejitterEpsilonMs }, { scoped, preserveSelection: dejitterPolicy === 'nudge' })}>Apply{suffix}</button>
        </Op>
        <Op title="Clip to time window" desc="Keep only points inside an inclusive timestamp window. Defaults to the selected time range, or the full span when nothing is selected.">
          <p className="muted small">Using {clipWindowLabel}.</p>
          <TextField label="start (ISO or epoch ms)" value={clipStart} placeholder={timeBounds ? epochMsToIso(timeRange?.startMs ?? timeBounds.min) : ''} onChange={setClipStart} />
          <TextField label="end (ISO or epoch ms)" value={clipEnd} placeholder={timeBounds ? epochMsToIso(timeRange?.endMs ?? timeBounds.max) : ''} onChange={setClipEnd} />
          <label className="num-field"><span>untimed points</span><select value={untimedPolicy} onChange={(event) => setUntimedPolicy(event.target.value as UntimedPointPolicy)}><option value="keep">keep</option><option value="drop">drop</option></select></label>
          <button type="button" disabled={!timeBounds} onClick={applyClip}>Apply</button>
        </Op>
      </OpGroup>

      <OpGroup title="Outliers & smoothing" desc="Reject or attenuate samples that disagree with their neighbours.">
        <Op title="Drop outliers" desc="Remove points that break their local trend in position, elevation, or ground speed, scored by robust MAD z-score. Uses the same detector as the Track Health scan. Supports selected-range scope (detection always uses the full track, so a boundary cannot change a point's score).">
          <div className="op-inline">
            {(['position', 'elevation', 'speed'] as OutlierChannel[]).map((channel) => (
              <label className="chk" key={channel}><input type="checkbox" checked={outlierChannels.includes(channel)} onChange={(event) => toggleOutlierChannel(channel, event.target.checked)} /> {channel}</label>
            ))}
          </div>
          <NumField label="window" value={outlierWindow} onChange={setOutlierWindow} min={1} step={1} />
          <NumField label="σ threshold" value={outlierSigma} onChange={setOutlierSigma} min={0.1} step={0.5} />
          <button type="button" disabled={outlierChannels.length === 0} onClick={() => void runReplayable('drop-outliers', {
            channels: outlierChannels, windowSize: outlierWindow, scoreThreshold: outlierSigma,
            minPositionScaleMeters: 1, minElevationScaleMeters: 1, minSpeedScaleMps: 0.5,
          }, { scoped, preserveSelection: false })}>Apply{suffix}</button>
        </Op>
        <Op title="Elevation filter" desc="Filter the elevation channel without changing the point count. Median is phase-neutral and spike-proof; EMA is causal and lags; Hampel only rewrites points it judges anomalous. Supports selected-range scope.">
          <label className="num-field"><span>mode</span><select value={elevationFilterMode} onChange={(event) => setElevationFilterMode(event.target.value as ElevationFilterMode)}><option value="median">rolling median</option><option value="ema">EMA (causal)</option><option value="hampel">Hampel (replace outliers)</option></select></label>
          {elevationFilterMode === 'median' && <NumField label="window" value={medianWindow} onChange={setMedianWindow} min={3} step={2} />}
          {elevationFilterMode === 'ema' && <NumField label="alpha" value={emaAlpha} onChange={setEmaAlpha} min={0.01} step={0.05} />}
          {elevationFilterMode === 'hampel' && <><NumField label="window" value={hampelWindow} onChange={setHampelWindow} min={5} step={2} /><NumField label="σ threshold" value={hampelSigma} onChange={setHampelSigma} min={0.1} step={0.5} /></>}
          <button type="button" onClick={() => void runReplayable('elevation-filter', elevationFilterParams(elevationFilterMode, { medianWindow, emaAlpha, hampelWindow, hampelSigma }), { scoped })}>Apply{suffix}</button>
        </Op>
        <Op title="Smooth" desc="Moving-average filter to reduce sample-to-sample jitter. Position smoothing runs on ECEF vectors, so it is antimeridian- and pole-safe. Supports selected-range scope.">
          <NumField label="window" value={smoothWindow} onChange={setSmoothWindow} min={2} step={1} />
          <label className="chk"><input type="checkbox" checked={smoothCoords} onChange={(event) => setSmoothCoords(event.target.checked)} /> position</label>
          <label className="chk"><input type="checkbox" checked={smoothEle} onChange={(event) => setSmoothEle(event.target.checked)} /> elevation</label>
          <button type="button" disabled={!smoothCoords && !smoothEle} onClick={() => void runReplayable('smooth', { window: smoothWindow, coords: smoothCoords, elevation: smoothEle }, { scoped })}>Apply{suffix}</button>
        </Op>
      </OpGroup>

      <OpGroup title="Density & precision" desc="Thin an over-sampled track, or stop storing more digits than the source can justify.">
        <Op title="Reduce points" desc="Thin a dense track. Dedupe collapses coincident points, decimate keeps every Nth (always keeping the last), simplify is Douglas–Peucker shape-preserving. Full dataset only.">
          <label className="num-field"><span>mode</span><select value={reduceMode} onChange={(event) => setReduceMode(event.target.value as ReducePointsMode)}><option value="dedupe">dedupe (coincident)</option><option value="decimate">decimate (every Nth)</option><option value="simplify">simplify (Douglas–Peucker)</option></select></label>
          {reduceMode === 'dedupe' && <NumField label="tolerance (m)" value={dedupeTol} onChange={setDedupeTol} min={0} step={1} />}
          {reduceMode === 'decimate' && <NumField label="factor" value={decimateFactor} onChange={setDecimateFactor} min={2} step={1} />}
          {reduceMode === 'simplify' && <NumField label="ε (m)" value={simplifyEps} onChange={setSimplifyEps} min={0.1} step={0.5} />}
          <button type="button" onClick={() => void runReplayable('reduce-points', reducePointsParams(reduceMode, { dedupeTol, decimateFactor, simplifyEps }), { preserveSelection: false })}>Apply</button>
        </Op>
        <Op title="Round precision" desc="Reduce stored decimal places. Rounds through the same formatter the exporters use, so what you see is what a file at this precision round-trips to. Supports selected-range scope.">
          <NumField label="coordinate decimals" value={coordinateDecimals} onChange={setCoordinateDecimals} min={0} step={1} />
          <label className="chk"><input type="checkbox" checked={roundElevation} onChange={(event) => setRoundElevation(event.target.checked)} /> elevation</label>
          {roundElevation && <NumField label="elevation decimals" value={elevationDecimals} onChange={setElevationDecimals} min={0} step={1} />}
          <label className="chk"><input type="checkbox" checked={roundChannels} onChange={(event) => setRoundChannels(event.target.checked)} /> numeric channels</label>
          {roundChannels && <NumField label="channel decimals" value={channelDecimals} onChange={setChannelDecimals} min={0} step={1} />}
          <button type="button" onClick={() => void runReplayable('round-precision', {
            coordinateDecimals,
            elevationDecimals: roundElevation ? elevationDecimals : undefined,
            channelDecimals: roundChannels ? channelDecimals : undefined,
          }, { scoped })}>Apply{suffix}</button>
        </Op>
      </OpGroup>

      <OpGroup title="Resampling & gaps" desc="Re-grid the track onto an even time or distance axis, or bridge a dropout.">
        <Op title="Resample to fixed rate" desc="Generate evenly timed samples off the renderer thread with progress and cancellation. Full dataset only.">
          <NumField label="rate (Hz)" value={resampleRateHz} onChange={setResampleRateHz} min={0.001} step={0.5} />
          <label className="num-field"><span>interpolation</span><select value={resampleMode} onChange={(event) => setResampleMode(event.target.value as InterpolationMode)}><option value="linear">linear</option><option value="step">step / hold</option></select></label>
          <label className="chk"><input type="checkbox" checked={limitResampleGaps} onChange={(event) => setLimitResampleGaps(event.target.checked)} /> skip large gaps</label>
          {limitResampleGaps && <NumField label="max gap (s)" value={resampleMaxGapSeconds} onChange={setResampleMaxGapSeconds} min={0.001} step={1} />}
          {resampleProgress ? <><span className="muted small">{resampleProgress}</span><button type="button" onClick={() => activeResampleRef.current?.cancel()}>Cancel</button></> : <button type="button" onClick={() => void runResample()}>Apply</button>}
        </Op>
        <Op title="Resample by distance (monotone cubic)" desc="Fixed-distance resampling using Fritsch–Carlson monotone cubic interpolation; unlike a naive spline it cannot overshoot past neighbouring samples. Full dataset only.">
          <NumField label="interval (m)" value={distanceIntervalMeters} onChange={setDistanceIntervalMeters} min={0.001} step={1} />
          <button type="button" onClick={() => void runReplayable('resample-distance-monotone-cubic', { intervalMeters: distanceIntervalMeters }, { preserveSelection: false })}>Apply</button>
        </Op>
        <Op title="Fill gaps" desc="Bridge dropouts with monotone cubic interpolation fitted through the real points either side, so the fill matches the trajectory going in and coming out without overshooting it. A gap whose fill would imply motion outside the profile is skipped and reported rather than invented. Inserted points are flagged 'interpolated'. Full dataset only; requires strictly increasing timestamps.">
          <NumField label="gap threshold (s)" value={gapThresholdSeconds} onChange={setGapThresholdSeconds} min={0.001} step={1} />
          <NumField label="sample interval (s)" value={gapSampleSeconds} onChange={setGapSampleSeconds} min={0.001} step={0.5} />
          <NumField label="context points" value={gapContextPoints} onChange={setGapContextPoints} min={2} step={1} />
          <label className="num-field"><span>motion profile</span><select value={motionProfile} onChange={(event) => setMotionProfile(event.target.value as MotionProfileId)}>{MOTION_PROFILE_IDS.map((id) => <option key={id} value={id}>{MOTION_PROFILES[id].label}</option>)}</select></label>
          <p className="muted small">{MOTION_PROFILES[motionProfile].description}</p>
          <button type="button" disabled={gapSampleSeconds > gapThresholdSeconds} title={gapSampleSeconds > gapThresholdSeconds ? 'A sample interval longer than the gap threshold would detect gaps but produce no samples' : undefined} onClick={() => void runReplayable('fill-gaps', {
            gapThresholdMs: gapThresholdSeconds * 1000,
            sampleIntervalMs: gapSampleSeconds * 1000,
            contextPoints: gapContextPoints,
            profile: motionProfile,
          }, { preserveSelection: false })}>Apply</button>
        </Op>
      </OpGroup>

      <OpGroup title="Derive" desc="Add computed channels or correct a systematic offset.">
        <Op title="Derive kinematics" desc="Compute distance, ground/vertical speed, heading, turn rate, acceleration, and sample timing. Full dataset only."><button type="button" onClick={() => void runReplayable('standard-kinematics', {})}>Apply</button></Op>
        <Op title="Shift time" desc="Add a fixed offset to timestamps."><NumField label="seconds" value={timeShift} onChange={setTimeShift} step={1} /><button type="button" onClick={() => void runReplayable('shift-time', { seconds: timeShift })}>Apply</button></Op>
        <Op title="Offset elevation" desc="Datum correction."><NumField label="meters" value={eleOffset} onChange={setEleOffset} step={1} /><button type="button" onClick={() => void runReplayable('offset-elevation', { meters: eleOffset })}>Apply</button></Op>
      </OpGroup>

      {pendingRepair && <RepairPreviewDialog request={pendingRepair.request} onAccept={acceptPendingRepair} onRevert={revertPendingRepair} />}
    </div>
  )
}

function elevationFilterParams(mode: ElevationFilterMode, values: { medianWindow: number; emaAlpha: number; hampelWindow: number; hampelSigma: number }): unknown {
  if (mode === 'median') return { mode, window: values.medianWindow }
  if (mode === 'ema') return { mode, alpha: values.emaAlpha }
  return { mode, window: values.hampelWindow, sigmaThreshold: values.hampelSigma }
}

function reducePointsParams(mode: ReducePointsMode, values: { dedupeTol: number; decimateFactor: number; simplifyEps: number }): unknown {
  if (mode === 'dedupe') return { mode, toleranceMeters: values.dedupeTol }
  if (mode === 'decimate') return { mode, factor: values.decimateFactor }
  return { mode, epsilonMeters: values.simplifyEps }
}

/** Blank falls back to the selected/whole-track bound; anything typed must parse. */
function resolveClipBound(raw: string, fallback: number | undefined): number | null {
  if (!raw.trim()) return fallback ?? null
  return parseTimeToEpochMs(raw, 'auto')
}

function unique<T>(value: T, index: number, all: T[]): boolean { return all.indexOf(value) === index }

function OpGroup({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) { return <section className="op-group"><header className="op-group-head"><h3>{title}</h3><p className="muted small">{desc}</p></header><div className="transform-grid">{children}</div></section> }
function Op({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) { return <div className="op-card"><div className="op-head"><h4>{title}</h4><p className="op-desc">{desc}</p></div><div className="op-controls">{children}</div></div> }
function NumField({ label, value, onChange, min, step }: { label: string; value: number; onChange: (value: number) => void; min?: number; step?: number }) { return <label className="num-field"><span>{label}</span><input type="number" value={value} min={min} step={step} onChange={(event) => onChange(Number(event.target.value))} /></label> }
function TextField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (value: string) => void }) { return <label className="num-field"><span>{label}</span><input type="text" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label> }
