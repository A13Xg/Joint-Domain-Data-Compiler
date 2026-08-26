// Tranche 7 Task 7.1: a generic sequential schema-migration engine for
// project manifests.
// has a tested, ready mechanism instead of an ad hoc rewrite, and so
// "this project was saved by a newer app version" fails with a clear
// message instead of a guess.
export interface SchemaMigrator {
  fromVersion: number
  toVersion: number
  migrate(raw: Record<string, unknown>): Record<string, unknown>
}

export class SchemaMigrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchemaMigrationError'
  }
}

/**
 * Migrate `raw` forward to `currentVersion` by applying `migrators`
 * sequentially. Rejects data from a newer schema version outright (no
 * downgrade path is ever attempted) and rejects a version with no
 * registered migrator, rather than guessing at compatibility.
 */
export function migrateToVersion(raw: unknown, currentVersion: number, migrators: readonly SchemaMigrator[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SchemaMigrationError('Project data must be an object.')
  }
  let record = raw as Record<string, unknown>
  const version = record.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new SchemaMigrationError('Project schemaVersion must be an integer.')
  }
  if (version > currentVersion) {
    throw new SchemaMigrationError(
      `This project was saved by a newer application version (schema ${version}); this build supports up to schema ${currentVersion}. Update the application to open it.`,
    )
  }

  const byFromVersion = new Map(migrators.map((migrator) => [migrator.fromVersion, migrator]))
  const maxSteps = migrators.length + 1
  let steps = 0

  while (record.schemaVersion !== currentVersion) {
    const migrator = byFromVersion.get(record.schemaVersion as number)
    if (!migrator) {
      throw new SchemaMigrationError(`No migration path from project schema version ${String(record.schemaVersion)} to ${currentVersion}.`)
    }
    const migrated = migrator.migrate(record)
    if (migrated.schemaVersion !== migrator.toVersion) {
      throw new SchemaMigrationError(
        `Migrator from schema ${migrator.fromVersion} produced schemaVersion ${String(migrated.schemaVersion)}, expected ${migrator.toVersion}.`,
      )
    }
    record = migrated
    steps++
    if (steps > maxSteps) throw new SchemaMigrationError('Project migration path did not converge (a migrator cycle is registered).')
  }

  return record
}

/** Schema v2 adds durable fusion provenance; v1 projects have none. */
export const PROJECT_MANIFEST_MIGRATORS: readonly SchemaMigrator[] = [{
  fromVersion: 1,
  toVersion: 2,
  migrate: (raw) => ({ ...raw, schemaVersion: 2, fusionArtifacts: [] }),
}]
