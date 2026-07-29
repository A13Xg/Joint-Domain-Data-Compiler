import { strict as assert } from 'node:assert'
import type { Dataset } from '../src/core/model'
import { EMPTY_WORKSPACE_SELECTION } from '../src/core/selection'
import {
  archiveSummary,
  buildProjectManifest,
  createProjectArchive,
  decodeProjectArchive,
  encodeProjectArchive,
  parseProjectArchive,
  readStreamWithLimit,
  serializeProjectArchive,
} from '../src/persistence/project/archive'
import { namedRecipesFromManifest, operationRecordsFromManifest } from '../src/persistence/project/manifest'
import type { FusionArtifact } from '../src/core/fusion/artifact'
import { ensureBuiltinOperationsRegistered } from '../src/core/operations/basic'
import { executeOperation } from '../src/core/recipes/executor'

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

const fusionArtifact: FusionArtifact = {
  id: 'fusion-archive-1', entityId: 'adhoc', fusedDatasetId: 'track-1',
  sourceRegistrations: [
    { id: 'source-a', entityId: 'adhoc', datasetId: 'track-1', label: 'A', priority: 1 },
    { id: 'source-b', entityId: 'adhoc', datasetId: 'track-1', label: 'B', priority: 2 },
  ],
  timeToleranceMs: 2_000, decisions: [],
  report: { generatedAt: 1, totalGroups: 0, meanConfidence: 0, sourceSummaries: [] }, createdAt: 1,
}
// The archive fixture above cannot use one dataset as both source and output;
// the round-trip test below supplies a valid multi-dataset artifact.
const secondDataset = { ...dataset, id: 'track-2', name: 'Track Two' }
const fusedDataset = { ...dataset, id: 'fused-1', name: 'Fused Track' }
const durableArtifact: FusionArtifact = { ...fusionArtifact, fusedDatasetId: fusedDataset.id, pointOverrides: [{ entityId: 'adhoc', groupId: 'group-1', sourceId: 'source-a' }], intervalOverrides: [{ entityId: 'adhoc', sourceId: 'source-b', startMs: 0, endMs: 10 }], sourceRegistrations: fusionArtifact.sourceRegistrations.map((source, index) => ({ ...source, datasetId: index === 0 ? dataset.id : secondDataset.id })) }
const artifactManifest = buildProjectManifest({ datasets: [dataset, secondDataset, fusedDataset], activeDatasetId: fusedDataset.id, activeTab: 'project', selection: { ...EMPTY_WORKSPACE_SELECTION, datasetId: fusedDataset.id }, applicationVersion: '0.1.0', fusionArtifacts: [durableArtifact] })
assert.equal(artifactManifest.fusionArtifacts[0]?.fusedDatasetId, 'fused-1', 'fusion artifact output link is persisted in the manifest')
const durableArchive = createProjectArchive({ manifest: artifactManifest, datasets: [dataset, secondDataset, fusedDataset], histories: {} })
assert.equal(parseProjectArchive(serializeProjectArchive(durableArchive)).manifest.fusionArtifacts[0]?.id, 'fusion-archive-1', 'fusion artifacts survive archive serialization')
assert.equal(parseProjectArchive(serializeProjectArchive(durableArchive)).manifest.fusionArtifacts[0]?.pointOverrides[0]?.sourceId, 'source-a', 'fusion point overrides survive archive serialization')
const legacyManifest = { ...manifest, schemaVersion: 1 as const }
delete (legacyManifest as { fusionArtifacts?: unknown }).fusionArtifacts
const migratedArchive = parseProjectArchive(JSON.stringify({ schema: 'jddc-project-archive', schemaVersion: 1, manifest: legacyManifest, datasets: [dataset], histories: {} }))
assert.equal(migratedArchive.manifest.schemaVersion, 2, 'legacy archive manifests migrate to schema v2')
assert.throws(() => createProjectArchive({ manifest: buildProjectManifest({ datasets: [dataset, secondDataset], activeDatasetId: dataset.id, activeTab: 'project', selection: { ...EMPTY_WORKSPACE_SELECTION, datasetId: dataset.id }, applicationVersion: '0.1.0', fusionArtifacts: [durableArtifact] }), datasets: [dataset, secondDataset], histories: {} }), /missing fused dataset/)

assert.equal(manifest.bookmarks.length, 1, 'buildProjectManifest threads through caller-provided bookmarks')
assert.equal(manifest.bookmarks[0]?.label, 'Turn point')
assert.equal(manifest.view.datasetDisplay?.[dataset.id]?.opacity, 0.65, 'dataset display settings are persisted')
assert.equal(manifest.recipes.length, 1, 'operation records produce a durable recipe')
assert.equal(manifest.datasets[0]?.recipeIds[0], manifest.recipes[0]?.id, 'dataset references its operation-history recipe')

const namedManifest = buildProjectManifest({
  datasets: [dataset], activeDatasetId: dataset.id, activeTab: 'transform', selection: { ...EMPTY_WORKSPACE_SELECTION, datasetId: dataset.id },
  operationRecords: { [dataset.id]: manifest.recipes[0]!.operations },
  namedRecipes: { [dataset.id]: [{ ...manifest.recipes[0]!, kind: 'named', id: 'recipe_named', name: 'Named offset recipe' }] },
  applicationVersion: '0.1.0',
})
assert.equal(namedManifest.recipes.length, 2, 'named recipes are included beside operation history')
assert.equal(operationRecordsFromManifest(namedManifest)[dataset.id]?.length, 1, 'named recipes do not become operation history')
assert.equal(namedRecipesFromManifest(namedManifest)[dataset.id]?.[0]?.name, 'Named offset recipe', 'named recipes restore independently')

const archive = createProjectArchive({
  manifest,
  datasets: [dataset],
  histories: {
    [dataset.id]: {
      past: [{ ...dataset, points: [] }, { ...dataset, points: dataset.points.slice(0, 1) }],
      future: [],
    },
  },
})

const parsed = parseProjectArchive(serializeProjectArchive(archive))
assert.deepEqual(parsed, archive)
const persistedArchive = JSON.parse(serializeProjectArchive(archive)) as { schemaVersion: number; histories: Record<string, unknown> }
assert.equal(persistedArchive.schemaVersion, 2, 'new archives use the checkpoint/delta schema')
assert.equal(
  (persistedArchive.histories[dataset.id] as { past?: unknown[] }).past?.some((entry) => typeof entry === 'object' && entry !== null && 'points' in entry),
  false,
  'persisted history entries do not contain full dataset snapshots',
)

assert.equal(archiveSummary(parsed).currentPoints, 2)
assert.equal(archiveSummary(parsed).historySnapshots, 2)
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

const corruptedDelta = JSON.parse(serializeProjectArchive(archive)) as { histories: Record<string, { past: unknown[]; future: unknown[]; checkpoint: Dataset | null }> }
const deltaHistory = corruptedDelta.histories[dataset.id]!
const delta = (deltaHistory.past[0] ?? deltaHistory.future[0]) as { outputHash?: string }
if (delta) delta.outputHash = 'fnv1a32:corrupted'
assert.throws(() => parseProjectArchive(JSON.stringify(corruptedDelta)), /delta output fingerprint mismatch/)

ensureBuiltinOperationsRegistered()
const firstOperation = executeOperation(dataset, 'offset-elevation', { meters: 10 })
const secondOperation = executeOperation(firstOperation.dataset, 'offset-elevation', { meters: 10 })
const replayManifest = buildProjectManifest({
  datasets: [secondOperation.dataset], activeDatasetId: secondOperation.dataset.id, activeTab: 'transform',
  selection: { ...EMPTY_WORKSPACE_SELECTION, datasetId: secondOperation.dataset.id }, applicationVersion: '0.1.0',
  operationRecords: { [dataset.id]: [firstOperation.record, secondOperation.record] },
})
const replayArchive = createProjectArchive({
  manifest: replayManifest, datasets: [secondOperation.dataset],
  histories: { [dataset.id]: { past: [dataset, firstOperation.dataset], future: [] } },
})
const replayPersisted = JSON.parse(serializeProjectArchive(replayArchive)) as { histories: Record<string, { past: Array<{ kind: string; operation?: { operationVersion: number } }> }> }
assert.equal(replayPersisted.histories[dataset.id]?.past[0]?.kind, 'operation', 'recorded transforms persist as replayable operation deltas')
const badOperationVersion = JSON.parse(serializeProjectArchive(replayArchive)) as { histories: Record<string, { past: Array<{ operation?: { operationVersion: number } }> }> }
badOperationVersion.histories[dataset.id]!.past[0]!.operation!.operationVersion = 99
assert.throws(() => parseProjectArchive(JSON.stringify(badOperationVersion)), /operation version mismatch/)

console.log('project archive tests passed')
