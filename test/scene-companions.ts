// Which datasets share the 3D scene. The panel used to draw only fully
// "compatible" companions and count only "blocked" ones, so every track whose
// altitude reference was unknown -- every CSV without a declared datum, and
// every P5 slot -- vanished from the scene with no explanation.
import type { Dataset } from '../src/core/model.ts'
import { planSceneCompanions, sceneCompanionStatus } from '../src/visualization/scene3d/companions.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

function dataset(id: string, altitudeReference: string, timeReference: string, meta?: Record<string, string>): Dataset {
  return {
    id, name: id, sourceFormat: 'csv', points: [{ lat: 35, lon: -117, ele: 100, time: 0 }], warnings: [], channels: [], createdAt: 0,
    metadata: { coordinateSystem: 'EPSG:4326', altitudeReference: altitudeReference as never, timeReference: timeReference as never, channels: [], source: { filename: `${id}.csv`, importedAt: 0, parserId: 'csv', parserVersion: '1' }, meta },
  }
}

const msl = dataset('msl', 'MSL', 'UTC')
const msl2 = dataset('msl2', 'MSL', 'UTC')
const hae = dataset('hae', 'HAE', 'UTC')
const unknown = dataset('unknown', 'UNKNOWN', 'UTC')
const slot1 = dataset('slot1', 'UNKNOWN', 'UNKNOWN', { p5DocumentKey: 'rec-A' })
const slot2 = dataset('slot2', 'UNKNOWN', 'UNKNOWN', { p5DocumentKey: 'rec-A' })
const otherRecording = dataset('slot-other', 'UNKNOWN', 'UNKNOWN', { p5DocumentKey: 'rec-B' })

check('declared, matching references are compatible', sceneCompanionStatus(msl, msl2).status === 'compatible')
check('declared, differing references are blocked', sceneCompanionStatus(msl, hae).status === 'blocked')
check('an unknown reference is its own status, not silently dropped', sceneCompanionStatus(msl, unknown).status === 'unknown-reference')
check('slots of one P5 recording share the scene by construction', sceneCompanionStatus(slot1, slot2).status === 'same-recording')
check('slots of different recordings do not', sceneCompanionStatus(slot1, otherRecording).status === 'unknown-reference')

const all = [msl, msl2, hae, unknown, slot1, slot2, otherRecording]
const off = planSceneCompanions(msl, all, false)
check('the primary is never its own companion', !off.included.some((d) => d.id === 'msl'))
check('every other dataset lands in exactly one bucket', off.included.length + off.heldBack.length + off.blocked.length === all.length - 1)
check('opt-in off: unknown references are held back and counted', off.heldBack.map((d) => d.id).sort().join() === 'slot-other,slot1,slot2,unknown' && off.included.map((d) => d.id).join() === 'msl2')
const on = planSceneCompanions(msl, all, true)
check('opt-in on: unknown references are drawn and marked as such', on.heldBack.length === 0 && on.includedWithUnknownReference.length === 4 && on.included.length === 5)
check('opt-in never overrides a declared conflict', on.blocked.map((d) => d.id).join() === 'hae')
const p5 = planSceneCompanions(slot1, all, false)
check('a P5 slot gets its sibling slot without any opt-in', p5.included.map((d) => d.id).join() === 'slot2')

console.log(`\n${failures === 0 ? 'ALL SCENE COMPANION CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
