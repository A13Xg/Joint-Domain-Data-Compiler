import { toError } from '../core/errors'
import type { ComputeCancelRequest, ComputeOutboundMessage, ComputeRequest } from './protocol'

/** 'error' and 'messageerror' are how a worker reports that it died or sent an
 *  undeserializable frame — the only failure modes that produce no protocol
 *  message at all. */
export type WorkerEventType = 'message' | 'error' | 'messageerror'

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: WorkerEventType, listener: (event: MessageEvent<ComputeOutboundMessage>) => void): void
  removeEventListener(type: WorkerEventType, listener: (event: MessageEvent<ComputeOutboundMessage>) => void): void
  terminate?(): void
}

type WorkerLifecycleListener = (event: MessageEvent<ComputeOutboundMessage>) => void

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
  private readonly worker: WorkerLike
  private readonly pending = new Map<string, PendingRequest>()
  private readonly handleMessageBound = (event: MessageEvent<ComputeOutboundMessage>) => this.handleMessage(event.data)
  // A worker that fails to load never posts a Failure message. Without these
  // two listeners every in-flight promise waits forever and the UI keeps its
  // spinner up with no error shown anywhere.
  private readonly handleErrorBound = ((event: unknown) => this.failAll(workerLoadError(event))) as WorkerLifecycleListener
  private readonly handleMessageErrorBound = (() =>
    this.failAll(new Error('Compute worker sent a message that could not be deserialized.'))) as WorkerLifecycleListener
  private nextRequestNumber = 1
  private disposed = false

  constructor(worker: WorkerLike) {
    this.worker = worker
    worker.addEventListener('message', this.handleMessageBound)
    worker.addEventListener('error', this.handleErrorBound)
    worker.addEventListener('messageerror', this.handleMessageErrorBound)
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
    try {
      this.worker.postMessage(message)
    } catch {
      // The worker is already gone, so it can never acknowledge the cancel.
      // Reject locally below rather than leaving the caller hanging.
    }
    this.finish(requestId, () => pending.reject(abortError()))
  }

  dispose(reason = 'Compute client disposed'): void {
    if (this.disposed) return
    this.disposed = true
    this.worker.removeEventListener('message', this.handleMessageBound)
    this.worker.removeEventListener('error', this.handleErrorBound)
    this.worker.removeEventListener('messageerror', this.handleMessageErrorBound)
    for (const [requestId, pending] of this.pending) {
      this.finish(requestId, () => pending.reject(new Error(reason)))
    }
    this.worker.terminate?.()
  }

  get activeRequestCount(): number {
    return this.pending.size
  }

  private handleMessage(message: ComputeOutboundMessage): void {
    // Messages cross a structured-clone boundary, so the declared type is a
    // claim, not a guarantee. A malformed frame must not throw in this
    // listener — that would strand every other in-flight request.
    if (!message || typeof message !== 'object' || typeof message.requestId !== 'string') return
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
    if (message.type !== 'failure') return
    const detail = message.error
    const error = new Error(detail?.message || 'Compute task failed without a reported reason.')
    if (detail?.code) error.name = detail.code
    Object.assign(error, { retryable: detail?.retryable ?? false, details: detail?.details })
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
  /** Reject every in-flight request; used when the worker itself dies. */
  private failAll(error: Error): void {
    for (const [requestId, pending] of [...this.pending]) {
      this.finish(requestId, () => pending.reject(error))
    }
  }
}

function workerLoadError(event: unknown): Error {
  const detail = typeof event === 'object' && event !== null ? (event as { message?: unknown }).message : undefined
  const reason = typeof detail === 'string' && detail ? detail : 'the worker script failed to load'
  return new Error(`Compute worker stopped: ${reason}`)
}

function abortError(): Error {
  const error = new Error('Compute request cancelled')
  error.name = 'AbortError'
  return error
}
