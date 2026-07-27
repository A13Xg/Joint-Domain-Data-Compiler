import type { Dataset, TrackPoint } from '../../core/model'
import { fingerprintDataset } from '../../core/recipes/hash'
import type { OperationRecord, Recipe } from '../../core/recipes/model'
import type { WorkspaceSelection } from '../../core/selection'
import type { WorkspaceState } from '../../state/workspace'
import type { WorkspaceDisplay } from '../../state/workspaceDisplay'
import {
  parseProjectManifest,
  serializeProjectManifest,
  validateProjectManifest,
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

export type ProjectArchive = ProjectArchiveV1

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const MAX_DECOMPRESSED_ARCHIVE_BYTES = 512 * 1024 * 1024
const MAX_DATASETS = 100
const MAX_TOTAL_POINTS = 10_000_000
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function createProjectArchive(input: {
  manifest: ProjectManifest
  datasets: Dataset[]
  histories: Record<string, ProjectDatasetHistory>
}): ProjectArchive {
  const archive: ProjectArchive = {
    schema: 'jddc-project-archive',
    schemaVersion: 1,
    manifest: input.manifest,
    datasets: input.datasets,
    histories: input.histories,
  }
  validateProjectArchive(archive)
  return archive
}

export function serializeProjectArchive(archive: ProjectArchive): string {
  validateProjectArchive(archive)
  return JSON.stringify(archive)
}

export function parseProjectArchive(text: string): ProjectArchive {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`Project archive is not valid JSON: ${errorMessage(error)}`, { cause: error })
  }
  validateProjectArchive(value)
  return value
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

export function validateProjectArchive(value: unknown): asserts value is ProjectArchive {
  if (!isRecord(value)) throw new Error('Project archive must be an object')
  if (value.schema !== 'jddc-project-archive') throw new Error('Unsupported project archive schema')
  if (value.schemaVersion !== 1) throw new Error(`Unsupported project archive version: ${String(value.schemaVersion)}`)
  validateProjectManifest(value.manifest)
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

  for (const entry of value.manifest.datasets) {
    const dataset = value.datasets.find((candidate) => candidate.id === entry.id)
    if (!dataset) throw new Error(`Manifest dataset ${entry.id} has no embedded payload`)
    const fingerprint = fingerprintDataset(dataset)
    if (fingerprint !== entry.sourceHash) throw new Error(`Embedded dataset ${entry.id} fingerprint does not match the manifest`)
  }
  if (value.datasets.length !== value.manifest.datasets.length) {
    throw new Error('Manifest and embedded dataset counts do not match')
  }

  for (const [datasetId, history] of Object.entries(value.histories)) {
    if (!datasetIds.has(datasetId)) throw new Error(`History references missing dataset ${datasetId}`)
    validateHistory(history, datasetId)
  }
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
  createdAt?: number
  applicationVersion: string
}): ProjectManifest {
  const now = Date.now()
  const recipes: Recipe[] = input.datasets.flatMap((dataset) => {
    const operations = input.operationRecords?.[dataset.id] ?? []
    if (operations.length === 0) return []
    return [{
      schemaVersion: 1 as const,
      id: `operations_${dataset.id}`,
      name: `${dataset.name} operation history`,
      createdAt: operations[0]?.createdAt ?? now,
      sourceDatasetHash: operations[0]?.inputDatasetHash ?? fingerprintDataset(dataset),
      operations: operations.map((operation) => structuredClone(operation)),
    }]
  })
  const recipeIdsByDataset = new Map(input.datasets.map((dataset) => [
    dataset.id,
    recipes.filter((recipe) => recipe.id === `operations_${dataset.id}`).map((recipe) => recipe.id),
  ]))
  return {
    schema: 'jddc-project',
    schemaVersion: 1,
    projectId: input.projectId ?? `project_${now}`,
    name: input.projectName ?? (input.datasets.length === 1 ? input.datasets[0]?.name ?? 'JDDC project' : `JDDC workspace (${input.datasets.length} datasets)`),
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

function validateDataset(value: unknown): asserts value is Dataset {
  if (!isRecord(value)) throw new Error('Embedded datasets must be objects')
  requireString(value.id, 'dataset.id')
  requireString(value.name, 'dataset.name')
  requireString(value.sourceFormat, 'dataset.sourceFormat')
  if (!Array.isArray(value.points)) throw new Error(`Dataset ${value.id} points must be an array`)
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
