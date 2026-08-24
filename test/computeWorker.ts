import type { ComputeInboundMessage, ComputeOutboundMessage } from '../src/compute/protocol.ts'
import { attachComputeWorker, type WorkerScopeLike } from '../src/compute/workerRuntime.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

class FakeScope implements WorkerScopeLike {
  listener: ((event: MessageEvent<ComputeInboundMessage>) => void) | null = null
  messages: ComputeOutboundMessage[] = []
  addEventListener(_type: 'message', listener: (event: MessageEvent<ComputeInboundMessage>) => void): void { this.listener = listener }
  removeEventListener(_type: 'message', listener: (event: MessageEvent<ComputeInboundMessage>) => void): void {
    if (this.listener === listener) this.listener = null
  }
  postMessage(message: ComputeOutboundMessage): void { this.messages.push(message) }
  send(message: ComputeInboundMessage): void { this.listener?.({ data: message } as MessageEvent<ComputeInboundMessage>) }
}

const scope = new FakeScope()
const runtime = attachComputeWorker(scope)
check('Registers production tasks', runtime.host.list().map((task) => task.id).join(',') === 'chart-series,fixed-rate-resample,gpx-export,track-health-scan')

scope.send({
  type: 'request',
  requestId: 'chart-1',
  task: 'chart-series',
  taskVersion: 1,
  payload: {
    points: [
      { lat: 0, lon: 0, time: 0, ele: 10 },
      { lat: 0, lon: 0.1, time: 1000, ele: 20 },
    ],
    channelId: 'elevation',
    xAxis: 'time',
    maxSamples: 100,
  },
})

await new Promise((resolve) => setTimeout(resolve, 0))
check('Emits progress', scope.messages.some((message) => message.type === 'progress' && message.requestId === 'chart-1'))
check('Returns chart-series results', scope.messages.some((message) => message.type === 'success' && message.requestId === 'chart-1'))

scope.send({ type: 'request', requestId: 'bad-1', task: 'missing', taskVersion: 1, payload: {} })
await new Promise((resolve) => setTimeout(resolve, 0))
check('Returns typed failures for unknown tasks', scope.messages.some((message) => message.type === 'failure' && message.requestId === 'bad-1' && message.error.code === 'UNKNOWN_TASK'))

runtime.dispose()
check('Disposal detaches the worker listener', scope.listener === null)

console.log(`\n${failures === 0 ? 'ALL COMPUTE WORKER CHECKS PASSED' : `${failures} COMPUTE WORKER CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
