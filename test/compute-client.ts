import { ComputeClient, type WorkerEventType, type WorkerLike } from '../src/compute/client.ts'
import type { ComputeOutboundMessage } from '../src/compute/protocol.ts'
import { errorMessage } from '../src/core/errors.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

class FakeWorker implements WorkerLike {
  sent: unknown[] = []
  listeners = new Map<WorkerEventType, Set<(event: MessageEvent<ComputeOutboundMessage>) => void>>()
  terminated = false
  postMessage(message: unknown): void { this.sent.push(message) }
  addEventListener(type: WorkerEventType, listener: (event: MessageEvent<ComputeOutboundMessage>) => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }
  removeEventListener(type: WorkerEventType, listener: (event: MessageEvent<ComputeOutboundMessage>) => void): void {
    this.listeners.get(type)?.delete(listener)
  }
  terminate(): void { this.terminated = true }
  emit(message: ComputeOutboundMessage): void {
    this.dispatch('message', { data: message } as MessageEvent<ComputeOutboundMessage>)
  }
  dispatch(type: WorkerEventType, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as MessageEvent<ComputeOutboundMessage>)
  }
}

const worker = new FakeWorker()
const client = new ComputeClient(worker)
let progress = 0
const run = client.run<{ value: number }, number>('double', 1, { value: 4 }, {
  onProgress: (event) => { progress = event.completed },
})
check('Posts typed request', (worker.sent[0] as { type?: string }).type === 'request')
worker.emit({ type: 'progress', requestId: run.requestId, completed: 1, total: 2 })
worker.emit({ type: 'success', requestId: run.requestId, result: 8 })
check('Forwards progress events', progress === 1)
check('Resolves success results', await run.promise === 8)
check('Removes completed requests', client.activeRequestCount === 0)

const cancelled = client.run('slow', 1, {})
cancelled.cancel()
let cancelledRejected = false
try { await cancelled.promise } catch (error) { cancelledRejected = (error as Error).name === 'AbortError' }
check('Cancel posts cancellation message', (worker.sent.at(-1) as { type?: string }).type === 'cancel')
check('Cancel rejects with AbortError', cancelledRejected)

const failed = client.run('fail', 1, {})
worker.emit({ type: 'failure', requestId: failed.requestId, error: { code: 'TASK_FAILED', message: 'boom', retryable: false } })
let failedRejected = false
try { await failed.promise } catch (error) { failedRejected = (error as Error).name === 'TASK_FAILED' }
check('Typed worker failures reject request', failedRejected)

const pending = client.run('pending', 1, {})
client.dispose()
let disposeRejected = false
try { await pending.promise } catch { disposeRejected = true }
check('Dispose rejects active requests', disposeRejected)
check('Dispose terminates worker', worker.terminated)

let disposedRejected = false
try { client.run('after-dispose', 1, {}) } catch { disposedRejected = true }
check('Disposed clients reject new work', disposedRejected)

// A worker that dies never sends a protocol message, so these paths are the
// only thing standing between a failed worker and a promise that never settles.
{
  const dead = new FakeWorker()
  const deadClient = new ComputeClient(dead)
  const stranded = deadClient.run('never-answers', 1, {})
  dead.dispatch('error', { message: 'Failed to fetch worker script' })
  let rejected = ''
  try { await stranded.promise } catch (error) { rejected = errorMessage(error) }
  check('Worker load failure rejects in-flight requests', rejected.includes('Failed to fetch worker script'))
  check('Worker load failure clears the pending map', deadClient.activeRequestCount === 0)
}

{
  const garbled = new FakeWorker()
  const garbledClient = new ComputeClient(garbled)
  const stranded = garbledClient.run('undeserializable', 1, {})
  garbled.dispatch('messageerror', {})
  let rejected = false
  try { await stranded.promise } catch { rejected = true }
  check('messageerror rejects in-flight requests', rejected)
}

{
  const noisy = new FakeWorker()
  const noisyClient = new ComputeClient(noisy)
  const request = noisyClient.run('malformed-reply', 1, {})
  // A malformed frame must be ignored, not throw inside the listener and
  // strand every other request sharing this worker.
  noisy.dispatch('message', { data: null })
  noisy.dispatch('message', { data: { type: 'failure', requestId: request.requestId } })
  let message = ''
  try { await request.promise } catch (error) { message = errorMessage(error) }
  check('Failure frames with no error detail still reject with a readable message', message.includes('without a reported reason'))
}

{
  const broken = new FakeWorker()
  broken.postMessage = () => { throw new Error('worker channel closed') }
  const brokenClient = new ComputeClient(broken)
  const request = brokenClient.run('unsendable', 1, {})
  let rejected = ''
  try { await request.promise } catch (error) { rejected = errorMessage(error) }
  check('postMessage failure rejects rather than hanging', rejected === 'worker channel closed')
}

console.log(`\n${failures === 0 ? 'ALL COMPUTE CLIENT CHECKS PASSED' : `${failures} COMPUTE CLIENT CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
