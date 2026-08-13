// Chunked, cancellable GPX export core.
//
// Benchmarked at ~4.2s / ~74% of total per-size cost at 1,000,000 points
// (see .agents for performance baseline), GPX export is the biggest measured
// hotspot in JDDC and scales roughly linearly with point count. This module is
// the pure, framework-free compute core for that hotspot: it produces
// byte-identical output to `buildGpx` (src/core/exporters/gpx.ts) but processes
// points in bounded batches, checking for cancellation and yielding control back
// to the event loop between batches, so a Worker host running this can honor
// progress/cancel requests instead of blocking for seconds at a stretch.
//
// This module has no dependency on the Worker protocol (src/compute/*) — it is
// wired into a task in src/compute/tasks.ts, following the existing pattern used
// by fixed-rate resampling.

import type { Dataset, TrackPoint } from '../model'
import {
  buildTrkpt,
  composeGpxDocument,
  normalizeGpxOptions,
  sortGpxPoints,
  type GpxBuildResult,
  type GpxExportOptions,
} from '../exporters/gpx'

export interface GpxExportChunkProgress {
  completed: number
  total: number
}

export interface GpxExportChunkContext {
  /** Aborting this signal stops work at the next chunk boundary (or sooner). */
  signal?: AbortSignal
  reportProgress?(progress: GpxExportChunkProgress): void
  /** Points processed per batch before checking cancellation and yielding. */
  chunkSize?: number
  /** Injectable for tests; defaults to a macrotask yield (setTimeout(0)). */
  yieldControl?: () => Promise<void>
}

export const DEFAULT_GPX_EXPORT_CHUNK_SIZE = 5_000

/**
 * Build a GPX document identically to `buildGpx`, but processing points in
 * bounded chunks with genuine async yields and cancellation checks between
 * chunks — instead of one uninterruptible synchronous pass.
 */
export async function buildGpxChunked(
  dataset: Dataset,
  options: GpxExportOptions = {},
  context: GpxExportChunkContext = {},
): Promise<GpxBuildResult> {
  const opts = normalizeGpxOptions(dataset, options)
  const points = sortGpxPoints(dataset.points, opts)
  const chunkSize = Number.isFinite(context.chunkSize) && (context.chunkSize as number) > 0
    ? Math.floor(context.chunkSize as number)
    : DEFAULT_GPX_EXPORT_CHUNK_SIZE
  const yieldControl = context.yieldControl ?? defaultYieldControl
  const total = points.length

  const body: string[] = []
  let skippedMissing = 0
  let skippedOutOfRange = 0
  let firstTime: number | undefined

  if (total === 0) {
    context.reportProgress?.({ completed: 0, total: 0 })
    return composeGpxDocument(opts, points, body, skippedMissing, skippedOutOfRange, firstTime)
  }

  for (let start = 0; start < total; start += chunkSize) {
    throwIfAborted(context.signal)

    const end = Math.min(start + chunkSize, total)
    for (let index = start; index < end; index++) {
      const point = points[index] as TrackPoint
      const result = buildTrkpt(point, opts)
      if (!result.xml) {
        if (result.reason === 'missing') skippedMissing++
        else skippedOutOfRange++
        continue
      }
      body.push(result.xml)
      if (firstTime === undefined && point.time !== undefined) firstTime = point.time
    }

    context.reportProgress?.({ completed: end, total })

    if (end < total) {
      // Genuine cooperative yield: hand control back to the event loop so a
      // pending cancel message (or anything else queued) can be processed
      // before we start the next chunk.
      await yieldControl()
      throwIfAborted(context.signal)
    }
  }

  return composeGpxDocument(opts, points, body, skippedMissing, skippedOutOfRange, firstTime)
}

function defaultYieldControl(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError()
}

function createAbortError(): Error {
  const error = new Error('GPX export cancelled')
  error.name = 'AbortError'
  return error
}
