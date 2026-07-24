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
  for (const task of PRODUCTION_COMPUTE_TASKS) host.register(task as ComputeTaskDefinition)

  const listener = (event: MessageEvent<ComputeInboundMessage>) => {
    void host.handle(event.data, (message) => scope.postMessage(message))
  }
  scope.addEventListener('message', listener)

  return {
    host,
    dispose() {
      scope.removeEventListener('message', listener)
    },
  }
}
