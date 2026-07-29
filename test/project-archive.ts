import { strict as assert } from 'node:assert'
import type { Dataset } from '../src/core/model'
import { EMPTY_WORKSPACE_SELECTION } from '../src/core/selection'
import { DEFAULT_WORKSPACE_STATE } from '../src/state/workspace'
import { reconcileMapOverlays, type MapOverlay } from '../src/state/mapOverlays'
import {
  archiveSummary,
  buildProjectManifest,
  createProjectArchive,
  decodeProjectArchive,
  encodeProjectArchive,
  parseProjectArchive,
  readStreamWithLimit,
  serializeProjectArchive,
  validateProjectArchive,
} from '../src/persistence/project/archive'
import { operationRecordsFromManifest } from '../src/persistence/project/manifest'

const dataset: Dataset = {
  id: 'track-1',
  name: 'Track One',
  sourceFormat: 'gpx',
  points: [
    { lat: 34, lon: -117, ele: 100, time: 1_000, ext: { speed: 10 } },
    { lat: 34.1, lon: -117.1, ele: 120, time: 2_000, ext: { speed: 12 } },
  ],
  warnings: [],
  channels: ['speed'],
  createdAt: 5_000,
}

const manifest = buildProjectManifest({
  datasets: [dataset],
  activeDatasetId: dataset.id,
  activeTab: 'project',
  selection: {
    ...EMPTY_WORKSPACE_SELECTION,
    datasetId: dataset.id,
    pointIndex: 1,
    indexRange: { start: 0, end: 1 },
  },
  bookmarks: [{ id: 'bm-1', label: 'Turn point', datasetId: dataset.id, pointIndex: 1, timeMs: 2_000 }],
  datasetDisplay: {
    [dataset.id]: { id: dataset.id, visible: false, color: '#157c88', opacity: 0.65, label: 'Primary track' },
  },
  operationRecords: {
    [dataset.id]: [{
      id: 'operation-1',
      operationId: 'derive-standard-kinematics',
      operationVersion: 1,
      params: { engine: 'standard' },
      inputDatasetHash: 'fnv1a32:input',
      outputDatasetHash: 'fnv1a32:output',
      createdAt: 9_000,
      summary: 'Derived standard kinematics',
      warnings: [],
    }],
  },
  projectId: 'project-test',
  projectName: 'Archive Test',
  createdAt: 10_000,
  applicationVersion: '0.1.0',
})

assert.equal(manifest.bookmarks.length, 1, 'buildProjectManifest threads through caller-provided bookmarks')
assert.equal(manifest.bookmarks[0]?.label, 'Turn point')
assert.equal(manifest.view.datasetDisplay?.[dataset.id]?.opacity, 0.65, 'dataset display settings are persisted')
assert.equal(manifest.recipes.length, 1, 'operation records produce a durable recipe')
assert.equal(manifest.datasets[0]?.recipeIds[0], manifest.recipes[0]?.id, 'dataset references its operation-history recipe')

const archive = createProjectArchive({
  manifest,
  datasets: [dataset],
  histories: {
    [dataset.id]: {
      past: [{ ...dataset, points: dataset.points.slice(0, 1) }],
      future: [],
    },
  },
})

const parsed = parseProjectArchive(serializeProjectArchive(archive))
assert.deepEqual(parsed, archive)
assert.equal(archiveSummary(parsed).currentPoints, 2)
assert.equal(archiveSummary(parsed).historySnapshots, 1)
assert.equal(parsed.manifest.view.selection.pointIndex, 1)
assert.equal(parsed.manifest.bookmarks[0]?.id, 'bm-1', 'bookmarks survive the full archive round-trip')
assert.equal(parsed.manifest.view.datasetDisplay?.[dataset.id]?.visible, false, 'dataset display settings survive the full archive round-trip')
assert.equal(
  operationRecordsFromManifest(parsed.manifest)[dataset.id]?.[0]?.summary,
  'Derived standard kinematics',
  'operation history survives the full archive round-trip',
)

const blob = await encodeProjectArchive(archive)
const decoded = await decodeProjectArchive(blob)
assert.deepEqual(decoded, archive)

assert.deepEqual([...await readStreamWithLimit(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3])); controller.close() } }), 3)], [1, 2, 3])
await assert.rejects(() => readStreamWithLimit(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3])); controller.close() } }), 2), /decompressed safety limit/)

const corrupted = JSON.parse(serializeProjectArchive(archive))
corrupted.datasets[0].points[0].lat = 99
assert.throws(() => parseProjectArchive(JSON.stringify(corrupted)), /fingerprint does not match/)

// --- Map overlay state through the full archive round trip ---

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
  visible: true,
  opacity: 0.5,
  zIndex: 1,
  status: 'ready',
}
// Simulate opening a project where the library overlay's backing resource is
// no longer on disk: reconciliation must mark it missing, not drop it.
const reconciledOverlayState = reconcileMapOverlays({ overlays: [bundledOverlay, libraryOverlay] }, new Set(['Special_Use_Airspace.kml']))

const manifestWithOverlays = buildProjectManifest({
  datasets: [dataset],
  activeDatasetId: dataset.id,
  activeTab: 'project',
  selection: EMPTY_WORKSPACE_SELECTION,
  workspace: { ...DEFAULT_WORKSPACE_STATE, mapOverlays: reconciledOverlayState },
  projectId: 'project-overlay-test',
  projectName: 'Overlay Archive Test',
  createdAt: 10_000,
  applicationVersion: '0.1.0',
})

const overlayArchive = createProjectArchive({
  manifest: manifestWithOverlays,
  datasets: [dataset],
  histories: { [dataset.id]: { past: [], future: [] } },
})

const overlayArchiveParsed = parseProjectArchive(serializeProjectArchive(overlayArchive))
const overlaysOut = overlayArchiveParsed.manifest.view.workspace?.mapOverlays.overlays ?? []
assert.equal(overlaysOut.length, 2, 'both overlays survive the archive round trip')
assert.equal(overlaysOut[0]?.status, 'ready', 'available overlay keeps its ready status')
assert.equal(overlaysOut[1]?.status, 'missing', 'unavailable overlay is surfaced as missing, not dropped')
assert.equal(overlaysOut[1]?.sourceKey, 'custom-zone.kml', 'missing overlay retains its source key rather than being deleted')
assert.deepEqual(overlaysOut[0], bundledOverlay, 'available overlay fields (id/sourceKind/sourceKey/name/visibility/opacity/zIndex/status) are unchanged')

// Malformed overlay data embedded directly in an archive payload must be rejected on load, not crash or pass through silently.
const corruptedOverlayArchive = JSON.parse(serializeProjectArchive(overlayArchive))
corruptedOverlayArchive.manifest.view.workspace.mapOverlays.overlays[0].opacity = 7
assert.throws(() => validateProjectArchive(corruptedOverlayArchive), /view\.workspace contains invalid or stale state/, 'archive with out-of-range overlay opacity is rejected')

const corruptedSourceKindArchive = JSON.parse(serializeProjectArchive(overlayArchive))
corruptedSourceKindArchive.manifest.view.workspace.mapOverlays.overlays[0].sourceKind = 'remote'
assert.throws(() => validateProjectArchive(corruptedSourceKindArchive), /view\.workspace contains invalid or stale state/, 'archive with unknown overlay sourceKind is rejected')

// Overlay state must never carry embedded point/dataset payloads.
const overlaySection = JSON.stringify(overlayArchiveParsed.manifest.view.workspace?.mapOverlays)
assert.ok(!/"points"|"lat"|"lon"|"channels"/.test(overlaySection ?? ''), 'overlay state does not duplicate dataset point payloads')

console.log('project archive tests passed')
