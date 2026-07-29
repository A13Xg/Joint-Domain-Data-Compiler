export type MapOverlaySourceKind = 'bundled' | 'library' | 'project'
export type MapOverlayStatus = 'ready' | 'missing' | 'error'

/**
 * Filenames copied idempotently into the persistent KML/KMZ library on first
 * run (see `electron/kml-seed.cjs`). Overlays whose `sourceKey` matches one of
 * these are labeled "bundled" in the Map Overlays panel even though they live
 * in the same library folder as user-uploaded files.
 */
export const BUNDLED_KML_SEED_NAMES: ReadonlySet<string> = new Set(['Special_Use_Airspace.kml'])

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

const MAX_OVERLAY_COUNT = 200
const MAX_OVERLAY_ID_LENGTH = 200
const MAX_OVERLAY_NAME_LENGTH = 200
const MAX_OVERLAY_SOURCE_KEY_LENGTH = 512

export function normalizeMapOverlayState(value: unknown): MapOverlayState {
  if (!isRecord(value) || !Array.isArray(value.overlays) || value.overlays.length > MAX_OVERLAY_COUNT) return DEFAULT_MAP_OVERLAY_STATE
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
  if (!isBoundedString(value.id, MAX_OVERLAY_ID_LENGTH) || !isBoundedString(value.name, MAX_OVERLAY_NAME_LENGTH) || !isSafeSourceKey(value.sourceKey)) return null
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

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
}

function isSafeSourceKey(value: unknown): value is string {
  return isBoundedString(value, MAX_OVERLAY_SOURCE_KEY_LENGTH) && !value.includes('/') && !value.includes('\\') && value !== '.' && value !== '..'
}

function isFiniteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
