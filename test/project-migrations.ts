// Tranche 7 Task 7.1: the generic schema-migration engine. Only schema
// version 1 exists in production today, so these tests exercise the engine
// generically with synthetic migrators rather than a real future schema —
// the point is to prove the mechanism (sequencing, rejection rules,
// cycle-guard) works correctly before a real v2 ever needs it.
import {
  migrateToVersion,
  SchemaMigrationError,
  type SchemaMigrator,
} from '../src/persistence/project/migrations.ts'
import { parseProjectManifest, type ProjectManifest } from '../src/persistence/project/manifest.ts'
import { EMPTY_WORKSPACE_SELECTION } from '../src/core/selection.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}
function checkThrows(name: string, fn: () => void, messageIncludes?: string): void {
  try {
    fn()
    check(name, false, 'did not throw')
  } catch (err) {
    const isRightType = err instanceof SchemaMigrationError
    const messageOk = messageIncludes === undefined || (err instanceof Error && err.message.includes(messageIncludes))
    check(name, isRightType && messageOk, !isRightType ? `wrong error type: ${err}` : !messageOk ? `unexpected message: ${(err as Error).message}` : '')
  }
}

// --- No-op when already current ---------------------------------------------
{
  const raw = { schemaVersion: 3, note: 'unchanged' }
  const result = migrateToVersion(raw, 3, [])
  check('Already-current data passes through unchanged', result === raw)
}

// --- Single-step migration ----------------------------------------------
{
  const v1to2: SchemaMigrator = {
    fromVersion: 1,
    toVersion: 2,
    migrate: (raw) => ({ ...raw, schemaVersion: 2, addedField: 'default' }),
  }
  const result = migrateToVersion({ schemaVersion: 1, name: 'old' }, 2, [v1to2])
  check('Single-step migration reaches the target version', result.schemaVersion === 2)
  check('Single-step migration preserves existing fields', result.name === 'old')
  check('Single-step migration applies the migrator\'s changes', result.addedField === 'default')
}

// --- Multi-step chained migration ---------------------------------------
{
  const v1to2: SchemaMigrator = { fromVersion: 1, toVersion: 2, migrate: (raw) => ({ ...raw, schemaVersion: 2 }) }
  const v2to3: SchemaMigrator = { fromVersion: 2, toVersion: 3, migrate: (raw) => ({ ...raw, schemaVersion: 3 }) }
  const result = migrateToVersion({ schemaVersion: 1 }, 3, [v1to2, v2to3])
  check('A v1 payload chains through multiple migrators to reach v3', result.schemaVersion === 3)
}

// --- Rejects data from a newer application version ---------------------
checkThrows(
  'Rejects a schema version newer than this build supports',
  () => migrateToVersion({ schemaVersion: 5 }, 3, []),
  'newer application version',
)

// --- Rejects a version with no migration path -----------------------------
checkThrows(
  'Rejects a version with no registered migrator',
  () => migrateToVersion({ schemaVersion: 1 }, 3, []),
  'No migration path',
)

// --- Rejects a malformed schemaVersion field -------------------------------
checkThrows('Rejects a non-integer schemaVersion', () => migrateToVersion({ schemaVersion: '1' }, 1, []))
checkThrows('Rejects non-object input', () => migrateToVersion([1, 2, 3], 1, []))
checkThrows('Rejects null input', () => migrateToVersion(null, 1, []))

// --- Detects a broken/cyclic migrator that never converges -----------------
{
  const brokenMigrator: SchemaMigrator = { fromVersion: 1, toVersion: 2, migrate: (raw) => ({ ...raw, schemaVersion: 1 }) } // claims toVersion 2 but doesn't actually bump it
  checkThrows(
    'Rejects a migrator that does not actually advance the schema version',
    () => migrateToVersion({ schemaVersion: 1 }, 2, [brokenMigrator]),
  )
}

// --- Integration: parseProjectManifest routes through the engine -----------
{
  const manifest: ProjectManifest = {
    schema: 'jddc-project', schemaVersion: 1, projectId: 'p1', name: 'Test', createdAt: 0, updatedAt: 0,
    applicationVersion: '0.0.0', datasets: [], recipes: [], bookmarks: [],
    view: { activeDatasetId: null, selection: EMPTY_WORKSPACE_SELECTION, chartLayoutIds: [] },
  }
  const parsed = parseProjectManifest(JSON.stringify(manifest))
  check('parseProjectManifest still accepts the current schema version', parsed.schemaVersion === 1)
}
{
  let rejectedFutureVersion = false
  try {
    parseProjectManifest(JSON.stringify({ schema: 'jddc-project', schemaVersion: 99 }))
  } catch (err) {
    rejectedFutureVersion = err instanceof SchemaMigrationError && err.message.includes('newer application version')
  }
  check('parseProjectManifest rejects a future schema version with a clear message', rejectedFutureVersion)
}

console.log(`\n${failures === 0 ? 'ALL PROJECT MIGRATION CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
