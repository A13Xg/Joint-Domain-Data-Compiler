import { strict as assert } from 'node:assert'
import { DEFAULT_WORKSPACE_STATE, normalizeWorkspaceState } from '../src/state/workspace.ts'

const datasetIds = new Set(['a', 'b'])
assert.deepEqual(normalizeWorkspaceState(undefined, datasetIds), DEFAULT_WORKSPACE_STATE)
assert.equal(normalizeWorkspaceState({ lastWorkspaceTab: 'project' }, datasetIds).lastWorkspaceTab, 'overview')
assert.equal(normalizeWorkspaceState({ map: { basemap: 'bad', maxGapMinutes: -1 } }, datasetIds).map.basemap, 'osm')
assert.equal(normalizeWorkspaceState({ comparison: { referenceDatasetId: 'a', targetDatasetId: 'missing' } }, datasetIds).comparison.targetDatasetId, null)
console.log('workspace state tests passed')
