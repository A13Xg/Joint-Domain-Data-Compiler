import type { Dataset } from '../model'
import type { IndexRange, TimeRange } from '../selection'

export interface OperationScope {
  indexRange?: IndexRange
  timeRange?: TimeRange
}

export interface OperationRecord<TParams = unknown> {
  id: string
  operationId: string
  operationVersion: number
  params: TParams
  inputDatasetHash: string
  outputDatasetHash?: string
  scope?: OperationScope
  createdAt: number
  summary: string
  warnings: string[]
}

export interface Recipe {
  schemaVersion: 1
  kind?: 'named' | 'operation-history'
  id: string
  name: string
  createdAt: number
  sourceDatasetHash: string
  operations: OperationRecord[]
}

export interface OperationExecutionContext<TParams = unknown> {
  dataset: Dataset
  params: TParams
  scope?: OperationScope
}

export interface OperationExecutionResult {
  dataset: Dataset
  summary: string
  warnings?: string[]
}

export interface OperationDefinition<TParams = unknown> {
  id: string
  version: number
  label: string
  description: string
  validateParams(params: unknown): TParams
  execute(context: OperationExecutionContext<TParams>): OperationExecutionResult
}
