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
  serializeProjectArchive,
} from '../src/persistence/project/archive'

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
  projectId: 'project-test',
  projectName: 'Archive Test',
  createdAt: 10_000,
  applicationVersion: '0.1.0',
})

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

const blob = await encodeProjectArchive(archive)
const decoded = await decodeProjectArchive(blob)
assert.deepEqual(decoded, archive)

const corrupted = JSON.parse(serializeProjectArchive(archive))
corrupted.datasets[0].points[0].lat = 99
assert.throws(() => parseProjectArchive(JSON.stringify(corrupted)), /fingerprint does not match/)

console.log('project archive tests passed')
