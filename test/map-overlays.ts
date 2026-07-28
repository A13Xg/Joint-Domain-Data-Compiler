import { strict as assert } from 'node:assert'
import {
  DEFAULT_MAP_OVERLAY_STATE,
  normalizeMapOverlayState,
  reconcileMapOverlays,
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
console.log('map overlay state tests passed')
