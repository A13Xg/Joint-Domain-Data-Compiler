import { DEFAULT_MAP_OVERLAY_STATE, normalizeMapOverlayState, type MapOverlayState } from './mapOverlays'
import { normalizeReportOptions, type ReportOptions } from '../core/reports/options'

// Single source for the tabs whose selection is remembered with the project.
// The validator below reads this list rather than repeating it, because a
// hand-maintained duplicate is how a new tab ends up silently restoring to
// 'overview'.
const WORKSPACE_TABS = ['overview', 'map', 'charts', 'table', 'points', 'compare', 'scene3d', 'transform'] as const

export type WorkspaceTab = typeof WORKSPACE_TABS[number]

export interface WorkspaceState {
  lastWorkspaceTab: WorkspaceTab
    map: { basemap: 'osm' | 'osm-dark' | 'osm-humanitarian' | 'osm-topo' | 'none'; maxGapMinutes: number; displayMode: 'both' | 'path' | 'points'; colorBy: string; showDensity: boolean; densityCellMeters: number }
  scene3d: { projection: 'perspective' | 'orthographic'; altitudeExaggeration: number; gapThresholdSeconds: number }
  comparison: { referenceDatasetId: string | null; targetDatasetId: string | null; toleranceMs: number; targetOffsetMs: number; interpolateTarget: boolean }
  mapOverlays: MapOverlayState
  /**
   * Remembered HTML report export preferences for this project (Task 3.3).
   * Absent by default and only ever populated when the user explicitly
   * checks "Remember these settings for this project" in the report export
   * dialog — no flow silently persists a session's dialog choices. Unlike
   * the other workspace sub-state above, a malformed persisted value here is
   * normalized to safe defaults (via `normalizeReportOptions`) rather than
   * causing the whole project load to be rejected: this is optional
   * cosmetic report-generation UI state, not state other bindings rely on.
   * See manifest.ts `validateView`/`normalizeManifestReportPreferences` for
   * the load-time counterpart.
   */
  reportPreferences?: ReportOptions
}

export const DEFAULT_WORKSPACE_STATE: WorkspaceState = {
  lastWorkspaceTab: 'overview',
  map: { basemap: 'osm', maxGapMinutes: 5, displayMode: 'both', colorBy: 'none', showDensity: false, densityCellMeters: 250 },
  scene3d: { projection: 'perspective', altitudeExaggeration: 1, gapThresholdSeconds: 3 },
  comparison: { referenceDatasetId: null, targetDatasetId: null, toleranceMs: 1000, targetOffsetMs: 0, interpolateTarget: false },
  mapOverlays: DEFAULT_MAP_OVERLAY_STATE,
  // reportPreferences intentionally omitted: no remembered report settings by default.
}

export function normalizeWorkspaceState(value: unknown, datasetIds: ReadonlySet<string>): WorkspaceState {
  const record = isRecord(value) ? value : {}
  const map = isRecord(record.map) ? record.map : {}
  const scene3d = isRecord(record.scene3d) ? record.scene3d : {}
  const comparison = isRecord(record.comparison) ? record.comparison : {}
  const referenceDatasetId = knownId(comparison.referenceDatasetId, datasetIds)
  const targetDatasetId = knownId(comparison.targetDatasetId, datasetIds)
  const base: WorkspaceState = {
    lastWorkspaceTab: isWorkspaceTab(record.lastWorkspaceTab) ? record.lastWorkspaceTab : DEFAULT_WORKSPACE_STATE.lastWorkspaceTab,
      map: { basemap: map.basemap === 'none' || map.basemap === 'osm-dark' || map.basemap === 'osm-humanitarian' || map.basemap === 'osm-topo' ? map.basemap : 'osm', maxGapMinutes: bounded(map.maxGapMinutes, 0, 1440, DEFAULT_WORKSPACE_STATE.map.maxGapMinutes), displayMode: map.displayMode === 'path' || map.displayMode === 'points' ? map.displayMode : 'both', colorBy: typeof map.colorBy === 'string' ? map.colorBy : 'none', showDensity: map.showDensity === true, densityCellMeters: bounded(map.densityCellMeters, 1, 500_000, DEFAULT_WORKSPACE_STATE.map.densityCellMeters) },
    scene3d: { projection: scene3d.projection === 'orthographic' ? 'orthographic' : 'perspective', altitudeExaggeration: bounded(scene3d.altitudeExaggeration, 0.1, 100, 1), gapThresholdSeconds: bounded(scene3d.gapThresholdSeconds, 0, 86400, 3) },
    comparison: { referenceDatasetId, targetDatasetId: targetDatasetId === referenceDatasetId ? null : targetDatasetId, toleranceMs: bounded(comparison.toleranceMs, 0, 86_400_000, 1000), targetOffsetMs: bounded(comparison.targetOffsetMs, -86_400_000, 86_400_000, 0), interpolateTarget: comparison.interpolateTarget === true },
    mapOverlays: normalizeMapOverlayState(record.mapOverlays),
  }
  if (record.reportPreferences === undefined) return base
  return { ...base, reportPreferences: normalizeReportOptions(record.reportPreferences).options }
}

function isWorkspaceTab(value: unknown): value is WorkspaceTab { return (WORKSPACE_TABS as readonly string[]).includes(String(value)) }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function knownId(value: unknown, ids: ReadonlySet<string>): string | null { return typeof value === 'string' && ids.has(value) ? value : null }
function bounded(value: unknown, min: number, max: number, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback }
