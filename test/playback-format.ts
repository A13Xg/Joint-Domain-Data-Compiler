// Playback format (.jddc-playback) tests: serialization round-trip, metadata
// preservation, provenance preservation, and the dangling-reference/display-
// scoping bugs found and fixed while wiring this up (see
// docs/superpowers/specs/2026-09-27-jddc-suite-design.md §11).
import { strict as assert } from 'node:assert'
import type { Dataset } from '../src/core/model'
import {
  buildPlaybackArchive,
  decodePlaybackArchive,
  encodePlaybackArchive,
  encodePlaybackArchiveUncompressed,
} from '../src/persistence/playback'
import { validateProjectManifest, type ProjectManifest } from '../src/persistence/project/manifest'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const datasetA: Dataset = {
  id: 'track-a',
  name: 'Alpha.gpx',
  sourceFormat: 'gpx',
  points: [
    { lat: 34, lon: -117, ele: 100, time: 1_000, ext: { ground_speed_mps: 200 } },
    { lat: 34.1, lon: -117.1, ele: 200, time: 2_000, ext: { ground_speed_mps: 210 } },
  ],
  warnings: [],
  channels: ['ground_speed_mps'],
  createdAt: 5_000,
  metadata: {
    coordinateSystem: 'EPSG:4326',
    altitudeReference: 'HAE',
    timeReference: 'UTC',
    channels: [],
    source: { filename: 'Alpha.gpx', importedAt: 4_000, parserId: 'gpx', parserVersion: '1' },
  },
}

const datasetB: Dataset = {
  id: 'track-b',
  name: 'Bravo.csv',
  sourceFormat: 'csv',
  points: [
    { lat: 35, lon: -116, ele: 300, time: 1_000 },
  ],
  warnings: [],
  channels: [],
  createdAt: 5_500,
}

// --- Provenance and metadata preservation ---
const archive = buildPlaybackArchive({
  datasets: [datasetA, datasetB],
  datasetMetadata: {
    [datasetA.id]: { callsign: 'EAGLE1', aircraftType: 'F-16C' },
  },
  datasetDisplay: {
    [datasetA.id]: { id: datasetA.id, visible: true, color: '#ea4f2f', opacity: 1, label: 'Alpha' },
    // Deliberately includes an entry for a dataset NOT in this export — the
    // real bug (isValidWorkspaceDisplay rejects unscoped extras) this test guards.
    'track-not-exported': { id: 'track-not-exported', visible: true, color: '#3b82f6', opacity: 1, label: 'Other' },
  },
  scenarioName: 'Test Scenario',
  applicationVersion: '0.8.0-test',
})

const entryA = archive.manifest.datasets.find((d) => d.id === datasetA.id)
const entryB = archive.manifest.datasets.find((d) => d.id === datasetB.id)

check('dataset A keeps its original sourceFormat (not rewritten to jddc-playback)', entryA?.sourceFormat === 'gpx')
check('dataset A keeps its original sourceFileName', entryA?.sourceFileName === 'Alpha.gpx')
check('dataset A callsign is set', entryA?.callsign === 'EAGLE1')
check('dataset A aircraftType is set', entryA?.aircraftType === 'F-16C')
check('dataset A color is carried from datasetDisplay', entryA?.color === '#ea4f2f')
check('dataset B has no callsign (none supplied)', entryB?.callsign === undefined)
check('dataset B keeps its original sourceFormat', entryB?.sourceFormat === 'csv')
check('manifest.recipes is empty by construction (no recipes/operationRecords passed)', archive.manifest.recipes.length === 0)
check('manifest.fusionArtifacts is empty by construction', archive.manifest.fusionArtifacts.length === 0)
check('manifest.bookmarks is empty by construction', archive.manifest.bookmarks.length === 0)
check('archive.histories has an empty entry per dataset, not omitted', Object.keys(archive.histories).length === 2)
check('archive.histories.past is empty (playback carries no undo history)', archive.histories[datasetA.id]?.past.length === 0)
check(
  'view.datasetDisplay only includes the exported subset (extra entry for a non-exported dataset was scoped out)',
  Object.keys((archive.manifest.view.datasetDisplay as Record<string, unknown>) ?? {}).length === 1,
)

// createProjectArchive already runs validateProjectArchive internally, so
// reaching this point without throwing is itself a structural-validity check.
check('manifest passes validateProjectManifest standalone', Boolean(validateProjectManifest(archive.manifest)))

// --- Gzip round-trip ---
const roundTrip = async () => {
  const compressedBlob = await encodePlaybackArchive(archive)
  const decodedCompressed = await decodePlaybackArchive(compressedBlob)
  check('gzip round-trip preserves dataset count', decodedCompressed.datasets.length === 2)
  check('gzip round-trip preserves point data exactly', JSON.stringify(decodedCompressed.datasets) === JSON.stringify(archive.datasets))
  check('gzip round-trip preserves callsign', decodedCompressed.manifest.datasets.find((d) => d.id === datasetA.id)?.callsign === 'EAGLE1')

  const uncompressedBlob = encodePlaybackArchiveUncompressed(archive)
  check('uncompressed export starts as plain JSON (not gzip magic bytes)', (await uncompressedBlob.text()).trimStart().startsWith('{'))
  const decodedUncompressed = await decodePlaybackArchive(uncompressedBlob)
  check('uncompressed round-trip preserves dataset count', decodedUncompressed.datasets.length === 2)
  check(
    'uncompressed round-trip preserves manifest exactly (structurally identical after validation normalization)',
    JSON.stringify(decodedUncompressed.manifest) === JSON.stringify(archive.manifest),
  )

  console.log(`\n${failures === 0 ? 'ALL PLAYBACK FORMAT CHECKS PASSED' : `${failures} PLAYBACK FORMAT CHECK(S) FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}

// --- manifest.ts field validation (invalid inputs must reject loudly) ---
function validManifestWith(datasetPatch: Record<string, unknown>): ProjectManifest {
  return {
    schema: 'jddc-project',
    schemaVersion: 2,
    projectId: 'p1',
    name: 'n',
    createdAt: 1,
    updatedAt: 2,
    applicationVersion: '0.1.0',
    datasets: [{
      id: 'd1', name: 'd', sourceFormat: 'gpx', sourceHash: 'h', sourceFileName: 'f', recipeIds: [], visible: true,
      ...datasetPatch,
    }],
    recipes: [],
    bookmarks: [],
    fusionArtifacts: [],
    view: { activeDatasetId: null, selection: {} as never, chartLayoutIds: [] },
  } as unknown as ProjectManifest
}

assert.throws(() => validateProjectManifest(validManifestWith({ callsign: 42 })), /callsign must be a string/, 'rejects non-string callsign')
assert.throws(() => validateProjectManifest(validManifestWith({ aircraftType: 42 })), /aircraftType must be a string/, 'rejects non-string aircraftType')
assert.throws(() => validateProjectManifest(validManifestWith({ color: 'red' })), /color must be a #rrggbb string/, 'rejects non-hex color')
assert.doesNotThrow(() => validateProjectManifest(validManifestWith({ color: '#ff00aa', callsign: 'X', aircraftType: 'Y' })), 'accepts valid suite metadata fields')
console.log('  [PASS] manifest validation rejects malformed suite-metadata fields and accepts valid ones')

void roundTrip()
