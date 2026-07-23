import { EMPTY_WORKSPACE_SELECTION } from '../src/core/selection.ts'
import {
  parseProjectManifest,
  serializeProjectManifest,
  validateProjectManifest,
  type ProjectManifest,
} from '../src/persistence/project/manifest.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const manifest: ProjectManifest = {
  schema: 'jddc-project',
  schemaVersion: 1,
  projectId: 'project-1',
  name: 'Manifest test',
  createdAt: 1000,
  updatedAt: 2000,
  applicationVersion: '0.1.0',
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
  view: {
    activeDatasetId: 'dataset-1',
    selection: { ...EMPTY_WORKSPACE_SELECTION, datasetId: 'dataset-1' },
    chartLayoutIds: [],
  },
}

validateProjectManifest(manifest)
const serialized = serializeProjectManifest(manifest)
const parsed = parseProjectManifest(serialized)
check('Manifest serializes and parses', parsed.projectId === manifest.projectId)
check('Dataset references are preserved', parsed.datasets[0]?.recipeIds[0] === 'recipe-1')
check('Selection is preserved', parsed.view.selection.datasetId === 'dataset-1')

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
  validateProjectManifest({ ...manifest, schemaVersion: 2 })
} catch {
  versionRejected = true
}
check('Unsupported schema versions are rejected', versionRejected)

console.log(`\n${failures === 0 ? 'ALL PROJECT MANIFEST CHECKS PASSED' : `${failures} PROJECT MANIFEST CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
