// Tranche 6 Task 6.4 step 3 (UI). Lets a user preview and create a
// non-destructive notional gap-fill derived track. Unlike TransformPanel's
// operations, this never mutates the active dataset — it always produces a
// new, separately-named dataset, so it lives in its own panel rather than
// among the in-place transforms.
import { useMemo, useState } from 'react'
import type { Dataset } from '../core/model'
import { deriveNotionalSmoothedDataset } from '../core/derivations/notionalSmoothing'
import { logger } from '../core/logger'
import { errorMessage } from '../core/errors'

interface Props {
  dataset: Dataset
  onCreateDataset: (dataset: Dataset) => void
}

export function NotionalSmoothingPanel({ dataset, onCreateDataset }: Props) {
  const [gapThresholdMs, setGapThresholdMs] = useState(3000)
  const [useCustomInterval, setUseCustomInterval] = useState(false)
  const [sampleIntervalMs, setSampleIntervalMs] = useState(1000)

  const preview = useMemo(() => {
    try {
      const options = useCustomInterval ? { gapThresholdMs, sampleIntervalMs } : { gapThresholdMs }
      const { result } = deriveNotionalSmoothedDataset(dataset, options)
      return { gaps: result.gaps.length, inserted: result.insertedCount, error: null as string | null }
    } catch (error) {
      return { gaps: 0, inserted: 0, error: errorMessage(error) }
    }
  }, [dataset, gapThresholdMs, useCustomInterval, sampleIntervalMs])

  const create = () => {
    try {
      const options = useCustomInterval ? { gapThresholdMs, sampleIntervalMs } : { gapThresholdMs }
      const { dataset: derived, result } = deriveNotionalSmoothedDataset(dataset, options)
      logger.success('derive', `Created ${derived.name} with ${result.insertedCount} notional point(s) across ${result.gaps.length} gap(s)`)
      onCreateDataset(derived)
    } catch (error) {
      logger.error('derive', `Notional smoothing failed: ${errorMessage(error)}`)
    }
  }

  return (
    <div className="op-card notional-smoothing-panel">
      <div className="op-head">
        <h4>Notional gap-fill (new track)</h4>
        <p className="op-desc">
          Creates a separate, clearly-labeled derived track with gaps above the threshold filled by
          linear interpolation. The source dataset is never changed; inserted points are permanently
          flagged notional and blocked from export without acknowledgment.
        </p>
      </div>
      <div className="op-controls">
        <label className="num-field"><span>gap threshold (ms)</span><input type="number" min={1} value={gapThresholdMs} onChange={(e) => setGapThresholdMs(Math.max(1, Number(e.target.value) || 1))} /></label>
        <label className="chk"><input type="checkbox" checked={useCustomInterval} onChange={(e) => setUseCustomInterval(e.target.checked)} /> override sample interval</label>
        {useCustomInterval && <label className="num-field"><span>sample interval (ms)</span><input type="number" min={1} value={sampleIntervalMs} onChange={(e) => setSampleIntervalMs(Math.max(1, Number(e.target.value) || 1))} /></label>}
        {preview.error
          ? <p className="warn-line small">⚠ {preview.error}</p>
          : <p className="muted small">{preview.gaps === 0 ? 'No gaps above the threshold — nothing to fill.' : `${preview.gaps} gap(s) found; would insert ${preview.inserted.toLocaleString()} notional point(s).`}</p>}
        <button type="button" disabled={preview.error !== null || preview.gaps === 0} onClick={create}>Create derived track</button>
      </div>
    </div>
  )
}
