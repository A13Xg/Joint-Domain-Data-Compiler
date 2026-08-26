import { ComputeTaskHost } from '../src/compute/host.ts'
import type { ComputeOutboundMessage } from '../src/compute/protocol.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const host = new ComputeTaskHost()
host.register({
  id: 'sum',
  version: 1,
  validatePayload(payload: unknown) {
    const values = (payload as { values?: unknown })?.values
    if (!Array.isArray(values) || !values.every((value) => typeof value === 'number')) {
      throw new Error('values must be a numeric array')
    }
    return { values: values as number[] }
  },
  run(payload, context) {
    context.reportProgress({ completed: 1, total: 1, message: 'summed' })
    return payload.values.reduce((sum, value) => sum + value, 0)
  },
})

host.register({
  id: 'wait',
  version: 1,
  validatePayload() {
    return {}
  },
  run(_payload, context) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1000)
      context.signal.addEventListener('abort', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
    })
  },
})

const messages: ComputeOutboundMessage[] = []
await host.handle({ type: 'request', requestId: 'sum-1', task: 'sum', taskVersion: 1, payload: { values: [1, 2, 3] } }, (message) => messages.push(message))
check('Progress is emitted', messages.some((message) => message.type === 'progress' && message.completed === 1))
check('Successful result is emitted', messages.some((message) => message.type === 'success' && message.result === 6))

const invalid: ComputeOutboundMessage[] = []
await host.handle({ type: 'request', requestId: 'bad-1', task: 'sum', taskVersion: 1, payload: { values: ['x'] } }, (message) => invalid.push(message))
check('Invalid payloads fail before execution', invalid[0]?.type === 'failure' && invalid[0].error.code === 'INVALID_PAYLOAD')

const versionMismatch: ComputeOutboundMessage[] = []
await host.handle({ type: 'request', requestId: 'version-1', task: 'sum', taskVersion: 2, payload: { values: [] } }, (message) => versionMismatch.push(message))
check('Task version mismatches are rejected', versionMismatch[0]?.type === 'failure' && versionMismatch[0].error.code === 'TASK_VERSION_MISMATCH')

const cancelled: ComputeOutboundMessage[] = []
const pending = host.handle({ type: 'request', requestId: 'wait-1', task: 'wait', taskVersion: 1, payload: {} }, (message) => cancelled.push(message))
await Promise.resolve()
await host.handle({ type: 'cancel', requestId: 'wait-1' }, (message) => cancelled.push(message))
await pending
check('Active tasks can be cancelled', cancelled.some((message) => message.type === 'cancelled'))
check('Cancelled tasks do not emit success', !cancelled.some((message) => message.type === 'success'))

let duplicateRejected = false
try {
  host.register({ id: 'sum', version: 1, validatePayload: () => ({}), run: () => null })
} catch {
  duplicateRejected = true
}
check('Duplicate task registration is rejected', duplicateRejected)

console.log(`\n${failures === 0 ? 'ALL COMPUTE CHECKS PASSED' : `${failures} COMPUTE CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
