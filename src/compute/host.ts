import type {
  ComputeCancelRequest,
  ComputeFailure,
  ComputeInboundMessage,
  ComputeOutboundMessage,
  ComputeProgress,
  ComputeRequest,
  ComputeTaskDefinition,
} from './protocol'
import { errorMessage } from '../core/errors'

export type ComputeEmitter = (message: ComputeOutboundMessage) => void

export class ComputeTaskHost {
  private readonly tasks = new Map<string, ComputeTaskDefinition>()
  private readonly active = new Map<string, AbortController>()

  register<TPayload, TResult>(definition: ComputeTaskDefinition<TPayload, TResult>): void {
    if (!definition.id.trim()) throw new Error('Compute task id is required')
    if (!Number.isInteger(definition.version) || definition.version < 1) {
      throw new Error(`Compute task ${definition.id} must declare a positive integer version`)
    }
    if (this.tasks.has(definition.id)) throw new Error(`Compute task ${definition.id} is already registered`)
    this.tasks.set(definition.id, definition)
  }

  list(): ComputeTaskDefinition[] {
    return [...this.tasks.values()].sort((a, b) => a.id.localeCompare(b.id))
  }

  async handle(message: ComputeInboundMessage, emit: ComputeEmitter): Promise<void> {
    // The frame crossed a structured-clone boundary, so its declared type is a
    // claim. Reading `.type` off a non-object would reject this promise with a
    // TypeError the caller cannot attribute to any request.
    if (!message || typeof message !== 'object' || typeof (message as { requestId?: unknown }).requestId !== 'string') {
      return
    }
    if (message.type === 'cancel') {
      this.cancel(message, emit)
      return
    }
    const frame = message as { type?: unknown; requestId: string }
    if (frame.type !== 'request') {
      emit(failure(frame.requestId, 'UNKNOWN_MESSAGE', `Unsupported compute message type: ${String(frame.type)}`, false))
      return
    }
    await this.execute(message, emit)
  }

  private cancel(message: ComputeCancelRequest, emit: ComputeEmitter): void {
    const controller = this.active.get(message.requestId)
    if (!controller) return
    controller.abort()
    emit({ type: 'cancelled', requestId: message.requestId })
  }

  private async execute(message: ComputeRequest, emit: ComputeEmitter): Promise<void> {
    if (this.active.has(message.requestId)) {
      emit(failure(message.requestId, 'DUPLICATE_REQUEST', 'A request with this id is already active.', false))
      return
    }

    const definition = this.tasks.get(message.task)
    if (!definition) {
      emit(failure(message.requestId, 'UNKNOWN_TASK', `Unknown compute task: ${message.task}`, false))
      return
    }
    if (definition.version !== message.taskVersion) {
      emit(failure(
        message.requestId,
        'TASK_VERSION_MISMATCH',
        `Task ${message.task} version mismatch: request=${message.taskVersion}, runtime=${definition.version}`,
        false,
      ))
      return
    }

    let payload: unknown
    try {
      payload = definition.validatePayload(message.payload)
    } catch (error) {
      emit(failure(message.requestId, 'INVALID_PAYLOAD', errorMessage(error), false))
      return
    }

    const controller = new AbortController()
    this.active.set(message.requestId, controller)

    try {
      const result = await definition.run(payload, {
        requestId: message.requestId,
        signal: controller.signal,
        reportProgress(progress) {
          const event: ComputeProgress = {
            type: 'progress',
            requestId: message.requestId,
            completed: Math.max(0, progress.completed),
            total: progress.total,
            message: progress.message,
          }
          emit(event)
        },
      })
      if (controller.signal.aborted) return
      emit({ type: 'success', requestId: message.requestId, result })
    } catch (error) {
      if (controller.signal.aborted) return
      safeEmit(emit, failure(message.requestId, 'TASK_FAILED', errorMessage(error), true), message.requestId)
    } finally {
      this.active.delete(message.requestId)
    }
  }
}

/** Last-resort emit. If the failure frame itself cannot be posted the client
 *  would wait forever, so fall back to a frame that is guaranteed cloneable. */
function safeEmit(emit: ComputeEmitter, message: ComputeFailure, requestId: string): void {
  try {
    emit(message)
  } catch {
    emit(failure(requestId, 'EMIT_FAILED', 'Compute task failed and its error could not be transferred.', false))
  }
}

function failure(requestId: string, code: string, message: string, retryable: boolean): ComputeFailure {
  return { type: 'failure', requestId, error: { code, message, retryable } }
}
