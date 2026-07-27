// Tranche 7 Task 7.3 (core layer): a local diagnostic bundle for bug
// reports. Pure and input-driven — never reaches into a dataset's points or
// any persistent-library/file-system content itself; callers pass only
// already-summarized, already-sanitized inputs, so there is no code path in
// this module that could accidentally leak raw telemetry, coordinates, or
// KML/KMZ library contents into a bundle a user might share.
import { formatLogEntry, type LogEntry } from '../logger'
import type { WorkspaceState } from '../../state/workspace'

export interface DiagnosticDatasetSummary {
  id: string
  name: string
  sourceFormat: string
  pointCount: number
  warningCount: number
}

export interface DiagnosticBundleInput {
  appVersion: string
  /** e.g. 'web', 'electron-win32', 'electron-darwin', 'electron-linux'. Never a raw user-agent string (avoids incidentally embedding OS/build fingerprint minutiae beyond what's useful). */
  platform: string
  packaged: boolean
  datasets: readonly DiagnosticDatasetSummary[]
  workspace: WorkspaceState
  logEntries: readonly LogEntry[]
  generatedAt: number
  /** Caps how much log history ships in the bundle; defaults to the most recent 500 entries. */
  maxLogEntries?: number
  /** Free-text note the user explicitly chose to attach — never auto-populated from anything else. */
  userNote?: string
}

export interface DiagnosticBundle {
  schemaVersion: 1
  generatedAt: number
  app: { version: string; platform: string; packaged: boolean }
  datasets: DiagnosticDatasetSummary[]
  workspace: WorkspaceState
  logs: string[]
  userNote?: string
}

const DEFAULT_MAX_LOG_ENTRIES = 500

export function buildDiagnosticBundle(input: DiagnosticBundleInput): DiagnosticBundle {
  const maxLogEntries = input.maxLogEntries ?? DEFAULT_MAX_LOG_ENTRIES
  if (maxLogEntries < 0) throw new RangeError('maxLogEntries must be non-negative')

  const recentLogs = input.logEntries.slice(-maxLogEntries)

  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    app: { version: input.appVersion, platform: input.platform, packaged: input.packaged },
    datasets: input.datasets.map((dataset) => ({ ...dataset })),
    workspace: input.workspace,
    logs: recentLogs.map(formatLogEntry),
    userNote: input.userNote,
  }
}

export function serializeDiagnosticBundle(bundle: DiagnosticBundle): string {
  return JSON.stringify(bundle, null, 2)
}
