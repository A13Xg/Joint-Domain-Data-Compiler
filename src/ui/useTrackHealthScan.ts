import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dataset } from '../core/model'
import type { TrackHealthReport } from '../core/quality/trackHealthTypes'
import type { TrackHealthScanPayload } from '../compute/tasks'
import { ComputeClient, type ComputeRunHandle } from '../compute/client'
import { errorMessage, isAbortError } from '../core/errors'

export type TrackHealthScanStatus = 'idle' | 'scanning' | 'ready' | 'error'

export interface TrackHealthScanProgress {
  completed: number
  total?: number
  message?: string
}

export interface TrackHealthScanState {
  status: TrackHealthScanStatus
  report: TrackHealthReport | null
  error: string | null
  progress: TrackHealthScanProgress | null
  rescan: () => void
}

/**
 * Runs the health scan for a dataset on the shared compute worker.
 *
 * Re-scans whenever the `Dataset` reference changes — which in this app covers both switching
 * datasets and applying a transform — and exposes `rescan` for an explicit re-run. A superseded
 * scan is cancelled so the worker stops doing work nobody is waiting for, and a monotonic run id
 * guards against a late result from an earlier scan overwriting a newer one.
 */
export function useTrackHealthScan(dataset: Dataset | null): TrackHealthScanState {
  const [status, setStatus] = useState<TrackHealthScanStatus>('idle')
  const [report, setReport] = useState<TrackHealthReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<TrackHealthScanProgress | null>(null)

  const clientRef = useRef<ComputeClient | null>(null)
  const activeHandleRef = useRef<ComputeRunHandle<TrackHealthReport> | null>(null)
  const runIdRef = useRef(0)

  useEffect(() => () => {
    activeHandleRef.current?.cancel()
    clientRef.current?.dispose()
  }, [])

  const runScan = useCallback(async () => {
    if (!dataset) {
      setStatus('idle')
      setReport(null)
      setError(null)
      setProgress(null)
      return
    }

    activeHandleRef.current?.cancel()
    const runId = ++runIdRef.current
    const isCurrent = () => runId === runIdRef.current

    setStatus('scanning')
    setError(null)
    setProgress(null)

    try {
      if (!clientRef.current) {
        const worker = new Worker(new URL('../compute/worker.ts', import.meta.url), { type: 'module' })
        clientRef.current = new ComputeClient(worker)
      }

      const payload: TrackHealthScanPayload = {
        points: dataset.points,
        sourceFormat: dataset.sourceFormat,
        warnings: dataset.warnings,
        datasetId: dataset.id,
      }

      const handle = clientRef.current.run<TrackHealthScanPayload, TrackHealthReport>('track-health-scan', 1, payload, {
        onProgress: (update) => {
          if (isCurrent()) setProgress({ completed: update.completed, total: update.total, message: update.message })
        },
      })
      activeHandleRef.current = handle

      const result = await handle.promise
      if (!isCurrent()) return
      setReport(result)
      setStatus('ready')
      setProgress(null)
    } catch (caught) {
      // A cancelled scan was superseded by a newer one; that is not a user-facing failure.
      if (!isCurrent() || isAbortError(caught)) return
      setError(errorMessage(caught))
      setStatus('error')
      setProgress(null)
    } finally {
      if (isCurrent()) activeHandleRef.current = null
    }
  }, [dataset])

  // Deferring the kick-off through a timer rather than calling it synchronously in the effect
  // body is the pattern this codebase already uses for effect-driven state changes, and it lets
  // a rapid burst of dataset edits collapse into a single scan.
  useEffect(() => {
    const id = setTimeout(() => { void runScan() }, 0)
    return () => clearTimeout(id)
  }, [runScan])

  return { status, report, error, progress, rescan: () => { void runScan() } }
}
