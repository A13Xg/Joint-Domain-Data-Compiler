export interface IdentifiedRecord {
  id: string
}

let fallbackCounter = 0

export function createDatasetId(label = '', randomUUID: (() => string) | undefined = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)): string {
  const uuid = randomUUID?.() ?? fallbackUuid()
  const suffix = label.trim().toLowerCase().replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 24)
  return `ds_${uuid}${suffix ? `_${suffix}` : ''}`
}

export function assertUniqueDatasetId(records: readonly IdentifiedRecord[], id: string): void {
  if (records.some((record) => record.id === id)) throw new Error(`Duplicate dataset id: ${id}`)
}

export function insertDataset<T extends IdentifiedRecord>(records: readonly T[], record: T): T[] {
  assertUniqueDatasetId(records, record.id)
  return [...records, record]
}

function fallbackUuid(): string {
  fallbackCounter = (fallbackCounter + 1) >>> 0
  const now = Date.now().toString(16).padStart(12, '0').slice(-12)
  const counter = fallbackCounter.toString(16).padStart(12, '0')
  return `${now.slice(0, 8)}-${now.slice(8)}-4000-8000-${counter}`
}
