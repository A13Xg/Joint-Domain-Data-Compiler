import { strict as assert } from 'node:assert'
import { DEFAULT_WORKSPACE_STATE, normalizeWorkspaceState } from '../src/state/workspace.ts'

const datasetIds = new Set(['a', 'b'])
assert.deepEqual(normalizeWorkspaceState(undefined, datasetIds), DEFAULT_WORKSPACE_STATE)
assert.equal(normalizeWorkspaceState({ lastWorkspaceTab: 'project' }, datasetIds).lastWorkspaceTab, 'overview')
assert.equal(normalizeWorkspaceState({ map: { basemap: 'bad', maxGapMinutes: -1 } }, datasetIds).map.basemap, 'osm')
assert.equal(normalizeWorkspaceState({ comparison: { referenceDatasetId: 'a', targetDatasetId: 'missing' } }, datasetIds).comparison.targetDatasetId, null)
assert.equal(
  normalizeWorkspaceState({ mapOverlays: { overlays: [{ id: 'bundled:special', sourceKind: 'bundled', sourceKey: 'special.kml', name: 'Special', visible: true, opacity: 0.6, zIndex: 0 }] } }, datasetIds).mapOverlays.overlays[0]?.name,
  'Special',
)

// Tranche 5 Task 5.3 step 1: reconciling comparison selectors when a
// referenced dataset is removed (App.tsx's removeDataset calls
// normalizeWorkspaceState with the post-removal dataset ID set).
const beforeRemoval = normalizeWorkspaceState({ comparison: { referenceDatasetId: 'a', targetDatasetId: 'b', toleranceMs: 2000 } }, new Set(['a', 'b']))
const afterRemovingReference = normalizeWorkspaceState(beforeRemoval, new Set(['b']))
assert.equal(afterRemovingReference.comparison.referenceDatasetId, null, 'reference selector must clear when its dataset is removed')
assert.equal(afterRemovingReference.comparison.targetDatasetId, 'b', 'an unaffected selector must survive reconciliation')
assert.equal(afterRemovingReference.comparison.toleranceMs, 2000, 'unrelated settings must survive reconciliation unchanged')
assert.equal(normalizeWorkspaceState({ comparison: { interpolateTarget: true } }, datasetIds).comparison.interpolateTarget, true, 'interpolation mode must persist')
assert.equal(normalizeWorkspaceState({ comparison: {} }, datasetIds).comparison.interpolateTarget, false, 'legacy workspaces default to observed samples')
const afterRemovingBoth = normalizeWorkspaceState(beforeRemoval, new Set())
assert.equal(afterRemovingBoth.comparison.referenceDatasetId, null)
assert.equal(afterRemovingBoth.comparison.targetDatasetId, null)

console.log('workspace state tests passed')
