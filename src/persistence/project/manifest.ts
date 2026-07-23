import type { Recipe } from '../../core/recipes/model'
import type { WorkspaceSelection } from '../../core/selection'

export interface ProjectDatasetEntry {
  id: string
  name: string
  sourceFormat: string
  sourceHash: string
  sourceFileName: string
  embeddedDataPath?: string
  externalReference?: string
  recipeIds: string[]
  visible: boolean
  color?: string
  timeOffsetMs?: number
}

export interface ProjectBookmark {
  id: string
  label: string
  datasetId: string
  timeMs?: number
  pointIndex?: number
  note?: string
}

export interface ProjectViewState {
  activeDatasetId: string | null
  activeTab?: string
  selection: WorkspaceSelection
  chartLayoutIds: string[]
  mapState?: Record<string, unknown>
  scene3dState?: Record<string, unknown>
}

export interface ProjectManifestV1 {
  schema: 'jddc-project'
  schemaVersion: 1
  projectId: string
  name: string
  createdAt: number
  updatedAt: number
  applicationVersion: string
  datasets: ProjectDatasetEntry[]
  recipes: Recipe[]
  bookmarks: ProjectBookmark[]
  view: ProjectViewState
  notes?: string
}

export type ProjectManifest = ProjectManifestV1

export function serializeProjectManifest(manifest: ProjectManifest): string {
  validateProjectManifest(manifest)
  return JSON.stringify(manifest, null, 2)
}

export function parseProjectManifest(text: string): ProjectManifest {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`Project manifest is not valid JSON: ${errorMessage(error)}`, { cause: error })
  }
  validateProjectManifest(value)
  return value
}

export function validateProjectManifest(value: unknown): asserts value is ProjectManifest {
  if (!isRecord(value)) throw new Error('Project manifest must be an object')
  if (value.schema !== 'jddc-project') throw new Error('Unsupported project manifest schema')
  if (value.schemaVersion !== 1) throw new Error(`Unsupported project manifest version: ${String(value.schemaVersion)}`)
  requireNonEmptyString(value.projectId, 'projectId')
  requireNonEmptyString(value.name, 'name')
  requireFiniteNumber(value.createdAt, 'createdAt')
  requireFiniteNumber(value.updatedAt, 'updatedAt')
  requireNonEmptyString(value.applicationVersion, 'applicationVersion')
  if (!Array.isArray(value.datasets)) throw new Error('datasets must be an array')
  if (!Array.isArray(value.recipes)) throw new Error('recipes must be an array')
  if (!Array.isArray(value.bookmarks)) throw new Error('bookmarks must be an array')
  if (!isRecord(value.view)) throw new Error('view must be an object')

  const datasetIds = new Set<string>()
  for (const dataset of value.datasets) {
    validateDatasetEntry(dataset)
    if (datasetIds.has(dataset.id)) throw new Error(`Duplicate dataset id: ${dataset.id}`)
    datasetIds.add(dataset.id)
  }

  const recipeIds = new Set<string>()
  for (const recipe of value.recipes) {
    if (!isRecord(recipe)) throw new Error('recipe entries must be objects')
    requireNonEmptyString(recipe.id, 'recipe.id')
    if (recipeIds.has(recipe.id)) throw new Error(`Duplicate recipe id: ${recipe.id}`)
    recipeIds.add(recipe.id)
  }

  for (const dataset of value.datasets) {
    for (const recipeId of dataset.recipeIds) {
      if (!recipeIds.has(recipeId)) throw new Error(`Dataset ${dataset.id} references missing recipe ${recipeId}`)
    }
  }

  validateView(value.view, datasetIds)
  validateBookmarks(value.bookmarks, datasetIds)
}

function validateDatasetEntry(value: unknown): asserts value is ProjectDatasetEntry {
  if (!isRecord(value)) throw new Error('dataset entries must be objects')
  requireNonEmptyString(value.id, 'dataset.id')
  requireNonEmptyString(value.name, 'dataset.name')
  requireNonEmptyString(value.sourceFormat, 'dataset.sourceFormat')
  requireNonEmptyString(value.sourceHash, 'dataset.sourceHash')
  requireNonEmptyString(value.sourceFileName, 'dataset.sourceFileName')
  if (!Array.isArray(value.recipeIds) || !value.recipeIds.every((id) => typeof id === 'string')) {
    throw new Error(`Dataset ${value.id} recipeIds must be a string array`)
  }
  if (typeof value.visible !== 'boolean') throw new Error(`Dataset ${value.id} visible must be boolean`)
  if (value.embeddedDataPath !== undefined && typeof value.embeddedDataPath !== 'string') {
    throw new Error(`Dataset ${value.id} embeddedDataPath must be a string`)
  }
  if (value.externalReference !== undefined && typeof value.externalReference !== 'string') {
    throw new Error(`Dataset ${value.id} externalReference must be a string`)
  }
  if (value.timeOffsetMs !== undefined) requireFiniteNumber(value.timeOffsetMs, `Dataset ${value.id} timeOffsetMs`)
}

function validateView(value: Record<string, unknown>, datasetIds: Set<string>): void {
  if (value.activeDatasetId !== null && typeof value.activeDatasetId !== 'string') {
    throw new Error('view.activeDatasetId must be a string or null')
  }
  if (typeof value.activeDatasetId === 'string' && !datasetIds.has(value.activeDatasetId)) {
    throw new Error(`view.activeDatasetId references missing dataset ${value.activeDatasetId}`)
  }
  if (!isRecord(value.selection)) throw new Error('view.selection must be an object')
  if (!Array.isArray(value.chartLayoutIds) || !value.chartLayoutIds.every((id) => typeof id === 'string')) {
    throw new Error('view.chartLayoutIds must be a string array')
  }
}

function validateBookmarks(bookmarks: unknown[], datasetIds: Set<string>): void {
  const bookmarkIds = new Set<string>()
  for (const bookmark of bookmarks) {
    if (!isRecord(bookmark)) throw new Error('bookmark entries must be objects')
    requireNonEmptyString(bookmark.id, 'bookmark.id')
    requireNonEmptyString(bookmark.label, 'bookmark.label')
    requireNonEmptyString(bookmark.datasetId, 'bookmark.datasetId')
    if (!datasetIds.has(bookmark.datasetId)) throw new Error(`Bookmark ${bookmark.id} references missing dataset ${bookmark.datasetId}`)
    if (bookmarkIds.has(bookmark.id)) throw new Error(`Duplicate bookmark id: ${bookmark.id}`)
    bookmarkIds.add(bookmark.id)
    if (bookmark.timeMs !== undefined) requireFiniteNumber(bookmark.timeMs, `Bookmark ${bookmark.id} timeMs`)
    if (bookmark.pointIndex !== undefined) requireFiniteNumber(bookmark.pointIndex, `Bookmark ${bookmark.id} pointIndex`)
  }
}

function requireNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`)
}

function requireFiniteNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} must be finite`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
