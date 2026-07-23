import type { ComputeCancelRequest, ComputeOutboundMessage, ComputeRequest } from './protocol'

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent<ComputeOutboundMessage>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<ComputeOutboundMessage>) => void): void
  terminate?(): void
}

export interface ComputeRunOptions {
  signal?: AbortSignal
  transfer?: Transferable[]
  onProgress?: (progress: { completed: number; total?: number; message?: string }) => void
}

export interface ComputeRunHandle<TResult> {
  requestId: string
  promise: Promise<TResult>
  cancel(): void
}

interface PendingRequest<TResult = unknown> {
  resolve(value: TResult): void
  reject(error: Error): void
  onProgress?: ComputeRunOptions['onProgress']
  abortCleanup?: () => void
}

export class ComputeClient {
  private readonly pending = new Map<string, PendingRequest>()
  private readonly handleMessageBound = (event: MessageEvent<ComputeOutboundMessage>) => this.handleMessage(event.data)
  private nextRequestNumber = 1
  private disposed = false

  constructor(private readonly worker: WorkerLike) {
    worker.addEventListener('message', this.handleMessageBound)
  }

  run<TPayload, TResult>(
    task: string,
    taskVersion: number,
    payload: TPayload,
    options: ComputeRunOptions = {},
  ): ComputeRunHandle<TResult> {
    this.assertActive()
    if (!task.trim()) throw new Error('Compute task id is required')
    if (!Number.isInteger(taskVersion) || taskVersion < 1) throw new Error('Compute task version must be a positive integer')

    const requestId = `compute-${this.nextRequestNumber++}`
    let resolvePromise!: (value: TResult) => void
    let rejectPromise!: (error: Error) => void
    const promise = new Promise<TResult>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })

    const pending: PendingRequest<TResult> = {
      resolve: resolvePromise,
      reject: rejectPromise,
      onProgress: options.onProgress,
    }

    if (options.signal) {
      if (options.signal.aborted) {
        rejectPromise(abortError())
        return { requestId, promise, cancel: () => undefined }
      }
      const abortListener = () => this.cancel(requestId)
      options.signal.addEventListener('abort', abortListener, { once: true })
      pending.abortCleanup = () => options.signal?.removeEventListener('abort', abortListener)
    }

    this.pending.set(requestId, pending)
    const request: ComputeRequest<TPayload> = {
      type: 'request',
      requestId,
      task,
      taskVersion,
      payload,
    }
    try {
      this.worker.postMessage(request, options.transfer)
    } catch (error) {
      this.finish(requestId, () => rejectPromise(toError(error)))
    }

    return {
      requestId,
      promise,
      cancel: () => this.cancel(requestId),
    }
  }

  cancel(requestId: string): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    const message: ComputeCancelRequest = { type: 'cancel', requestId }
    this.worker.postMessage(message)
    this.finish(requestId, () => pending.reject(abortError()))
  }

  dispose(reason = 'Compute client disposed'): void {
    if (this.disposed) return
    this.disposed = true
    this.worker.removeEventListener('message', this.handleMessageBound)
    for (const [requestId, pending] of this.pending) {
      this.finish(requestId, () => pending.reject(new Error(reason)))
    }
    this.worker.terminate?.()
  }

  get activeRequestCount(): number {
    return this.pending.size
  }

  private handleMessage(message: ComputeOutboundMessage): void {
    const pending = this.pending.get(message.requestId)
    if (!pending) return
    if (message.type === 'progress') {
      pending.onProgress?.({ completed: message.completed, total: message.total, message: message.message })
      return
    }
    if (message.type === 'success') {
      this.finish(message.requestId, () => pending.resolve(message.result))
      return
    }
    if (message.type === 'cancelled') {
      this.finish(message.requestId, () => pending.reject(abortError()))
      return
    }
    const error = new Error(message.error.message)
    error.name = message.error.code
    Object.assign(error, { retryable: message.error.retryable, details: message.error.details })
    this.finish(message.requestId, () => pending.reject(error))
  }

  private finish(requestId: string, settle: () => void): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    pending.abortCleanup?.()
    settle()
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Compute client is disposed')
  }
}

function abortError(): Error {
  const error = new Error('Compute request cancelled')
  error.name = 'AbortError'
  return error
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
