import type { Dataset } from '../model'
import { fingerprintDataset } from './hash'
import type { OperationRecord, Recipe } from './model'
import { getOperation } from './registry'

let operationSequence = 0

export function executeOperation(
  dataset: Dataset,
  operationId: string,
  rawParams: unknown,
  scope?: OperationRecord['scope'],
): { dataset: Dataset; record: OperationRecord } {
  const definition = getOperation(operationId)
  if (!definition) throw new Error(`Unknown operation: ${operationId}`)

  const params = definition.validateParams(rawParams)
  const inputDatasetHash = fingerprintDataset(dataset)
  const result = definition.execute({ dataset, params, scope })
  const outputDatasetHash = fingerprintDataset(result.dataset)

  return {
    dataset: result.dataset,
    record: {
      id: `op_${Date.now()}_${operationSequence++}`,
      operationId: definition.id,
      operationVersion: definition.version,
      params,
      inputDatasetHash,
      outputDatasetHash,
      scope,
      createdAt: Date.now(),
      summary: result.summary,
      warnings: result.warnings ?? [],
    },
  }
}

export function replayRecipe(source: Dataset, recipe: Recipe): Dataset {
  const sourceHash = fingerprintDataset(source)
  if (sourceHash !== recipe.sourceDatasetHash) {
    throw new Error(`Recipe source mismatch: expected ${recipe.sourceDatasetHash}, received ${sourceHash}`)
  }

  let current = source
  for (const record of recipe.operations) {
    const currentHash = fingerprintDataset(current)
    if (currentHash !== record.inputDatasetHash) {
      throw new Error(`Recipe operation ${record.id} input mismatch`)
    }

    const definition = getOperation(record.operationId)
    if (!definition) throw new Error(`Unknown operation: ${record.operationId}`)
    if (definition.version !== record.operationVersion) {
      throw new Error(
        `Operation version mismatch for ${record.operationId}: recipe=${record.operationVersion}, runtime=${definition.version}`,
      )
    }

    const params = definition.validateParams(record.params)
    current = definition.execute({ dataset: current, params, scope: record.scope }).dataset

    const outputHash = fingerprintDataset(current)
    if (record.outputDatasetHash && outputHash !== record.outputDatasetHash) {
      throw new Error(`Recipe operation ${record.id} output mismatch`)
    }
  }

  return current
}

export function buildRecipe(name: string, source: Dataset, operations: OperationRecord[]): Recipe {
  return {
    schemaVersion: 1,
    id: `recipe_${Date.now()}`,
    name: name.trim() || 'Untitled recipe',
    createdAt: Date.now(),
    sourceDatasetHash: fingerprintDataset(source),
    operations: operations.map((operation) => ({
      ...operation,
      warnings: [...operation.warnings],
      scope: operation.scope ? { ...operation.scope } : undefined,
    })),
  }
}
