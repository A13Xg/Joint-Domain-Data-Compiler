// Tranche 7 Task 7.3 (core layer): local diagnostic bundle export.
import { DEFAULT_WORKSPACE_STATE } from '../src/state/workspace.ts'
import type { LogEntry } from '../src/core/logger.ts'
import { buildDiagnosticBundle, serializeDiagnosticBundle, type DiagnosticBundleInput } from '../src/core/diagnostics/bundle.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}
function makeInput(overrides: Partial<DiagnosticBundleInput> = {}): DiagnosticBundleInput {
  const logEntries: LogEntry[] = [
    { id: 1, ts: 1000, level: 'info', category: 'import', message: 'Loaded track.gpx' },
    { id: 2, ts: 2000, level: 'warn', category: 'transform', message: 'Dropped 3 points', detail: { count: 3 } },
  ]
  return {
    appVersion: '0.1.0',
    platform: 'electron-linux',
    packaged: true,
    datasets: [{ id: 'd1', name: 'track.gpx', sourceFormat: 'gpx', pointCount: 1200, warningCount: 1 }],
    workspace: DEFAULT_WORKSPACE_STATE,
    logEntries,
    generatedAt: 5000,
    ...overrides,
  }
}

// --- Basic assembly ------------------------------------------------------
{
  const bundle = buildDiagnosticBundle(makeInput())
  check('Bundle carries app metadata', bundle.app.version === '0.1.0' && bundle.app.platform === 'electron-linux' && bundle.app.packaged === true)
  check('Bundle carries dataset summaries', bundle.datasets.length === 1 && bundle.datasets[0]?.pointCount === 1200)
  check('Bundle carries workspace config', bundle.workspace === DEFAULT_WORKSPACE_STATE)
  check('Bundle formats log entries as readable lines', bundle.logs.length === 2 && bundle.logs[0]!.includes('Loaded track.gpx'))
  check('Bundle log lines include structured detail', bundle.logs[1]!.includes('"count":3'))
  check('schemaVersion is set', bundle.schemaVersion === 1)
}

// --- Never includes raw point data -------------------------------------
{
  const bundle = buildDiagnosticBundle(makeInput())
  const serialized = serializeDiagnosticBundle(bundle)
  check('Dataset summaries never carry a points/coordinates field', !('points' in bundle.datasets[0]!) && !('lat' in bundle.datasets[0]!))
  check('Serialized bundle contains no raw coordinate-shaped data', !/"lat"\s*:/.test(serialized) && !/"lon"\s*:/.test(serialized))
}

// --- Log cap --------------------------------------------------------------
{
  const manyLogs: LogEntry[] = Array.from({ length: 1000 }, (_, i) => ({ id: i, ts: i, level: 'info', category: 'x', message: `entry ${i}` }))
  const bundle = buildDiagnosticBundle(makeInput({ logEntries: manyLogs, maxLogEntries: 10 }))
  check('Log entries are capped to maxLogEntries', bundle.logs.length === 10)
  check('The cap keeps the most recent entries, not the oldest', bundle.logs[bundle.logs.length - 1]!.includes('entry 999'))
}
{
  let threw = false
  try { buildDiagnosticBundle(makeInput({ maxLogEntries: -1 })) } catch { threw = true }
  check('A negative maxLogEntries is rejected', threw)
}

// --- Optional user note ---------------------------------------------------
{
  const withoutNote = buildDiagnosticBundle(makeInput())
  check('userNote is omitted when not provided', withoutNote.userNote === undefined)
  const withNote = buildDiagnosticBundle(makeInput({ userNote: 'Crashes when importing large CSVs' }))
  check('userNote is included only when explicitly provided', withNote.userNote === 'Crashes when importing large CSVs')
}

// --- Serialization is valid JSON -------------------------------------------
{
  const bundle = buildDiagnosticBundle(makeInput())
  const roundTrip = JSON.parse(serializeDiagnosticBundle(bundle))
  check('Serialized bundle round-trips through JSON', roundTrip.app.version === '0.1.0' && roundTrip.datasets.length === 1)
}

console.log(`\n${failures === 0 ? 'ALL DIAGNOSTIC BUNDLE CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
