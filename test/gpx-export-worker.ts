// Round-trip test through the real Worker protocol layer (ComputeTaskHost +
// gpxExportTask), the same style used by test/computeWorker.ts for the
// production task list. Proves: progress messages arrive at expected chunk
// checkpoints, and cancellation actually stops work partway through instead of
// letting the synchronous build run to completion.

import { ComputeTaskHost } from '../src/compute/host.ts'
import { gpxExportTask } from '../src/compute/tasks.ts'
import type { ComputeOutboundMessage } from '../src/compute/protocol.ts'
import type { TrackPoint } from '../src/core/model.ts'
import { ComputeClient, type WorkerLike } from '../src/compute/client.ts'
import {
  GPX_EXPORT_TASK,
  GPX_EXPORT_TASK_VERSION,
  GPX_EXPORT_WORKER_THRESHOLD,
  runGpxExport,
  shouldUseGpxExportWorker,
} from '../src/compute/gpxExportClient.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

function makePoints(count: number): TrackPoint[] {
  const points: TrackPoint[] = []
  for (let i = 0; i < count; i++) {
    points.push({ lat: 45 + i * 0.0001, lon: -122 + i * 0.0001, ele: 100, time: i * 1000 })
  }
  return points
}

const host = new ComputeTaskHost()
host.register(gpxExportTask)

// --- Happy path: success carries the built GPX xml, with progress along the way ---
{
  const messages: ComputeOutboundMessage[] = []
  await host.handle(
    { type: 'request', requestId: 'gpx-1', task: 'gpx-export', taskVersion: 1, payload: { points: makePoints(1200) } },
    (message) => messages.push(message),
  )
  const success = messages.find((m) => m.type === 'success')
  const progressMessages = messages.filter((m) => m.type === 'progress')
  check('Emits progress messages', progressMessages.length > 0)
  check('Emits a success message', success?.type === 'success')
  if (success?.type === 'success') {
    const result = success.result as { xml: string; pointCount: number }
    check('Success result contains built GPX xml', typeof result.xml === 'string' && result.xml.includes('<gpx'))
    check('Success result reports full point count', result.pointCount === 1200)
  }
}

// --- Invalid payload / version mismatch follow the same contract as other tasks ---
{
  const invalid: ComputeOutboundMessage[] = []
  await host.handle(
    { type: 'request', requestId: 'gpx-bad', task: 'gpx-export', taskVersion: 1, payload: { points: [{ lat: 'x' }] } },
    (message) => invalid.push(message),
  )
  check('Invalid payload fails before execution', invalid[0]?.type === 'failure' && invalid[0].error.code === 'INVALID_PAYLOAD')

  const versionMismatch: ComputeOutboundMessage[] = []
  await host.handle(
    { type: 'request', requestId: 'gpx-v', task: 'gpx-export', taskVersion: 2, payload: { points: [] } },
    (message) => versionMismatch.push(message),
  )
  check('Version mismatch is rejected', versionMismatch[0]?.type === 'failure' && versionMismatch[0].error.code === 'TASK_VERSION_MISMATCH')
}

// --- Cancellation genuinely interrupts a large, chunked export mid-flight ---
{
  const messages: ComputeOutboundMessage[] = []
  const pointCount = 50_000
  const pending = host.handle(
    { type: 'request', requestId: 'gpx-cancel', task: 'gpx-export', taskVersion: 1, payload: { points: makePoints(pointCount) } },
    (message) => {
      messages.push(message)
      // Cancel as soon as the first progress checkpoint arrives — proves the
      // worker yields control early enough for a cancel to land before the
      // whole (multi-chunk) export finishes.
      if (message.type === 'progress' && messages.filter((m) => m.type === 'progress').length === 1) {
        void host.handle({ type: 'cancel', requestId: 'gpx-cancel' }, (cancelMessage) => messages.push(cancelMessage))
      }
    },
  )
  await pending

  const progressMessages = messages.filter((m) => m.type === 'progress')
  check('At least one progress checkpoint arrived before cancellation', progressMessages.length >= 1)
  check('Cancellation is acknowledged', messages.some((m) => m.type === 'cancelled'))
  check('No success message is emitted once cancelled', !messages.some((m) => m.type === 'success'))
  const lastProgressCompleted = progressMessages.at(-1) as { completed: number } | undefined
  check(
    'Work stopped before processing all points (genuine mid-flight cancellation, not run-to-completion)',
    (lastProgressCompleted?.completed ?? pointCount) < pointCount,
  )
}

// --- Export flow wiring: ExportPanel's size-gating decision and its use of
// gpxExportClient.runGpxExport to drive an existing ComputeClient. This is
// the seam ExportPanel.tsx itself calls; the React component isn't rendered
// here (no DOM/component test harness in this codebase — see
// scripts/run-tests.mjs), so the pure decision function and the client-level
// wiring it feeds into are exercised directly instead. ---
{
  check('At/under the threshold stays on the sync path', !shouldUseGpxExportWorker(GPX_EXPORT_WORKER_THRESHOLD))
  check('Above the threshold routes to the worker', shouldUseGpxExportWorker(GPX_EXPORT_WORKER_THRESHOLD + 1))
  check('A custom threshold overrides the default', shouldUseGpxExportWorker(10, 5))
  check('A custom threshold can keep the sync path', !shouldUseGpxExportWorker(10, 20))
}

class FakeWorker implements WorkerLike {
  sent: unknown[] = []
  listeners = new Set<(event: MessageEvent<ComputeOutboundMessage>) => void>()
  postMessage(message: unknown): void { this.sent.push(message) }
  addEventListener(_type: 'message', listener: (event: MessageEvent<ComputeOutboundMessage>) => void): void { this.listeners.add(listener) }
  removeEventListener(_type: 'message', listener: (event: MessageEvent<ComputeOutboundMessage>) => void): void { this.listeners.delete(listener) }
  terminate(): void { /* no-op */ }
  emit(message: ComputeOutboundMessage): void {
    for (const listener of this.listeners) listener({ data: message } as MessageEvent<ComputeOutboundMessage>)
  }
}

{
  const worker = new FakeWorker()
  const client = new ComputeClient(worker)
  const progressEvents: number[] = []
  const handle = runGpxExport(
    client,
    { points: makePoints(3), datasetName: 'wired-dataset' },
    { onProgress: (progress) => progressEvents.push(progress.completed) },
  )
  const posted = worker.sent[0] as { task?: string; taskVersion?: number; payload?: { points: TrackPoint[]; datasetName?: string } }
  check('runGpxExport posts the gpx-export task id', posted.task === GPX_EXPORT_TASK)
  check('runGpxExport posts the current task version', posted.taskVersion === GPX_EXPORT_TASK_VERSION)
  check('runGpxExport forwards dataset name and points through the payload', posted.payload?.datasetName === 'wired-dataset' && posted.payload?.points.length === 3)

  worker.emit({ type: 'progress', requestId: handle.requestId, completed: 3, total: 3 })
  worker.emit({ type: 'success', requestId: handle.requestId, result: { xml: '<gpx/>', pointCount: 3, skippedMissing: 0, skippedOutOfRange: 0 } })
  const result = await handle.promise
  check('runGpxExport forwards worker progress', progressEvents.includes(3))
  check('runGpxExport resolves with the worker-built GPX result', result.xml === '<gpx/>' && result.pointCount === 3)

  // Cancellation reaches the worker the same way TransformPanel's resample cancel button does.
  const cancelHandle = runGpxExport(client, { points: makePoints(2) })
  cancelHandle.cancel()
  let cancelled = false
  try { await cancelHandle.promise } catch (error) { cancelled = (error as Error).name === 'AbortError' }
  check('Cancelling the handle posts a cancel message and rejects with AbortError', cancelled && (worker.sent.at(-1) as { type?: string }).type === 'cancel')
}

console.log(`\n${failures === 0 ? 'ALL GPX EXPORT WORKER CHECKS PASSED' : `${failures} GPX EXPORT WORKER CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
