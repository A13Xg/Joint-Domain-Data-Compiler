// Round-trip test through the real Worker protocol layer (ComputeTaskHost +
// gpxExportTask), the same style used by test/computeWorker.ts for the
// production task list. Proves: progress messages arrive at expected chunk
// checkpoints, and cancellation actually stops work partway through instead of
// letting the synchronous build run to completion.

import { ComputeTaskHost } from '../src/compute/host.ts'
import { gpxExportTask } from '../src/compute/tasks.ts'
import type { ComputeOutboundMessage } from '../src/compute/protocol.ts'
import type { TrackPoint } from '../src/core/model.ts'

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

console.log(`\n${failures === 0 ? 'ALL GPX EXPORT WORKER CHECKS PASSED' : `${failures} GPX EXPORT WORKER CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
