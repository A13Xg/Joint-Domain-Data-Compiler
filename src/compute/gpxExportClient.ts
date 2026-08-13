// Browser client entry point for the `gpx-export` compute task, following the
// same pattern TransformPanel.tsx uses for fixed-rate resampling: spin up the
// shared compute Worker (src/compute/worker.ts) and drive it through
// ComputeClient's typed request/progress/success/failure/cancel protocol.
//
// This module intentionally has no UI wiring — it is a thin, reusable client
// surface a future export UI can call, mirroring TransformPanel's
// `runResample`/`computeClientRef` shape without duplicating it prematurely.

import type { TrackPoint } from '../core/model'
import type { GpxBuildResult, GpxExportOptions } from '../core/exporters/gpx'
import { ComputeClient, type ComputeRunHandle, type ComputeRunOptions } from './client'

export const GPX_EXPORT_TASK = 'gpx-export'
export const GPX_EXPORT_TASK_VERSION = 1

// Sync GPX export (buildGpx, src/core/exporters/gpx.ts) is a single uninterruptible
// pass over the dataset. Per performance baselines (.agents), it stays comfortably
// fast (185ms) at 100k points but grows into hundreds of ms to multiple seconds
// beyond that (783ms at 500k, ~1.6-1.7s+ at 1M), which is enough to visibly stall
// the renderer thread. Route anything above this threshold through the chunked
// Worker task instead; below it, the sync path avoids the fixed cost of spinning
// up a Worker for an export that already completes in well under 100ms.
export const GPX_EXPORT_WORKER_THRESHOLD = 50_000

/** Whether a GPX export of this many points should run on the compute Worker instead of synchronously on the main thread. */
export function shouldUseGpxExportWorker(pointCount: number, threshold: number = GPX_EXPORT_WORKER_THRESHOLD): boolean {
  return pointCount > threshold
}

export interface GpxExportRequestPayload {
  points: TrackPoint[]
  datasetName?: string
  options?: GpxExportOptions
}

/** Creates the shared compute Worker, same entry module TransformPanel uses for resampling. */
export function createGpxExportWorker(): Worker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
}

/** Runs the gpx-export task on an existing ComputeClient. Caller owns the client's lifecycle. */
export function runGpxExport(
  client: ComputeClient,
  payload: GpxExportRequestPayload,
  options: ComputeRunOptions = {},
): ComputeRunHandle<GpxBuildResult> {
  return client.run<GpxExportRequestPayload, GpxBuildResult>(
    GPX_EXPORT_TASK,
    GPX_EXPORT_TASK_VERSION,
    payload,
    options,
  )
}
