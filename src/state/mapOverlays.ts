export type MapOverlaySourceKind = 'bundled' | 'library' | 'project'
export type MapOverlayStatus = 'ready' | 'missing' | 'error'

export interface MapOverlay {
  id: string
  sourceKind: MapOverlaySourceKind
  sourceKey: string
  name: string
  visible: boolean
  opacity: number
  zIndex: number
  status?: MapOverlayStatus
}

export interface MapOverlayState {
  overlays: MapOverlay[]
}

export const DEFAULT_MAP_OVERLAY_STATE: MapOverlayState = Object.freeze({ overlays: [] })

export function normalizeMapOverlayState(value: unknown): MapOverlayState {
  if (!isRecord(value) || !Array.isArray(value.overlays)) return DEFAULT_MAP_OVERLAY_STATE
  const overlays: MapOverlay[] = []
  const ids = new Set<string>()
  for (const candidate of value.overlays) {
    const overlay = normalizeOverlay(candidate)
    if (!overlay || ids.has(overlay.id)) return DEFAULT_MAP_OVERLAY_STATE
    ids.add(overlay.id)
    overlays.push(overlay)
  }
  return { overlays }
}

export function reconcileMapOverlays(state: MapOverlayState, availableSourceKeys: ReadonlySet<string>): MapOverlayState {
  const overlays = state.overlays.map((overlay) => {
    if (availableSourceKeys.has(overlay.sourceKey)) return overlay
    return { ...overlay, status: 'missing' as const, visible: false }
  })
  return overlays.every((overlay, index) => overlay === state.overlays[index]) ? state : { overlays }
}

function normalizeOverlay(value: unknown): MapOverlay | null {
  if (!isRecord(value)) return null
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.name) || !isSafeSourceKey(value.sourceKey)) return null
  if (value.sourceKind !== 'bundled' && value.sourceKind !== 'library' && value.sourceKind !== 'project') return null
  if (typeof value.visible !== 'boolean' || !isFiniteInRange(value.opacity, 0, 1) || !isNonNegativeSafeInteger(value.zIndex)) return null
  if (value.status !== undefined && value.status !== 'ready' && value.status !== 'missing' && value.status !== 'error') return null
  return {
    id: value.id,
    sourceKind: value.sourceKind,
    sourceKey: value.sourceKey,
    name: value.name,
    visible: value.visible,
    opacity: value.opacity,
    zIndex: value.zIndex,
    ...(value.status === undefined ? {} : { status: value.status }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isSafeSourceKey(value: unknown): value is string {
  return isNonEmptyString(value) && !value.includes('/') && !value.includes('\\') && value !== '.' && value !== '..'
}

function isFiniteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
