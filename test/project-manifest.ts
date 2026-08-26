import { EMPTY_WORKSPACE_SELECTION } from '../src/core/selection.ts'
import { DEFAULT_WORKSPACE_STATE } from '../src/state/workspace.ts'
import { reconcileMapOverlays, type MapOverlay } from '../src/state/mapOverlays.ts'
import { DEFAULT_REPORT_OPTIONS, type ReportOptions } from '../src/core/reports/options.ts'
import {
  parseProjectManifest,
  serializeProjectManifest,
  validateProjectManifest,
  namedRecipesFromManifest,
  operationRecordsFromManifest,
  type ProjectManifest,
} from '../src/persistence/project/manifest.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const manifest: ProjectManifest = {
  schema: 'jddc-project',
  schemaVersion: 2,
  projectId: 'project-1',
  name: 'Manifest test',
  createdAt: 1000,
  updatedAt: 2000,
  applicationVersion: '0.1.0',
  notes: 'Analyst handoff note',
  datasets: [
    {
      id: 'dataset-1',
      name: 'track.csv',
      sourceFormat: 'csv',
      sourceHash: 'fnv1a32:12345678',
      sourceFileName: 'track.csv',
      recipeIds: ['recipe-1'],
      visible: true,
    },
  ],
  recipes: [
    {
      schemaVersion: 1,
      id: 'recipe-1',
      name: 'No-op recipe',
      createdAt: 1000,
      sourceDatasetHash: 'fnv1a32:12345678',
      operations: [],
    },
  ],
  bookmarks: [
    { id: 'bookmark-1', label: 'Start', datasetId: 'dataset-1', pointIndex: 0 },
  ],
  fusionArtifacts: [],
  view: {
    activeDatasetId: 'dataset-1',
    selection: { ...EMPTY_WORKSPACE_SELECTION, datasetId: 'dataset-1' },
    chartLayoutIds: [],
    workspace: DEFAULT_WORKSPACE_STATE,
  },
}

validateProjectManifest(manifest)
const serialized = serializeProjectManifest(manifest)
const parsed = parseProjectManifest(serialized)
check('Manifest serializes and parses', parsed.projectId === manifest.projectId)
check('Dataset references are preserved', parsed.datasets[0]?.recipeIds[0] === 'recipe-1')
check('Selection is preserved', parsed.view.selection.datasetId === 'dataset-1')
check('Workspace state is preserved', parsed.view.workspace?.scene3d.gapThresholdSeconds === 3)
check('Project notes are preserved', parsed.notes === 'Analyst handoff note')

const namedRecipeManifest: ProjectManifest = {
  ...manifest,
  datasets: [{ ...manifest.datasets[0]!, recipeIds: ['operations_dataset-1', 'named-1'] }],
  recipes: [
    { ...manifest.recipes[0]!, id: 'operations_dataset-1', name: 'Operation history' },
    { schemaVersion: 1, kind: 'named', id: 'named-1', name: 'Named recipe', createdAt: 1000, sourceDatasetHash: 'fnv1a32:12345678', operations: [] },
  ],
}
check('Named recipes are listed separately from operation history', namedRecipesFromManifest(namedRecipeManifest)['dataset-1']?.[0]?.name === 'Named recipe' && operationRecordsFromManifest(namedRecipeManifest)['dataset-1']?.length === 0)

const malformedNotes = JSON.stringify({ ...manifest, notes: 42 })
let malformedNotesRejected = false
try {
  parseProjectManifest(malformedNotes)
} catch (error) {
  malformedNotesRejected = /notes/.test((error as Error).message)
}
check('Non-text project notes are rejected', malformedNotesRejected)

let invalidJsonRejected = false
try {
  parseProjectManifest('{bad json')
} catch {
  invalidJsonRejected = true
}
check('Invalid JSON is rejected', invalidJsonRejected)

let missingRecipeRejected = false
try {
  validateProjectManifest({
    ...manifest,
    datasets: [{ ...manifest.datasets[0], recipeIds: ['missing-recipe'] }],
  })
} catch {
  missingRecipeRejected = true
}
check('Missing recipe references are rejected', missingRecipeRejected)

let missingDatasetRejected = false
try {
  validateProjectManifest({
    ...manifest,
    bookmarks: [{ id: 'bad-bookmark', label: 'Bad', datasetId: 'missing' }],
  })
} catch {
  missingDatasetRejected = true
}
check('Missing dataset references are rejected', missingDatasetRejected)

let duplicateDatasetRejected = false
try {
  validateProjectManifest({
    ...manifest,
    datasets: [manifest.datasets[0], { ...manifest.datasets[0] }],
  })
} catch {
  duplicateDatasetRejected = true
}
check('Duplicate dataset ids are rejected', duplicateDatasetRejected)

let versionRejected = false
try {
  validateProjectManifest({ ...manifest, schemaVersion: 3 })
} catch {
  versionRejected = true
}
check('Unsupported schema versions are rejected', versionRejected)

let malformedOperationRejected = false
try {
  validateProjectManifest({
    ...manifest,
    recipes: [{
      ...manifest.recipes[0],
      operations: [{ id: 'bad', operationId: 'derive', operationVersion: 0 }],
    }],
  })
} catch {
  malformedOperationRejected = true
}
check('Malformed persisted operation records are rejected', malformedOperationRejected)

let staleDisplayRejected = false
try {
  validateProjectManifest({
    ...manifest,
    view: {
      ...manifest.view,
      datasetDisplay: {
        ghost: { id: 'ghost', visible: true, color: '#157c88', opacity: 1, label: 'Ghost' },
      },
    },
  })
} catch {
  staleDisplayRejected = true
}
check('Stale persisted dataset display settings are rejected', staleDisplayRejected)

// --- Map overlay state: round trip, malformed rejection, missing reconciliation ---

const bundledOverlay: MapOverlay = {
  id: 'bundled:special-use-airspace',
  sourceKind: 'bundled',
  sourceKey: 'Special_Use_Airspace.kml',
  name: 'Special Use Airspace',
  visible: true,
  opacity: 0.75,
  zIndex: 0,
  status: 'ready',
}

const libraryOverlay: MapOverlay = {
  id: 'library:custom-zone',
  sourceKind: 'library',
  sourceKey: 'custom-zone.kml',
  name: 'Custom Zone',
  visible: false,
  opacity: 0.3,
  zIndex: 1,
  status: 'ready',
}

const manifestWithOverlays: ProjectManifest = {
  ...manifest,
  view: {
    ...manifest.view,
    workspace: { ...DEFAULT_WORKSPACE_STATE, mapOverlays: { overlays: [bundledOverlay, libraryOverlay] } },
  },
}

validateProjectManifest(manifestWithOverlays)
const overlayParsed = parseProjectManifest(serializeProjectManifest(manifestWithOverlays))
const overlays = overlayParsed.view.workspace?.mapOverlays.overlays ?? []
check('Bundled overlay round-trips unchanged', JSON.stringify(overlays[0]) === JSON.stringify(bundledOverlay))
check('Library overlay round-trips unchanged', JSON.stringify(overlays[1]) === JSON.stringify(libraryOverlay))
check('Overlay count is preserved', overlays.length === 2)

let overlayOpacityRejected = false
try {
  validateProjectManifest({
    ...manifest,
    view: {
      ...manifest.view,
      workspace: { ...DEFAULT_WORKSPACE_STATE, mapOverlays: { overlays: [{ ...bundledOverlay, opacity: 1.5 }] } },
    },
  })
} catch {
  overlayOpacityRejected = true
}
check('Overlay opacity outside [0,1] is rejected', overlayOpacityRejected)

let overlayNegativeOpacityRejected = false
try {
  validateProjectManifest({
    ...manifest,
    view: {
      ...manifest.view,
      workspace: { ...DEFAULT_WORKSPACE_STATE, mapOverlays: { overlays: [{ ...bundledOverlay, opacity: -0.1 }] } },
    },
  })
} catch {
  overlayNegativeOpacityRejected = true
}
check('Overlay opacity below 0 is rejected', overlayNegativeOpacityRejected)

let overlayUnknownSourceKindRejected = false
try {
  validateProjectManifest({
    ...manifest,
    view: {
      ...manifest.view,
      workspace: { ...DEFAULT_WORKSPACE_STATE, mapOverlays: { overlays: [{ ...bundledOverlay, sourceKind: 'remote' }] } },
    },
  })
} catch {
  overlayUnknownSourceKindRejected = true
}
check('Overlay with unknown sourceKind is rejected', overlayUnknownSourceKindRejected)

let overlayUnsafeSourceKeyRejected = false
try {
  validateProjectManifest({
    ...manifest,
    view: {
      ...manifest.view,
      workspace: { ...DEFAULT_WORKSPACE_STATE, mapOverlays: { overlays: [{ ...bundledOverlay, sourceKey: '../../etc/escape.kml' }] } },
    },
  })
} catch {
  overlayUnsafeSourceKeyRejected = true
}
check('Overlay with path-traversal sourceKey is rejected', overlayUnsafeSourceKeyRejected)

let overlayGarbageStringRejected = false
try {
  validateProjectManifest({
    ...manifest,
    view: {
      ...manifest.view,
      workspace: {
        ...DEFAULT_WORKSPACE_STATE,
        mapOverlays: { overlays: [{ ...bundledOverlay, name: 'x'.repeat(1_000_000), sourceKey: 'y'.repeat(1_000_000) }] },
      },
    },
  })
} catch {
  overlayGarbageStringRejected = true
}
check('Overlay with oversized garbage strings is rejected rather than silently passed through', overlayGarbageStringRejected)

let overlayZIndexRejected = false
try {
  validateProjectManifest({
    ...manifest,
    view: {
      ...manifest.view,
      workspace: { ...DEFAULT_WORKSPACE_STATE, mapOverlays: { overlays: [{ ...bundledOverlay, zIndex: -1 }] } },
    },
  })
} catch {
  overlayZIndexRejected = true
}
check('Overlay with negative zIndex is rejected', overlayZIndexRejected)

// Missing overlay resources are surfaced as an 'unavailable' (missing) status via
// reconcileMapOverlays, not silently dropped, and that status survives a manifest round trip.
const reconciled = reconcileMapOverlays({ overlays: [bundledOverlay, libraryOverlay] }, new Set(['custom-zone.kml']))
check('Reconciliation marks the unavailable overlay missing', reconciled.overlays[0]?.status === 'missing' && reconciled.overlays[0]?.visible === false)
check('Reconciliation leaves the available overlay untouched', reconciled.overlays[1]?.status === 'ready' && reconciled.overlays[1]?.visible === false)
check('Reconciliation keeps both overlays present (not deleted)', reconciled.overlays.length === 2)

const manifestWithReconciledOverlays: ProjectManifest = {
  ...manifest,
  view: { ...manifest.view, workspace: { ...DEFAULT_WORKSPACE_STATE, mapOverlays: reconciled } },
}
validateProjectManifest(manifestWithReconciledOverlays)
const reconciledParsed = parseProjectManifest(serializeProjectManifest(manifestWithReconciledOverlays))
const reconciledOverlays = reconciledParsed.view.workspace?.mapOverlays.overlays ?? []
check('Missing overlay status survives a manifest round trip', reconciledOverlays[0]?.status === 'missing')
check('Missing overlay is still present after round trip (not silently dropped)', reconciledOverlays.length === 2)

// Overlay state must not embed dataset/point payloads: only the known scalar
// overlay fields may appear anywhere under view.workspace.mapOverlays.
const overlayJson = JSON.stringify(manifestWithOverlays.view.workspace?.mapOverlays)
const allowedOverlayKeys = new Set(['overlays', 'id', 'sourceKind', 'sourceKey', 'name', 'visible', 'opacity', 'zIndex', 'status'])
const overlayKeysOnly = Object.keys(JSON.parse(overlayJson ?? '{}').overlays[0]).every((key: string) => allowedOverlayKeys.has(key))
check('Overlay JSON does not contain point/dataset payload keys', overlayKeysOnly && !/"points"|"lat"|"lon"|"channels"/.test(overlayJson ?? ''))

// --- Task 3.3: reportPreferences persistence -----------------------------
// Absent by default (older archives / projects that never opted in), an
// explicitly opted-in value round-trips exactly, and malformed values are
// normalized to safe defaults rather than rejecting the whole manifest.

check('Absent reportPreferences round-trips as absent (backward compat)', parsed.view.workspace?.reportPreferences === undefined)

const rememberedOptions: ReportOptions = {
  ...DEFAULT_REPORT_OPTIONS,
  title: 'Remembered report title',
  includeComparison: true,
  includeFusion: true,
  includeOverlayInventory: true,
}

const manifestWithRememberedPreferences: ProjectManifest = {
  ...manifest,
  view: {
    ...manifest.view,
    workspace: { ...DEFAULT_WORKSPACE_STATE, reportPreferences: rememberedOptions },
  },
}
validateProjectManifest(manifestWithRememberedPreferences)
const rememberedParsed = parseProjectManifest(serializeProjectManifest(manifestWithRememberedPreferences))
check(
  'Remembered reportPreferences round-trip correctly',
  JSON.stringify(rememberedParsed.view.workspace?.reportPreferences) === JSON.stringify(rememberedOptions),
)

let malformedPreferencesThrew = false
let malformedPreferencesParsed: ProjectManifest | undefined
try {
  malformedPreferencesParsed = parseProjectManifest(JSON.stringify({
    ...manifest,
    view: {
      ...manifest.view,
      workspace: {
        ...DEFAULT_WORKSPACE_STATE,
        reportPreferences: { title: 12345, includeWarnings: 'yes', includeComparison: true, bogusField: 'ignored' },
      },
    },
  }))
} catch {
  malformedPreferencesThrew = true
}
check('Malformed reportPreferences normalize to safe defaults rather than throwing', !malformedPreferencesThrew)
check(
  'Malformed reportPreferences title/boolean fields fall back to defaults',
  malformedPreferencesParsed?.view.workspace?.reportPreferences?.title === DEFAULT_REPORT_OPTIONS.title
    && malformedPreferencesParsed?.view.workspace?.reportPreferences?.includeWarnings === DEFAULT_REPORT_OPTIONS.includeWarnings,
)
check(
  'Malformed reportPreferences still honors well-formed fields (only bad fields fall back)',
  malformedPreferencesParsed?.view.workspace?.reportPreferences?.includeComparison === true,
)

let nonObjectPreferencesThrew = false
let nonObjectPreferencesParsed: ProjectManifest | undefined
try {
  nonObjectPreferencesParsed = parseProjectManifest(JSON.stringify({
    ...manifest,
    view: {
      ...manifest.view,
      workspace: { ...DEFAULT_WORKSPACE_STATE, reportPreferences: 'not-an-object' },
    },
  }))
} catch {
  nonObjectPreferencesThrew = true
}
check('Non-object reportPreferences normalizes to defaults rather than throwing', !nonObjectPreferencesThrew)
check(
  'Non-object reportPreferences falls back to DEFAULT_REPORT_OPTIONS entirely',
  JSON.stringify(nonObjectPreferencesParsed?.view.workspace?.reportPreferences) === JSON.stringify(DEFAULT_REPORT_OPTIONS),
)

// reportPreferences must only ever hold the small ReportOptions shape: no
// raw dataset/point payload should ever survive into persisted state, even
// if a caller/attacker tries to smuggle it in under a known-looking field.
const smuggledPreferencesParsed = parseProjectManifest(JSON.stringify({
  ...manifest,
  view: {
    ...manifest.view,
    workspace: {
      ...DEFAULT_WORKSPACE_STATE,
      reportPreferences: {
        ...DEFAULT_REPORT_OPTIONS,
        points: [{ lat: 1, lon: 2, time: 3 }],
        datasets: [{ id: 'x', points: [{ lat: 1, lon: 2 }] }],
      },
    },
  },
}))
const preferencesKeys = Object.keys(smuggledPreferencesParsed.view.workspace?.reportPreferences ?? {})
const allowedPreferenceKeys = new Set<string>([
  'title', 'includeSourceMetadata', 'includeWarnings', 'includeQualityEvents', 'includeBookmarks',
  'includeOperationHistory', 'includeComparison', 'includeFusion', 'includeNotionalDisclosure', 'includeOverlayInventory',
])
check(
  'reportPreferences only ever contains the known ReportOptions keys (no smuggled dataset/point payload)',
  preferencesKeys.every((key) => allowedPreferenceKeys.has(key))
    && !JSON.stringify(smuggledPreferencesParsed.view.workspace?.reportPreferences).includes('"points"'),
)

// --- Tier-2 fix: validateProjectManifest must not mutate its input --------
// It used to normalize view.workspace.reportPreferences in place; it now
// returns a normalized manifest instead, leaving the caller's object alone.

const preMutationSnapshot = JSON.parse(JSON.stringify({
  ...manifest,
  view: {
    ...manifest.view,
    workspace: {
      ...DEFAULT_WORKSPACE_STATE,
      reportPreferences: { title: 12345, includeWarnings: 'yes', includeComparison: true, bogusField: 'ignored' },
    },
  },
}))
const inputWithMalformedPreferences = JSON.parse(JSON.stringify(preMutationSnapshot))
const returnedFromValidate = validateProjectManifest(inputWithMalformedPreferences)
check(
  'validateProjectManifest does not mutate its input argument',
  JSON.stringify(inputWithMalformedPreferences) === JSON.stringify(preMutationSnapshot),
)
check(
  'validateProjectManifest still returns a manifest with malformed reportPreferences normalized',
  returnedFromValidate.view.workspace?.reportPreferences?.title === DEFAULT_REPORT_OPTIONS.title
    && returnedFromValidate.view.workspace?.reportPreferences?.includeComparison === true,
)
check(
  'validateProjectManifest returns a different reportPreferences object than the (untouched) input',
  returnedFromValidate.view.workspace?.reportPreferences !== (inputWithMalformedPreferences as ProjectManifest).view.workspace?.reportPreferences,
)

// Same guarantee via parseProjectManifest's JSON round trip, and confirming
// valid reportPreferences are preserved exactly (not just normalized away).
const validPreferencesSnapshotSource = JSON.parse(JSON.stringify(manifestWithRememberedPreferences))
const validPreferencesJson = JSON.stringify(manifestWithRememberedPreferences)
const parsedValidPreferences = parseProjectManifest(validPreferencesJson)
check(
  'parseProjectManifest does not mutate the object backing its JSON input',
  JSON.stringify(validPreferencesSnapshotSource) === JSON.stringify(manifestWithRememberedPreferences),
)
check(
  'parseProjectManifest preserves valid reportPreferences exactly in its returned manifest',
  JSON.stringify(parsedValidPreferences.view.workspace?.reportPreferences) === JSON.stringify(rememberedOptions),
)

console.log(`\n${failures === 0 ? 'ALL PROJECT MANIFEST CHECKS PASSED' : `${failures} PROJECT MANIFEST CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
