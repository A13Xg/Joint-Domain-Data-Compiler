export interface ComputeRequest<TPayload = unknown> {
  type: 'request'
  requestId: string
  task: string
  taskVersion: number
  payload: TPayload
}

export interface ComputeCancelRequest {
  type: 'cancel'
  requestId: string
}

export interface ComputeProgress {
  type: 'progress'
  requestId: string
  completed: number
  total?: number
  message?: string
}

export interface ComputeSuccess<TResult = unknown> {
  type: 'success'
  requestId: string
  result: TResult
}

export interface ComputeFailure {
  type: 'failure'
  requestId: string
  error: {
    code: string
    message: string
    retryable: boolean
    details?: Record<string, unknown>
  }
}

export interface ComputeCancelled {
  type: 'cancelled'
  requestId: string
}

export type ComputeInboundMessage<TPayload = unknown> = ComputeRequest<TPayload> | ComputeCancelRequest
export type ComputeOutboundMessage<TResult = unknown> =
  | ComputeProgress
  | ComputeSuccess<TResult>
  | ComputeFailure
  | ComputeCancelled

export interface ComputeTaskContext {
  requestId: string
  signal: AbortSignal
  reportProgress(progress: Omit<ComputeProgress, 'type' | 'requestId'>): void
}

export interface ComputeTaskDefinition<TPayload = unknown, TResult = unknown> {
  id: string
  version: number
  validatePayload(payload: unknown): TPayload
  run(payload: TPayload, context: ComputeTaskContext): Promise<TResult> | TResult
}
