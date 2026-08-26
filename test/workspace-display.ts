// Tranche 5 Task 5.1 (steps 1-3): per-dataset display settings model.
import type { Dataset } from '../src/core/model.ts'
import {
  createDisplaySettings,
  restoreWorkspaceDisplay,
  setLabel,
  setOpacity,
  setVisibility,
  syncWorkspaceDisplay,
  visibleDatasetIds,
  type WorkspaceDisplay,
} from '../src/state/workspaceDisplay.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function makeDataset(id: string, name = id): Dataset {
  return { id, name, sourceFormat: 'csv', points: [], warnings: [], channels: [], createdAt: 0 }
}

// --- Deterministic fallback colors -------------------------------------------
{
  const a = createDisplaySettings(makeDataset('a'), 0)
  const b = createDisplaySettings(makeDataset('b'), 1)
  check('Different indices get different fallback colors', a.color !== b.color)
  check('The same index always gets the same color', createDisplaySettings(makeDataset('c'), 0).color === a.color)
  check('New datasets default to visible', a.visible === true)
}

// --- Sync: add ---------------------------------------------------------------
{
  const empty: WorkspaceDisplay = {}
  const synced = syncWorkspaceDisplay(empty, [makeDataset('a'), makeDataset('b')])
  check('Sync adds an entry per loaded dataset', Object.keys(synced).length === 2)
  check('Sync assigns distinct colors to each new dataset', synced.a?.color !== synced.b?.color)
}

// --- Sync: remove (stale-ID cleanup) -----------------------------------------
{
  const withThree = syncWorkspaceDisplay({}, [makeDataset('a'), makeDataset('b'), makeDataset('c')])
  const afterRemoveB = syncWorkspaceDisplay(withThree, [makeDataset('a'), makeDataset('c')])
  check('Sync drops entries for datasets that are no longer loaded', afterRemoveB.b === undefined)
  check('Sync preserves entries for datasets that are still loaded', afterRemoveB.a === withThree.a)
}

// --- Sync: identity stability (no spurious re-renders) -----------------------
{
  const synced = syncWorkspaceDisplay({}, [makeDataset('a')])
  const resynced = syncWorkspaceDisplay(synced, [makeDataset('a')])
  check('Re-syncing with no changes returns the same object reference', resynced === synced)
}

// --- Mutators preserve identity when nothing changes -------------------------
{
  const synced = syncWorkspaceDisplay({}, [makeDataset('a')])
  check('setVisibility to the current value is a no-op', setVisibility(synced, 'a', true) === synced)
  check('setVisibility to a new value updates the entry', setVisibility(synced, 'a', false).a?.visible === false)
  check('setVisibility on an unknown id is a no-op', setVisibility(synced, 'missing', false) === synced)
  check('setOpacity clamps to [0,1]', setOpacity(synced, 'a', 5).a?.opacity === 1 && setOpacity(synced, 'a', -5).a?.opacity === 0)
  check('setLabel updates the label', setLabel(synced, 'a', 'Renamed').a?.label === 'Renamed')
}

// --- visibleDatasetIds --------------------------------------------------------
{
  let display = syncWorkspaceDisplay({}, [makeDataset('a'), makeDataset('b')])
  display = setVisibility(display, 'b', false)
  check('visibleDatasetIds excludes hidden datasets', visibleDatasetIds(display).join(',') === 'a')
}

// --- Restore validation (Task 5.1 step 2: "validation for restored state") --
{
  const datasets = [makeDataset('a'), makeDataset('b')]
  const validRaw = { a: { visible: true, color: '#ea4f2f', opacity: 0.5, label: 'A' } }
  const restored = restoreWorkspaceDisplay(validRaw, datasets)
  check('Valid restored entries are kept', restored.a?.opacity === 0.5 && restored.a?.label === 'A')
  check('Missing entries are backfilled for datasets present in the project', restored.b !== undefined)
}
{
  const datasets = [makeDataset('a')]
  const staleRaw = { a: { visible: true, color: '#ea4f2f', opacity: 1, label: 'A' }, ghost: { visible: true, color: '#ea4f2f', opacity: 1, label: 'Ghost' } }
  check('Restore drops entries for dataset IDs no longer present', restoreWorkspaceDisplay(staleRaw, datasets).ghost === undefined)
}
{
  const datasets = [makeDataset('a')]
  const malformedCases: unknown[] = [
    null,
    'not an object',
    { a: null },
    { a: { visible: 'yes', color: '#ea4f2f', opacity: 1, label: 'A' } },
    { a: { visible: true, color: 'red', opacity: 1, label: 'A' } },
    { a: { visible: true, color: '#ea4f2f', opacity: 2, label: 'A' } },
    { a: { visible: true, color: '#ea4f2f', opacity: 1, label: 42 } },
  ]
  const allSafelyBackfilled = malformedCases.every((raw) => {
    const restored = restoreWorkspaceDisplay(raw, datasets)
    return restored.a !== undefined && typeof restored.a.color === 'string'
  })
  check('Malformed persisted entries are rejected and backfilled rather than trusted', allSafelyBackfilled)
}

console.log(`\n${failures === 0 ? 'ALL WORKSPACE DISPLAY CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
