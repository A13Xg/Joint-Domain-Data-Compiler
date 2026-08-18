import type { OperationDefinition } from './model'

const operations = new Map<string, OperationDefinition>()

export function registerOperation<TParams>(definition: OperationDefinition<TParams>): void {
  if (!definition.id.trim()) throw new Error('Operation id is required')
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error(`Operation ${definition.id} must declare a positive integer version`)
  }
  if (operations.has(definition.id)) throw new Error(`Operation ${definition.id} is already registered`)
  operations.set(definition.id, definition)
}

export function getOperation(id: string): OperationDefinition | null {
  return operations.get(id) ?? null
}

export function listOperations(): OperationDefinition[] {
  return [...operations.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export function clearOperationsForTests(): void {
  operations.clear()
}
