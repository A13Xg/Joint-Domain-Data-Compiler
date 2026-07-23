import type { ChannelDefinition, Dataset, TrackPoint } from '../model'

export interface DerivationContext {
  dataset: Dataset
  points: readonly TrackPoint[]
}

export interface DerivationResult {
  points: TrackPoint[]
  outputChannels: ChannelDefinition[]
  warnings: string[]
  summary: string
}

export interface DerivedChannelDefinition {
  id: string
  version: number
  label: string
  description: string
  requiredInputs: string[]
  outputChannels: ChannelDefinition[]
  derive(context: DerivationContext): DerivationResult
}

const registry = new Map<string, DerivedChannelDefinition>()

export function registerDerivation(definition: DerivedChannelDefinition): void {
  if (!definition.id.trim()) throw new Error('Derivation id is required')
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error(`Derivation ${definition.id} must declare a positive integer version`)
  }
  if (registry.has(definition.id)) throw new Error(`Derivation ${definition.id} is already registered`)
  registry.set(definition.id, definition)
}

export function getDerivation(id: string): DerivedChannelDefinition | null {
  return registry.get(id) ?? null
}

export function listDerivations(): DerivedChannelDefinition[] {
  return [...registry.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export function clearDerivationsForTests(): void {
  registry.clear()
}

export function runDerivation(id: string, dataset: Dataset): DerivationResult {
  const definition = getDerivation(id)
  if (!definition) throw new Error(`Unknown derivation: ${id}`)
  validateRequirements(definition, dataset)
  return definition.derive({ dataset, points: dataset.points })
}

function validateRequirements(definition: DerivedChannelDefinition, dataset: Dataset): void {
  const available = new Set(dataset.channels)
  if (dataset.points.length > 0) {
    available.add('latitude')
    available.add('longitude')
  }
  if (dataset.points.some((point) => point.ele !== undefined)) available.add('elevation')
  if (dataset.points.some((point) => point.time !== undefined)) available.add('time')

  const missing = definition.requiredInputs.filter((input) => !available.has(input))
  if (missing.length > 0) {
    throw new Error(`Derivation ${definition.id} requires missing inputs: ${missing.join(', ')}`)
  }
}
