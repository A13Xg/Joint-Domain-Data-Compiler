import { errorMessage } from '../core/errors'
import { ComputeTaskHost } from './host'
import type { ComputeInboundMessage, ComputeOutboundMessage, ComputeTaskDefinition } from './protocol'
import { PRODUCTION_COMPUTE_TASKS } from './tasks'

export interface WorkerScopeLike {
  addEventListener(type: 'message', listener: (event: MessageEvent<ComputeInboundMessage>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<ComputeInboundMessage>) => void): void
  postMessage(message: ComputeOutboundMessage): void
}

export interface ComputeWorkerRuntime {
  host: ComputeTaskHost
  dispose(): void
}

export function attachComputeWorker(scope: WorkerScopeLike): ComputeWorkerRuntime {
  const host = new ComputeTaskHost()
  // PRODUCTION_COMPUTE_TASKS is a heterogeneous union; without this widening
  // `register` binds its generics to the first member and rejects the rest
  // (TS2345). no-unnecessary-type-assertion reports it as redundant because it
  // only considers that first member, so the rule is silenced here rather than
  // repo-wide.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  for (const task of PRODUCTION_COMPUTE_TASKS) host.register(task as ComputeTaskDefinition)

  const listener = (event: MessageEvent<ComputeInboundMessage>) => {
    const requestId = typeof event.data?.requestId === 'string' ? event.data.requestId : null
    // An unhandled rejection here is invisible inside a worker and leaves the
    // client's promise pending forever, so report it back over the protocol.
    host.handle(event.data, (message) => scope.postMessage(message)).catch((error: unknown) => {
      if (!requestId) return
      scope.postMessage({
        type: 'failure',
        requestId,
        error: { code: 'HOST_FAILED', message: errorMessage(error), retryable: false },
      })
    })
  }
  scope.addEventListener('message', listener)

  return {
    host,
    dispose() {
      scope.removeEventListener('message', listener)
    },
  }
}
