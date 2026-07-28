import { DEFAULT_MAP_OVERLAY_STATE, normalizeMapOverlayState, type MapOverlayState } from './mapOverlays'

export type WorkspaceTab = 'overview' | 'map' | 'charts' | 'table' | 'compare' | 'scene3d' | 'transform'

export interface WorkspaceState {
  lastWorkspaceTab: WorkspaceTab
  map: { basemap: 'osm' | 'none'; maxGapMinutes: number; displayMode: 'both' | 'path' | 'points'; colorBy: string }
  scene3d: { projection: 'perspective' | 'orthographic'; altitudeExaggeration: number; gapThresholdSeconds: number }
  comparison: { referenceDatasetId: string | null; targetDatasetId: string | null; toleranceMs: number; targetOffsetMs: number }
  mapOverlays: MapOverlayState
}

export const DEFAULT_WORKSPACE_STATE: WorkspaceState = {
  lastWorkspaceTab: 'overview',
  map: { basemap: 'osm', maxGapMinutes: 5, displayMode: 'both', colorBy: 'none' },
  scene3d: { projection: 'perspective', altitudeExaggeration: 1, gapThresholdSeconds: 3 },
  comparison: { referenceDatasetId: null, targetDatasetId: null, toleranceMs: 1000, targetOffsetMs: 0 },
  mapOverlays: DEFAULT_MAP_OVERLAY_STATE,
}

export function normalizeWorkspaceState(value: unknown, datasetIds: ReadonlySet<string>): WorkspaceState {
  const record = isRecord(value) ? value : {}
  const map = isRecord(record.map) ? record.map : {}
  const scene3d = isRecord(record.scene3d) ? record.scene3d : {}
  const comparison = isRecord(record.comparison) ? record.comparison : {}
  const referenceDatasetId = knownId(comparison.referenceDatasetId, datasetIds)
  const targetDatasetId = knownId(comparison.targetDatasetId, datasetIds)
  return {
    lastWorkspaceTab: isWorkspaceTab(record.lastWorkspaceTab) ? record.lastWorkspaceTab : DEFAULT_WORKSPACE_STATE.lastWorkspaceTab,
    map: { basemap: map.basemap === 'none' ? 'none' : 'osm', maxGapMinutes: bounded(map.maxGapMinutes, 0, 1440, DEFAULT_WORKSPACE_STATE.map.maxGapMinutes), displayMode: map.displayMode === 'path' || map.displayMode === 'points' ? map.displayMode : 'both', colorBy: typeof map.colorBy === 'string' ? map.colorBy : 'none' },
    scene3d: { projection: scene3d.projection === 'orthographic' ? 'orthographic' : 'perspective', altitudeExaggeration: bounded(scene3d.altitudeExaggeration, 0.1, 100, 1), gapThresholdSeconds: bounded(scene3d.gapThresholdSeconds, 0, 86400, 3) },
    comparison: { referenceDatasetId, targetDatasetId: targetDatasetId === referenceDatasetId ? null : targetDatasetId, toleranceMs: bounded(comparison.toleranceMs, 0, 86_400_000, 1000), targetOffsetMs: bounded(comparison.targetOffsetMs, -86_400_000, 86_400_000, 0) },
    mapOverlays: normalizeMapOverlayState(record.mapOverlays),
  }
}

function isWorkspaceTab(value: unknown): value is WorkspaceTab { return ['overview', 'map', 'charts', 'table', 'compare', 'scene3d', 'transform'].includes(String(value)) }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function knownId(value: unknown, ids: ReadonlySet<string>): string | null { return typeof value === 'string' && ids.has(value) ? value : null }
function bounded(value: unknown, min: number, max: number, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback }
