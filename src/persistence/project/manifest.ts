import type { OperationRecord, Recipe } from '../../core/recipes/model'
import type { WorkspaceSelection } from '../../core/selection'
import { normalizeWorkspaceState, type WorkspaceState } from '../../state/workspace'
import { isValidWorkspaceDisplay, type WorkspaceDisplay } from '../../state/workspaceDisplay'
import { migrateToVersion, PROJECT_MANIFEST_MIGRATORS } from './migrations'
import type { FusionArtifact } from '../../core/fusion/artifact'
import { validateFusionArtifact } from '../../core/fusion/artifact'

const CURRENT_MANIFEST_SCHEMA_VERSION = 2

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
  workspace?: WorkspaceState
  datasetDisplay?: WorkspaceDisplay
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

export interface ProjectManifestV2 extends Omit<ProjectManifestV1, 'schemaVersion'> {
  schemaVersion: 2
  fusionArtifacts: FusionArtifact[]
}

export type ProjectManifest = ProjectManifestV2

export function serializeProjectManifest(manifest: ProjectManifest): string {
  const validated = validateProjectManifest(manifest)
  return JSON.stringify(validated, null, 2)
}

export function parseProjectManifest(text: string): ProjectManifest {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`Project manifest is not valid JSON: ${errorMessage(error)}`, { cause: error })
  }
  const migrated = migrateToVersion(value, CURRENT_MANIFEST_SCHEMA_VERSION, PROJECT_MANIFEST_MIGRATORS)
  return validateProjectManifest(migrated)
}

/**
 * Validates an untrusted value as a `ProjectManifest`. Throws on structural
 * errors. Never mutates `value`: `view.workspace.reportPreferences` (the one
 * field that is normalized rather than rejected — see `validateView`) is
 * normalized into a freshly-built manifest that is returned to the caller,
 * so a caller that reuses the same object elsewhere is never surprised by
 * an in-place write.
 */
export function validateProjectManifest(value: unknown): ProjectManifest {
  if (!isRecord(value)) throw new Error('Project manifest must be an object')
  if (value.schema !== 'jddc-project') throw new Error('Unsupported project manifest schema')
  if (value.schemaVersion !== 2) throw new Error(`Unsupported project manifest version: ${String(value.schemaVersion)}`)
  requireNonEmptyString(value.projectId, 'projectId')
  requireNonEmptyString(value.name, 'name')
  requireFiniteNumber(value.createdAt, 'createdAt')
  requireFiniteNumber(value.updatedAt, 'updatedAt')
  requireNonEmptyString(value.applicationVersion, 'applicationVersion')
  if (value.notes !== undefined && typeof value.notes !== 'string') throw new Error('notes must be a string')
  if (!Array.isArray(value.datasets)) throw new Error('datasets must be an array')
  if (!Array.isArray(value.recipes)) throw new Error('recipes must be an array')
  if (!Array.isArray(value.bookmarks)) throw new Error('bookmarks must be an array')
  if (!Array.isArray(value.fusionArtifacts)) throw new Error('fusionArtifacts must be an array')
  if (!isRecord(value.view)) throw new Error('view must be an object')

  const datasetIds = new Set<string>()
  for (const dataset of value.datasets) {
    validateDatasetEntry(dataset)
    if (datasetIds.has(dataset.id)) throw new Error(`Duplicate dataset id: ${dataset.id}`)
    datasetIds.add(dataset.id)
  }

  const artifactIds = new Set<string>()
  for (const artifact of value.fusionArtifacts) {
    validateFusionArtifact(artifact)
    if (artifactIds.has(artifact.id)) throw new Error(`Duplicate fusion artifact id: ${artifact.id}`)
    artifactIds.add(artifact.id)
    if (!datasetIds.has(artifact.fusedDatasetId)) throw new Error(`Fusion artifact ${artifact.id} references missing fused dataset ${artifact.fusedDatasetId}`)
    for (const source of artifact.sourceRegistrations) {
      if (!datasetIds.has(source.datasetId)) throw new Error(`Fusion artifact ${artifact.id} references missing source dataset ${source.datasetId}`)
      if (source.entityId !== artifact.entityId) throw new Error(`Fusion artifact ${artifact.id} source ${source.id} has a mismatched entity`)
    }
    if (artifact.sourceRegistrations.some((source) => source.datasetId === artifact.fusedDatasetId)) {
      throw new Error(`Fusion artifact ${artifact.id} fused dataset cannot also be a source dataset`)
    }
  }

  const recipeIds = new Set<string>()
  for (const recipe of value.recipes) {
    validateRecipe(recipe)
    if (recipeIds.has(recipe.id)) throw new Error(`Duplicate recipe id: ${recipe.id}`)
    recipeIds.add(recipe.id)
  }

  for (const dataset of value.datasets) {
    for (const recipeId of dataset.recipeIds) {
      if (!recipeIds.has(recipeId)) throw new Error(`Dataset ${dataset.id} references missing recipe ${recipeId}`)
    }
  }

  const normalizedWorkspace = validateView(value.view, datasetIds)
  validateBookmarks(value.bookmarks, datasetIds)
  return withNormalizedReportPreferences(value as unknown as ProjectManifest, normalizedWorkspace)
}

/**
 * Builds the manifest to return to the caller, substituting the normalized
 * `reportPreferences` computed by `validateView` (via `normalizeWorkspaceState`)
 * in place of whatever malformed/stale value was persisted. Returns the
 * original `value` unchanged (same reference) when there is nothing to
 * normalize, and otherwise builds a shallow clone rather than writing
 * through to the input — the input manifest is never mutated.
 */
function withNormalizedReportPreferences(value: ProjectManifest, normalizedWorkspace: WorkspaceState | undefined): ProjectManifest {
  if (normalizedWorkspace === undefined || normalizedWorkspace.reportPreferences === undefined) return value
  // Every field of `normalizedWorkspace` other than reportPreferences has
  // already been checked structurally equal to `value.view.workspace` by
  // validateView's equality check, so it is safe to use wholesale here
  // rather than re-spreading the (possibly-undefined-typed) original.
  return {
    ...value,
    view: {
      ...value.view,
      workspace: normalizedWorkspace,
    },
  }
}

export function operationRecordsFromManifest(manifest: ProjectManifest): Record<string, OperationRecord[]> {
  const recipesById = new Map(manifest.recipes.map((recipe) => [recipe.id, recipe]))
  return Object.fromEntries(manifest.datasets.map((dataset) => [
    dataset.id,
    dataset.recipeIds.filter((recipeId) => recipesById.get(recipeId)?.kind !== 'named').flatMap((recipeId) => recipesById.get(recipeId)?.operations ?? []),
  ]))
}

/** Returns user-named recipes without treating them as live operation history. */
export function namedRecipesFromManifest(manifest: ProjectManifest): Record<string, Recipe[]> {
  const recipesById = new Map(manifest.recipes.map((recipe) => [recipe.id, recipe]))
  return Object.fromEntries(manifest.datasets.map((dataset) => [
    dataset.id,
    dataset.recipeIds.filter((recipeId) => recipesById.get(recipeId)?.kind === 'named').flatMap((recipeId) => {
      const recipe = recipesById.get(recipeId)
      return recipe ? [structuredClone(recipe)] : []
    }),
  ]))
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

function validateRecipe(value: unknown): asserts value is Recipe {
  if (!isRecord(value)) throw new Error('recipe entries must be objects')
  if (value.schemaVersion !== 1) throw new Error(`Unsupported recipe schema version: ${String(value.schemaVersion)}`)
  requireNonEmptyString(value.id, 'recipe.id')
  if (value.kind !== undefined && value.kind !== 'named' && value.kind !== 'operation-history') throw new Error(`Recipe ${value.id} kind is invalid`)
  requireNonEmptyString(value.name, `Recipe ${value.id} name`)
  requireFiniteNumber(value.createdAt, `Recipe ${value.id} createdAt`)
  requireNonEmptyString(value.sourceDatasetHash, `Recipe ${value.id} sourceDatasetHash`)
  if (!Array.isArray(value.operations)) throw new Error(`Recipe ${value.id} operations must be an array`)
  for (const operation of value.operations) validateOperationRecord(operation, value.id)
}

function validateOperationRecord(value: unknown, recipeId: string): asserts value is OperationRecord {
  if (!isRecord(value)) throw new Error(`Recipe ${recipeId} operation entries must be objects`)
  requireNonEmptyString(value.id, `Recipe ${recipeId} operation.id`)
  requireNonEmptyString(value.operationId, `Recipe ${recipeId} operation.operationId`)
  if (!Number.isSafeInteger(value.operationVersion) || (value.operationVersion as number) < 1) {
    throw new Error(`Recipe ${recipeId} operation.operationVersion must be a positive safe integer`)
  }
  requireNonEmptyString(value.inputDatasetHash, `Recipe ${recipeId} operation.inputDatasetHash`)
  if (value.outputDatasetHash !== undefined) requireNonEmptyString(value.outputDatasetHash, `Recipe ${recipeId} operation.outputDatasetHash`)
  requireFiniteNumber(value.createdAt, `Recipe ${recipeId} operation.createdAt`)
  if (typeof value.summary !== 'string') throw new Error(`Recipe ${recipeId} operation.summary must be a string`)
  if (!Array.isArray(value.warnings) || !value.warnings.every((warning) => typeof warning === 'string')) {
    throw new Error(`Recipe ${recipeId} operation.warnings must be a string array`)
  }
  if (value.scope !== undefined) {
    if (!isRecord(value.scope)) throw new Error(`Recipe ${recipeId} operation.scope must be an object`)
    validateRange(value.scope.indexRange, `Recipe ${recipeId} operation.scope.indexRange`)
    validateRange(value.scope.timeRange, `Recipe ${recipeId} operation.scope.timeRange`)
  }
}

function validateRange(value: unknown, field: string): void {
  if (value === undefined) return
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  requireFiniteNumber(value.start, `${field}.start`)
  requireFiniteNumber(value.end, `${field}.end`)
}

/**
 * Validates `view`, throwing on any structurally invalid or stale field.
 * Returns the normalized workspace state (computed once here, via
 * `normalizeWorkspaceState`) so `validateProjectManifest` can reuse its
 * already-normalized `reportPreferences` instead of recomputing it — the
 * caller decides what, if anything, to do with the normalized value, so
 * this function does not itself write anywhere.
 */
function validateView(value: Record<string, unknown>, datasetIds: Set<string>): WorkspaceState | undefined {
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
  let normalizedWorkspace: WorkspaceState | undefined
  if (value.workspace !== undefined) {
    if (!isRecord(value.workspace)) throw new Error('view.workspace contains invalid or stale state')
    const normalized = normalizeWorkspaceState(value.workspace, datasetIds)
    // reportPreferences is intentionally excluded from this structural
    // equality check: `normalized.reportPreferences` is normalized (not
    // rejected) rather than compared for equality, so a malformed/stale
    // persisted value there must not fail the whole manifest's structural
    // check. The normalized value is still returned above for the caller
    // to fold into the manifest it hands back.
    if (JSON.stringify(omitReportPreferences(normalized as unknown as Record<string, unknown>)) !== JSON.stringify(omitReportPreferences(value.workspace))) {
      throw new Error('view.workspace contains invalid or stale state')
    }
    normalizedWorkspace = normalized
  }
  if (value.datasetDisplay !== undefined && !isValidWorkspaceDisplay(value.datasetDisplay, datasetIds)) {
    throw new Error('view.datasetDisplay contains invalid or stale settings')
  }
  return normalizedWorkspace
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

function omitReportPreferences(value: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...value }
  delete copy.reportPreferences
  return copy
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
