import { ComputeClient, type WorkerLike } from '../src/compute/client.ts'
import type { ComputeOutboundMessage } from '../src/compute/protocol.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

class FakeWorker implements WorkerLike {
  sent: unknown[] = []
  listeners = new Set<(event: MessageEvent<ComputeOutboundMessage>) => void>()
  terminated = false
  postMessage(message: unknown): void { this.sent.push(message) }
  addEventListener(_type: 'message', listener: (event: MessageEvent<ComputeOutboundMessage>) => void): void { this.listeners.add(listener) }
  removeEventListener(_type: 'message', listener: (event: MessageEvent<ComputeOutboundMessage>) => void): void { this.listeners.delete(listener) }
  terminate(): void { this.terminated = true }
  emit(message: ComputeOutboundMessage): void {
    for (const listener of this.listeners) listener({ data: message } as MessageEvent<ComputeOutboundMessage>)
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

console.log(`\n${failures === 0 ? 'ALL COMPUTE CLIENT CHECKS PASSED' : `${failures} COMPUTE CLIENT CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
