// Pins which way the 3D scene turns. The panel's projection once rotated by
// -pitch, so a positive pitch put the camera BELOW the floor: dragging down
// tipped the scene the wrong way, and the "Top" preset was a side view. Each
// check below is a property a user can see, not an internal number.
import {
  DEFAULT_SCENE_CAMERA,
  MAX_PITCH,
  SIDE_SCENE_CAMERA,
  TOP_SCENE_CAMERA,
  orbitCamera,
  projectEnu,
  sceneFrame,
  type SceneCamera,
} from '../src/visualization/scene3d/camera.ts'
import { buildSharedTrajectory3dGeometry } from '../src/visualization/scene3d/trajectory.ts'
import type { TrackPoint } from '../src/core/model.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const W = 800, H = 600
// A 2 km box with 400 m of height, centred on the origin.
const frame = sceneFrame([[
  { sourceIndex: 0, eastM: -1000, northM: -1000, upM: 0 },
  { sourceIndex: 1, eastM: 1000, northM: 1000, upM: 400 },
]])!
const at = (camera: SceneCamera, e: number, n: number, u: number, projection: 'perspective' | 'orthographic' = 'perspective') =>
  projectEnu(e, n, u, frame, camera, projection, W, H)

check('frame spans the largest axis and records the floor', frame.spanM === 2000 && frame.floorUpM === 0 && frame.centerUpM === 200)

// Top view: north is up the screen, east is to the right, height is toward the viewer.
const topNorth = at(TOP_SCENE_CAMERA, 0, 800, 200)
const topEast = at(TOP_SCENE_CAMERA, 800, 0, 200)
check('Top: a point to the north draws above the centre', topNorth.y < H / 2 - 100, `y=${topNorth.y.toFixed(1)}`)
check('Top: a point to the east draws right of the centre', topEast.x > W / 2 + 100, `x=${topEast.x.toFixed(1)}`)
const topHigh = at(TOP_SCENE_CAMERA, 0, 0, 400)
const topLow = at(TOP_SCENE_CAMERA, 0, 0, 0)
check('Top: a higher point is nearer the camera', topHigh.depth < topLow.depth)
const highOffset = at(TOP_SCENE_CAMERA, 500, 0, 400).x - W / 2
const lowOffset = at(TOP_SCENE_CAMERA, 500, 0, 0).x - W / 2
check('Top: perspective draws the nearer (higher) point larger', highOffset > lowOffset, `${highOffset.toFixed(1)} vs ${lowOffset.toFixed(1)}`)

// Side view: up is up the screen, north is into it.
const sideHigh = at(SIDE_SCENE_CAMERA, 0, 0, 400)
const sideLow = at(SIDE_SCENE_CAMERA, 0, 0, 0)
check('Side: higher altitude draws higher on screen', sideHigh.y < sideLow.y)
check('Side: north is away from the viewer', at(SIDE_SCENE_CAMERA, 0, 800, 200).depth > at(SIDE_SCENE_CAMERA, 0, -800, 200).depth)

// Default oblique view looks from above: the floor sits below the track, and
// far ground rises up the screen.
const floorCentre = at(DEFAULT_SCENE_CAMERA, 0, 0, 0)
const trackCentre = at(DEFAULT_SCENE_CAMERA, 0, 0, 400)
check('Default: the floor grid draws below the track above it', floorCentre.y > trackCentre.y)
check('Default: the camera is above the floor (positive pitch)', DEFAULT_SCENE_CAMERA.pitch > 0)

// Drag direction: dragging DOWN tips far ground UP the screen — the camera rises,
// as if the near edge of the scene were grabbed and pulled down.
const before = at(SIDE_SCENE_CAMERA, 0, 800, 0, 'orthographic')
const dragged = orbitCamera(SIDE_SCENE_CAMERA, 0, 40)
const after = at(dragged, 0, 800, 0, 'orthographic')
check('Drag down raises the camera', dragged.pitch > SIDE_SCENE_CAMERA.pitch)
check('Drag down moves a far point up the screen', after.y < before.y, `${before.y.toFixed(1)} -> ${after.y.toFixed(1)}`)
const nearBefore = at(SIDE_SCENE_CAMERA, 0, -800, 0, 'orthographic')
const nearAfter = at(dragged, 0, -800, 0, 'orthographic')
check('Drag down moves a near point down the screen', nearAfter.y > nearBefore.y)
check('Pitch clamps at straight down and straight up',
  orbitCamera(DEFAULT_SCENE_CAMERA, 0, 10_000).pitch === MAX_PITCH && orbitCamera(DEFAULT_SCENE_CAMERA, 0, -10_000).pitch === -MAX_PITCH)
check('Drag right swings the near side right', at(orbitCamera(TOP_SCENE_CAMERA, 40, 0), 0, -800, 200).x > at(TOP_SCENE_CAMERA, 0, -800, 200).x)

// Companions share the frame: two tracks 1 km apart must not draw on top of each other.
const line = (lonOffset: number): TrackPoint[] => Array.from({ length: 20 }, (_, i) => ({ lat: 35 + i * 0.0001, lon: -117 + lonOffset, ele: 1000 + i * 5 }))
const shared = buildSharedTrajectory3dGeometry([{ id: 'a', points: line(0) }, { id: 'b', points: line(0.011) }])
const sharedFrame = sceneFrame(shared.tracks.map((track) => track.geometry.vertices))!
const firstA = shared.tracks[0]!.geometry.vertices[0]!
const firstB = shared.tracks[1]!.geometry.vertices[0]!
const screenA = projectEnu(firstA.eastM, firstA.northM, firstA.upM, sharedFrame, TOP_SCENE_CAMERA, 'orthographic', W, H)
const screenB = projectEnu(firstB.eastM, firstB.northM, firstB.upM, sharedFrame, TOP_SCENE_CAMERA, 'orthographic', W, H)
check('Companion tracks keep their real separation on screen', screenB.x - screenA.x > 100, `${(screenB.x - screenA.x).toFixed(1)} px apart`)
check('Floor is the lowest sample of any track, not the origin height', sharedFrame.floorUpM <= Math.min(firstA.upM, firstB.upM))
check('An empty scene has no frame', sceneFrame([[]]) === null)

console.log(`\n${failures === 0 ? 'ALL SCENE CAMERA CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
