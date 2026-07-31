import { strict as assert } from 'node:assert'
import {
  DEFAULT_MAP_OVERLAY_STATE,
  MAX_OVERLAY_COUNT,
  MAX_OVERLAY_ID_LENGTH,
  MAX_OVERLAY_NAME_LENGTH,
  MAX_OVERLAY_SOURCE_KEY_LENGTH,
  checkOverlayCreation,
  normalizeMapOverlayState,
  reconcileMapOverlays,
  type MapOverlay,
} from '../src/state/mapOverlays.ts'

const bundled = {
  id: 'bundled:special-use-airspace',
  sourceKind: 'bundled' as const,
  sourceKey: 'Special_Use_Airspace.kml',
  name: 'Special Use Airspace',
  visible: true,
  opacity: 0.75,
  zIndex: 2,
}

assert.deepEqual(normalizeMapOverlayState(undefined), DEFAULT_MAP_OVERLAY_STATE)
const restored = normalizeMapOverlayState({ overlays: [bundled] })
assert.deepEqual(restored.overlays, [bundled])
assert.deepEqual(
  normalizeMapOverlayState({ overlays: [{ ...bundled, sourceKey: '../escape.kml', opacity: 4, zIndex: -2 }] }),
  DEFAULT_MAP_OVERLAY_STATE,
)
const reconciled = reconcileMapOverlays(restored, new Set())
assert.equal(reconciled.overlays[0]?.status, 'missing')
assert.equal(reconciled.overlays[0]?.visible, false)
assert.equal(reconciled.overlays[0]?.sourceKey, bundled.sourceKey)
// Creation-time cap enforcement (Finding 9): `checkOverlayCreation` must
// reject the same conditions `normalizeOverlay`/`normalizeMapOverlayState`
// reject at load time, so a rejected overlay never gets far enough to be
// created and later brick the project on save/load.
function makeOverlay(id: string, zIndex: number): MapOverlay {
  return { id, sourceKind: 'library', sourceKey: id, name: id, visible: true, opacity: 0.8, zIndex }
}

// A normal, well within-limits creation is accepted.
assert.deepEqual(checkOverlayCreation([], 'overlay:Track.kml', 'Track.kml', 'Track.kml'), { ok: true })

// Overlong id/name (mirrors normalizeOverlay's isBoundedString(..., MAX_OVERLAY_ID_LENGTH/MAX_OVERLAY_NAME_LENGTH)).
const overlongName = 'x'.repeat(MAX_OVERLAY_NAME_LENGTH + 1)
assert.deepEqual(
  checkOverlayCreation([], `overlay:${overlongName}`, overlongName, 'short.kml'),
  { ok: false, reason: 'name-too-long' },
)
// An id that overflows the cap even with an in-bounds name (prefix pushes it over).
const boundaryName = 'x'.repeat(MAX_OVERLAY_ID_LENGTH - 'overlay:'.length + 1)
assert.equal(checkOverlayCreation([], `overlay:${boundaryName}`, boundaryName, 'short.kml').ok, false)

// Overlong source key (mirrors isSafeSourceKey's MAX_OVERLAY_SOURCE_KEY_LENGTH bound).
const overlongSourceKey = 'y'.repeat(MAX_OVERLAY_SOURCE_KEY_LENGTH + 1)
assert.deepEqual(
  checkOverlayCreation([], 'overlay:short', 'short', overlongSourceKey),
  { ok: false, reason: 'source-key-too-long' },
)

// Overlay-count cap (mirrors normalizeMapOverlayState's MAX_OVERLAY_COUNT bound): adding a
// new, distinct overlay past the cap is rejected...
const fullOverlays = Array.from({ length: MAX_OVERLAY_COUNT }, (_, index) => makeOverlay(`overlay:${index}`, index))
assert.deepEqual(
  checkOverlayCreation(fullOverlays, 'overlay:one-too-many', 'one-too-many', 'one-too-many.kml'),
  { ok: false, reason: 'overlay-limit-reached' },
)
// ...but re-showing/updating an overlay that already exists at the cap is exempt (it does not
// grow the overlay count).
assert.deepEqual(checkOverlayCreation(fullOverlays, 'overlay:0', 'overlay:0', 'overlay:0'), { ok: true })

console.log('map overlay state tests passed')
