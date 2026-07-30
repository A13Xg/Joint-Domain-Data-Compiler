import { isValidLat, isValidLon, type Dataset, type TrackPoint } from '../../core/model'
import { fingerprintDataset } from '../../core/recipes/hash'
import type { OperationRecord, Recipe } from '../../core/recipes/model'
import { getOperation } from '../../core/recipes/registry'
import type { WorkspaceSelection } from '../../core/selection'
import type { WorkspaceState } from '../../state/workspace'
import type { WorkspaceDisplay } from '../../state/workspaceDisplay'
import type { FusionArtifact } from '../../core/fusion/artifact'
import {
  parseProjectManifest,
  serializeProjectManifest,
  validateProjectManifest,
  operationRecordsFromManifest,
  type ProjectBookmark,
  type ProjectManifest,
} from './manifest'

export interface ProjectDatasetHistory {
  past: Dataset[]
  future: Dataset[]
}

export interface ProjectArchiveV1 {
  schema: 'jddc-project-archive'
  schemaVersion: 1
  manifest: ProjectManifest
  datasets: Dataset[]
  histories: Record<string, ProjectDatasetHistory>
}

export interface ProjectArchiveV2 {
  schema: 'jddc-project-archive'
  schemaVersion: 2
  manifest: ProjectManifest
  datasets: Dataset[]
  /** Materialized for the UI; serialization replaces this with checkpoint/deltas. */
  histories: Record<string, ProjectDatasetHistory>
}

export type ProjectArchive = ProjectArchiveV2

interface PersistedHistory {
  checkpoint: Dataset | null
  past: PersistedDelta[]
  future: PersistedDelta[]
}

interface PersistedDelta {
  schemaVersion: 1
  baseHash: string
  outputHash: string
  kind: 'operation' | 'patch'
  operation?: OperationRecord
  patches?: Array<{ path: string[]; value?: unknown; delete?: true }>
}

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const MAX_DECOMPRESSED_ARCHIVE_BYTES = 512 * 1024 * 1024
const MAX_DATASETS = 100
const MAX_TOTAL_POINTS = 10_000_000
const MAX_PATCHES_PER_DELTA = 100_000
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function createProjectArchive(input: {
  manifest: ProjectManifest
  datasets: Dataset[]
  histories: Record<string, ProjectDatasetHistory>
}): ProjectArchive {
  const archive: ProjectArchive = {
    schema: 'jddc-project-archive',
    schemaVersion: 2,
    manifest: input.manifest,
    datasets: input.datasets,
    histories: input.histories,
  }
  return validateProjectArchive(archive)
}

export function serializeProjectArchive(archive: ProjectArchive): string {
  const validated = validateProjectArchive(archive)
  const persisted = { ...validated, histories: persistedHistories(validated) }
  validatePersistedArchive(persisted)
  return JSON.stringify(persisted)
}

export function parseProjectArchive(text: string): ProjectArchive {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`Project archive is not valid JSON: ${errorMessage(error)}`, { cause: error })
  }
  if (!isRecord(value)) throw new Error('Project archive must be an object')
  if (value.schema !== 'jddc-project-archive') throw new Error('Unsupported project archive schema')
  if (value.schemaVersion === 1) return migrateLegacyArchive(value)
  validatePersistedArchive(value)
  return materializePersistedArchive(value)
}

export async function encodeProjectArchive(archive: ProjectArchive): Promise<Blob> {
  const json = serializeProjectArchive(archive)
  const bytes = textEncoder.encode(json)
  if (typeof CompressionStream === 'undefined') {
    return new Blob([bytes], { type: 'application/vnd.jddc.project+json' })
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Blob([await new Response(stream).arrayBuffer()], { type: 'application/vnd.jddc.project+gzip' })
}

export async function decodeProjectArchive(file: Blob): Promise<ProjectArchive> {
  if (file.size > MAX_ARCHIVE_BYTES) {
    throw new Error(`Project archive exceeds the ${formatBytes(MAX_ARCHIVE_BYTES)} safety limit`)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const gzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
  let decoded: Uint8Array
  if (gzip) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This runtime cannot decompress .jddc-project archives')
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    decoded = await readStreamWithLimit(stream, MAX_DECOMPRESSED_ARCHIVE_BYTES)
  } else {
    decoded = bytes
  }
  return parseProjectArchive(textDecoder.decode(decoded))
}

export async function readStreamWithLimit(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Archive decompressed safety limit must be a non-negative safe integer')
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > limit) {
        await reader.cancel('decompressed archive exceeds safety limit')
        throw new Error(`Project archive exceeds the ${formatBytes(limit)} decompressed safety limit`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

/**
 * Validates an untrusted value as a `ProjectArchive`. Throws on structural
 * errors. Does not mutate `value`: the manifest's normalized form (from
 * `validateProjectManifest`, itself non-mutating) is folded into a freshly
 * returned archive object rather than written back into the input.
 */
export function validateProjectArchive(value: unknown): ProjectArchive {
  if (!isRecord(value)) throw new Error('Project archive must be an object')
  if (value.schema !== 'jddc-project-archive') throw new Error('Unsupported project archive schema')
  if (value.schemaVersion !== 2) throw new Error(`Unsupported project archive version: ${String(value.schemaVersion)}`)
  const manifest = validateProjectManifest(value.manifest)
  if (!Array.isArray(value.datasets)) throw new Error('Project archive datasets must be an array')
  if (value.datasets.length > MAX_DATASETS) throw new Error(`Project archive exceeds ${MAX_DATASETS} datasets`)
  if (!isRecord(value.histories)) throw new Error('Project archive histories must be an object')

  const datasetIds = new Set<string>()
  let totalPoints = 0
  for (const dataset of value.datasets) {
    validateDataset(dataset)
    if (datasetIds.has(dataset.id)) throw new Error(`Duplicate embedded dataset id: ${dataset.id}`)
    datasetIds.add(dataset.id)
    totalPoints += dataset.points.length
    if (totalPoints > MAX_TOTAL_POINTS) throw new Error(`Project archive exceeds ${MAX_TOTAL_POINTS.toLocaleString()} embedded points`)
  }

  for (const entry of manifest.datasets) {
    const dataset = value.datasets.find((candidate) => candidate.id === entry.id)
    if (!dataset) throw new Error(`Manifest dataset ${entry.id} has no embedded payload`)
    const fingerprint = fingerprintDataset(dataset)
    if (fingerprint !== entry.sourceHash) throw new Error(`Embedded dataset ${entry.id} fingerprint does not match the manifest`)
  }
  if (value.datasets.length !== manifest.datasets.length) {
    throw new Error('Manifest and embedded dataset counts do not match')
  }
  for (const artifact of manifest.fusionArtifacts) {
    if (artifact.fusedDatasetHash === undefined) continue
    const fused = value.datasets.find((dataset) => dataset.id === artifact.fusedDatasetId)
    if (!fused || fingerprintDataset(fused) !== artifact.fusedDatasetHash) throw new Error(`Fusion artifact ${artifact.id} fused dataset binding does not match`)
    for (const source of artifact.sourceRegistrations) {
      const dataset = value.datasets.find((candidate) => candidate.id === source.datasetId)
      if (!dataset || fingerprintDataset(dataset) !== artifact.sourceDatasetHashes?.[source.id]) throw new Error(`Fusion artifact ${artifact.id} source dataset binding does not match`)
    }
  }

  for (const [datasetId, history] of Object.entries(value.histories)) {
    if (!datasetIds.has(datasetId)) throw new Error(`History references missing dataset ${datasetId}`)
    validateHistory(history, datasetId)
  }

  return { ...value, manifest, schemaVersion: 2 } as ProjectArchive
}

export function buildProjectManifest(input: {
  datasets: Dataset[]
  activeDatasetId: string | null
  activeTab: string
  selection: WorkspaceSelection
  workspace?: WorkspaceState
  datasetDisplay?: WorkspaceDisplay
  bookmarks?: ProjectBookmark[]
  operationRecords?: Readonly<Record<string, readonly OperationRecord[]>>
  projectId?: string
  projectName?: string
  notes?: string
  fusionArtifacts?: FusionArtifact[]
  namedRecipes?: Readonly<Record<string, readonly Recipe[]>>
  createdAt?: number
  applicationVersion: string
}): ProjectManifest {
  const now = Date.now()
  const operationRecipes: Recipe[] = input.datasets.flatMap((dataset) => {
    const operations = input.operationRecords?.[dataset.id] ?? []
    if (operations.length === 0) return []
    return [{
      schemaVersion: 1 as const,
      kind: 'operation-history' as const,
      id: `operations_${dataset.id}`,
      name: `${dataset.name} operation history`,
      createdAt: operations[0]?.createdAt ?? now,
      sourceDatasetHash: operations[0]?.inputDatasetHash ?? fingerprintDataset(dataset),
      operations: operations.map((operation) => structuredClone(operation)),
    }]
  })
  const namedRecipes = input.datasets.flatMap((dataset) => (input.namedRecipes?.[dataset.id] ?? []).map((recipe) => ({ ...structuredClone(recipe), kind: 'named' as const })))
  const recipes = [...operationRecipes, ...namedRecipes]
  const recipeIdsByDataset = new Map(input.datasets.map((dataset) => [
    dataset.id,
    recipes.filter((recipe) => recipe.id === `operations_${dataset.id}` || (input.namedRecipes?.[dataset.id] ?? []).some((named) => named.id === recipe.id)).map((recipe) => recipe.id),
  ]))
  return {
    schema: 'jddc-project',
    schemaVersion: 2,
    projectId: input.projectId ?? `project_${now}`,
    name: input.projectName ?? (input.datasets.length === 1 ? input.datasets[0]?.name ?? 'JDDC project' : `JDDC workspace (${input.datasets.length} datasets)`),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    applicationVersion: input.applicationVersion,
    datasets: input.datasets.map((dataset) => ({
      id: dataset.id,
      name: dataset.name,
      sourceFormat: dataset.sourceFormat,
      sourceHash: fingerprintDataset(dataset),
      sourceFileName: dataset.metadata?.source.filename ?? dataset.name,
      embeddedDataPath: `datasets/${dataset.id}.json`,
      recipeIds: recipeIdsByDataset.get(dataset.id) ?? [],
      visible: true,
    })),
    recipes,
    bookmarks: input.bookmarks ?? [],
    fusionArtifacts: input.fusionArtifacts ?? [],
    view: {
      activeDatasetId: input.activeDatasetId,
      activeTab: input.activeTab,
      selection: input.selection,
      chartLayoutIds: [],
      ...(input.workspace ? { workspace: input.workspace } : {}),
      ...(input.datasetDisplay ? { datasetDisplay: input.datasetDisplay } : {}),
    },
  }
}

export function archiveSummary(archive: ProjectArchive): {
  datasets: number
  currentPoints: number
  historySnapshots: number
  historyPoints: number
} {
  let historySnapshots = 0
  let historyPoints = 0
  for (const history of Object.values(archive.histories)) {
    historySnapshots += history.past.length + history.future.length
    historyPoints += [...history.past, ...history.future].reduce((sum, dataset) => sum + dataset.points.length, 0)
  }
  return {
    datasets: archive.datasets.length,
    currentPoints: archive.datasets.reduce((sum, dataset) => sum + dataset.points.length, 0),
    historySnapshots,
    historyPoints,
  }
}

function validateHistory(value: unknown, datasetId: string): asserts value is ProjectDatasetHistory {
  if (!isRecord(value) || !Array.isArray(value.past) || !Array.isArray(value.future)) {
    throw new Error(`History for ${datasetId} must contain past and future arrays`)
  }
  for (const snapshot of [...value.past, ...value.future]) {
    validateDataset(snapshot)
    if (snapshot.id !== datasetId) throw new Error(`History snapshot id ${snapshot.id} does not match ${datasetId}`)
  }
}

function persistedHistories(archive: ProjectArchive): Record<string, PersistedHistory> {
  const records = operationRecordsFromManifest(archive.manifest)
  return Object.fromEntries(Object.entries(archive.histories).map(([datasetId, history]) => {
    const checkpoint = history.past[0] ? structuredClone(history.past[0]) : null
    const pastBase = checkpoint ?? archive.datasets.find((dataset) => dataset.id === datasetId)
    if (!pastBase) throw new Error(`History references missing dataset ${datasetId}`)
    const pastStates = history.past.slice(1)
    const pastDeltas = pastStates.map((state, index) => makeDelta(history.past[index]!, state, records[datasetId] ?? []))
    let base = archive.datasets.find((dataset) => dataset.id === datasetId)!
    const futureDeltas = history.future.map((state) => {
      const delta = makeDelta(base, state, records[datasetId] ?? [])
      base = state
      return delta
    })
    return [datasetId, { checkpoint, past: pastDeltas, future: futureDeltas }]
  }))
}

function makeDelta(base: Dataset, output: Dataset, records: readonly OperationRecord[]): PersistedDelta {
  const baseHash = fingerprintDataset(base)
  const outputHash = fingerprintDataset(output)
  const operation = records.find((record) => record.inputDatasetHash === baseHash && record.outputDatasetHash === outputHash)
  if (operation) return { schemaVersion: 1, baseHash, outputHash, kind: 'operation', operation: structuredClone(operation) }
  return { schemaVersion: 1, baseHash, outputHash, kind: 'patch', patches: diffValue(base, output, []) }
}

function diffValue(base: unknown, output: unknown, path: string[]): Array<{ path: string[]; value?: unknown; delete?: true }> {
  if (Object.is(base, output)) return []
  if (isRecord(base) && isRecord(output)) {
    const patches: Array<{ path: string[]; value?: unknown; delete?: true }> = []
    for (const key of new Set([...Object.keys(base), ...Object.keys(output)])) {
      if (!(key in output)) patches.push({ path: [...path, key], delete: true })
      else patches.push(...diffValue(base[key], output[key], [...path, key]))
    }
    return patches
  }
  if (Array.isArray(base) && Array.isArray(output) && base.length === output.length) {
    return output.flatMap((item, index) => diffValue(base[index], item, [...path, String(index)]))
  }
  return [{ path, value: structuredClone(output) }]
}

function materializePersistedArchive(value: Record<string, unknown>): ProjectArchive {
  const datasets = value.datasets as Dataset[]
  const persisted = value.histories as Record<string, PersistedHistory>
  const histories: Record<string, ProjectDatasetHistory> = {}
  for (const [datasetId, stored] of Object.entries(persisted)) {
    const current = datasets.find((dataset) => dataset.id === datasetId)
    if (!current) throw new Error(`History references missing dataset ${datasetId}`)
    const past: Dataset[] = stored.checkpoint ? [stored.checkpoint] : []
    let pastBase = stored.checkpoint
    for (const delta of stored.past) {
      if (!pastBase) throw new Error(`History ${datasetId} has past deltas without a checkpoint`)
      pastBase = replayDelta(pastBase, delta, datasetId)
      past.push(pastBase)
    }
    const future: Dataset[] = []
    let futureBase = current
    for (const delta of stored.future) {
      futureBase = replayDelta(futureBase, delta, datasetId)
      future.push(futureBase)
    }
    histories[datasetId] = { past, future }
  }
  const archive = { ...value, schemaVersion: 2, datasets, histories } as ProjectArchive
  return validateProjectArchive(archive)
}

function replayDelta(base: Dataset, delta: PersistedDelta, datasetId: string): Dataset {
  const actualBaseHash = fingerprintDataset(base)
  if (actualBaseHash !== delta.baseHash) throw new Error(`History ${datasetId} delta base fingerprint mismatch`)
  let output: Dataset
  if (delta.kind === 'operation') {
    const operation = delta.operation
    if (!operation) throw new Error(`History ${datasetId} operation delta is missing its operation record`)
    const definition = getOperation(operation.operationId)
    if (!definition) throw new Error(`History ${datasetId} cannot replay unknown operation ${operation.operationId}`)
    if (definition.version !== operation.operationVersion) throw new Error(`History ${datasetId} operation version mismatch for ${operation.operationId}`)
    const params = definition.validateParams(operation.params)
    output = definition.execute({ dataset: base, params, scope: operation.scope }).dataset
  } else if (delta.kind === 'patch') {
    if (!Array.isArray(delta.patches)) throw new Error(`History ${datasetId} patch delta is missing patches`)
    output = applyPatches(base, delta.patches, datasetId)
  } else {
    throw new Error(`History ${datasetId} has an unsupported delta kind`)
  }
  validateDataset(output)
  if (output.points.length > MAX_TOTAL_POINTS) throw new Error(`History ${datasetId} delta exceeds ${MAX_TOTAL_POINTS.toLocaleString()} points`)
  if (fingerprintDataset(output) !== delta.outputHash) throw new Error(`History ${datasetId} delta output fingerprint mismatch`)
  return output
}

function applyPatches(base: Dataset, patches: PersistedDelta['patches'], datasetId: string): Dataset {
  const output = structuredClone(base) as unknown as Record<string, unknown>
  for (const patch of patches ?? []) {
    if (!Array.isArray(patch.path) || patch.path.length === 0 || patch.path[0] !== 'points' && patch.path[0] !== 'name' && patch.path[0] !== 'channels' && patch.path[0] !== 'warnings' && patch.path[0] !== 'metadata') {
      throw new Error(`History ${datasetId} contains an invalid patch path`)
    }
    let target: Record<string, unknown> | unknown[] = output
    for (const segment of patch.path.slice(0, -1)) {
      if (!isRecord(target) && !Array.isArray(target)) throw new Error(`History ${datasetId} patch path is not traversable`)
      if (Array.isArray(target) && (!/^0$|^[1-9]\d*$/.test(segment) || Number(segment) >= target.length)) {
        throw new Error(`History ${datasetId} patch path cannot create sparse arrays`)
      }
      target = (target as Record<string, unknown>)[segment] as Record<string, unknown> | unknown[]
    }
    const key = patch.path[patch.path.length - 1]!
    if (patch.delete) delete (target as Record<string, unknown>)[key]
    else (target as Record<string, unknown>)[key] = structuredClone(patch.value)
  }
  return output as unknown as Dataset
}

function validatePersistedArchive(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Project archive must be an object')
  if (value.schema !== 'jddc-project-archive' || value.schemaVersion !== 2) throw new Error(`Unsupported project archive version: ${String(value.schemaVersion)}`)
  // Validated for its structural checks (throws on error); the persisted
  // payload itself is re-validated (and its manifest re-normalized) later by
  // `materializePersistedArchive`, which is what actually gets returned.
  validateProjectManifest(value.manifest)
  if (!Array.isArray(value.datasets) || !isRecord(value.histories)) throw new Error('Project archive payload is malformed')
  const runtime = { ...value, histories: {} }
  validateProjectArchive(runtime)
  for (const [datasetId, history] of Object.entries(value.histories)) {
    if (!isRecord(history) || (history.checkpoint !== null && history.checkpoint === undefined) || !Array.isArray(history.past) || !Array.isArray(history.future)) throw new Error(`Persisted history for ${datasetId} is malformed`)
    if (history.checkpoint !== null) { validateDataset(history.checkpoint); if (history.checkpoint.id !== datasetId) throw new Error(`History checkpoint id does not match ${datasetId}`) }
    for (const delta of [...history.past, ...history.future]) validatePersistedDelta(delta, datasetId)
  }
}

function validatePersistedDelta(value: unknown, datasetId: string): asserts value is PersistedDelta {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.baseHash !== 'string' || typeof value.outputHash !== 'string') throw new Error(`History ${datasetId} delta is malformed`)
  if (value.kind === 'operation') {
    if (!isRecord(value.operation) || typeof value.operation.operationId !== 'string' || !Number.isSafeInteger(value.operation.operationVersion)) throw new Error(`History ${datasetId} operation delta is malformed`)
  } else if (value.kind === 'patch') {
    if (!Array.isArray(value.patches) || value.patches.length > MAX_PATCHES_PER_DELTA) throw new Error(`History ${datasetId} patch delta is malformed`)
    for (const patch of value.patches) {
      if (!isRecord(patch) || !Array.isArray(patch.path) || patch.path.length === 0 || patch.path.length > 12 || !patch.path.every((segment) => typeof segment === 'string' && segment.length > 0 && segment.length <= 128 && segment !== '__proto__' && segment !== 'constructor' && segment !== 'prototype')) {
        throw new Error(`History ${datasetId} patch delta contains an unsafe patch path`)
      }
      if (patch.delete !== undefined && patch.delete !== true) throw new Error(`History ${datasetId} patch delta delete marker is invalid`)
    }
  } else throw new Error(`History ${datasetId} delta kind is unsupported`)
}

function migrateLegacyArchive(value: Record<string, unknown>): ProjectArchive {
  const legacy = { ...value, manifest: parseProjectManifest(JSON.stringify(value.manifest)) } as Record<string, unknown>
  if (!Array.isArray(legacy.datasets) || !isRecord(legacy.histories)) throw new Error('Legacy project archive payload is malformed')
  for (const [datasetId, history] of Object.entries(legacy.histories)) validateHistory(history, datasetId)
  const migrated = { ...legacy, schemaVersion: 2 } as ProjectArchive
  return validateProjectArchive(migrated)
}

function validateDataset(value: unknown): asserts value is Dataset {
  if (!isRecord(value)) throw new Error('Embedded datasets must be objects')
  requireString(value.id, 'dataset.id')
  requireString(value.name, 'dataset.name')
  requireString(value.sourceFormat, 'dataset.sourceFormat')
  if (!Array.isArray(value.points)) throw new Error(`Dataset ${value.id} points must be an array`)
  if (value.points.length > MAX_TOTAL_POINTS) throw new Error(`Dataset ${value.id} exceeds ${MAX_TOTAL_POINTS.toLocaleString()} points`)
  if (!Array.isArray(value.warnings) || !value.warnings.every((item) => typeof item === 'string')) throw new Error(`Dataset ${value.id} warnings must be strings`)
  if (!Array.isArray(value.channels) || !value.channels.every((item) => typeof item === 'string')) throw new Error(`Dataset ${value.id} channels must be strings`)
  requireFinite(value.createdAt, `Dataset ${value.id} createdAt`)
  if (value.sourceBytes !== undefined) requireFinite(value.sourceBytes, `Dataset ${value.id} sourceBytes`)
  for (const point of value.points) validatePoint(point, value.id)
}

function validatePoint(value: unknown, datasetId: string): asserts value is TrackPoint {
  if (!isRecord(value)) throw new Error(`Dataset ${datasetId} contains a non-object point`)
  requireFinite(value.lat, `Dataset ${datasetId} point latitude`)
  requireFinite(value.lon, `Dataset ${datasetId} point longitude`)
  if (!isValidLat(value.lat)) throw new Error(`Dataset ${datasetId} point latitude is outside [-90, 90]`)
  if (!isValidLon(value.lon)) throw new Error(`Dataset ${datasetId} point longitude is outside [-180, 180]`)
  if (value.ele !== undefined) requireFinite(value.ele, `Dataset ${datasetId} point elevation`)
  if (value.time !== undefined) requireFinite(value.time, `Dataset ${datasetId} point time`)
  if (value.name !== undefined && typeof value.name !== 'string') throw new Error(`Dataset ${datasetId} point name must be a string`)
  if (value.desc !== undefined && typeof value.desc !== 'string') throw new Error(`Dataset ${datasetId} point description must be a string`)
  if (value.ext !== undefined) {
    if (!isRecord(value.ext)) throw new Error(`Dataset ${datasetId} point extensions must be an object`)
    for (const channelValue of Object.values(value.ext)) {
      if (typeof channelValue === 'number' && !Number.isFinite(channelValue)) throw new Error(`Dataset ${datasetId} contains a non-finite extension value`)
      if (!['number', 'string', 'boolean'].includes(typeof channelValue)) throw new Error(`Dataset ${datasetId} contains an unsupported extension value`)
    }
  }
}

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`)
}

function requireFinite(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} must be finite`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

export { parseProjectManifest, serializeProjectManifest }
