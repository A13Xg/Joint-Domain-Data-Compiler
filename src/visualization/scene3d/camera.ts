import type { Trajectory3dVertex } from './trajectory'

export type SceneProjection = 'perspective' | 'orthographic'

/**
 * Orbit camera around the scene centre. `pitch` is the camera's ELEVATION above
 * the horizon: 0 looks at the trajectory side-on (towards +north at yaw 0), and
 * +π/2 looks straight down with north up the screen. Negative pitch looks up at
 * the trajectory from below the floor.
 */
export interface SceneCamera { yaw: number; pitch: number; zoom: number; panX: number; panY: number }

export const MAX_PITCH = Math.PI / 2
/** Radians of orbit per CSS pixel of drag. */
export const ORBIT_RADIANS_PER_PIXEL = 0.008
export const DEFAULT_SCENE_CAMERA: SceneCamera = { yaw: -0.65, pitch: 0.48, zoom: 1, panX: 0, panY: 0 }
export const TOP_SCENE_CAMERA: SceneCamera = { yaw: 0, pitch: MAX_PITCH, zoom: 1, panX: 0, panY: 0 }
export const SIDE_SCENE_CAMERA: SceneCamera = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 }

/**
 * The one frame every track in the scene is projected through.
 *
 * Built once from ALL the tracks drawn together. Projecting each track through
 * a centre computed from its own vertices — which is what the panel used to do —
 * re-centres every companion onto the primary track, so two tracks a kilometre
 * apart were drawn on top of each other in a view labelled "shared ENU frame".
 */
export interface SceneFrame {
  centerEastM: number
  centerNorthM: number
  centerUpM: number
  /** Largest extent on any axis, metres (after altitude exaggeration). Never below 1. */
  spanM: number
  /** Lowest `upM` in the scene: where the floor grid and the curtain's foot sit. */
  floorUpM: number
}

export function sceneFrame(tracks: ReadonlyArray<readonly Trajectory3dVertex[]>): SceneFrame | null {
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity, minU = Infinity, maxU = -Infinity
  for (const vertices of tracks) {
    for (const v of vertices) {
      if (v.eastM < minE) minE = v.eastM
      if (v.eastM > maxE) maxE = v.eastM
      if (v.northM < minN) minN = v.northM
      if (v.northM > maxN) maxN = v.northM
      if (v.upM < minU) minU = v.upM
      if (v.upM > maxU) maxU = v.upM
    }
  }
  if (minE === Infinity) return null
  return {
    centerEastM: (minE + maxE) / 2,
    centerNorthM: (minN + maxN) / 2,
    centerUpM: (minU + maxU) / 2,
    spanM: Math.max(maxE - minE, maxN - minN, maxU - minU, 1),
    floorUpM: minU,
  }
}

export interface ScreenPoint { x: number; y: number; /** Distance into the screen, metres; larger is farther. */ depth: number }

export function projectEnu(
  eastM: number, northM: number, upM: number,
  frame: SceneFrame, camera: SceneCamera, projection: SceneProjection, width: number, height: number,
): ScreenPoint {
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw), cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch)
  const e = eastM - frame.centerEastM, n = northM - frame.centerNorthM, u = upM - frame.centerUpM
  const x1 = e * cy - n * sy
  const forward = e * sy + n * cy
  // Rotating the view by +pitch about the screen's horizontal axis: raising the
  // camera tips far ground UP the screen and brings high points NEARER. The
  // previous form had both signs flipped, which put a positive pitch below the
  // floor looking up — so dragging down tipped the scene the wrong way and the
  // "Top" preset (pitch 0) was really a side view.
  const screenUp = u * cp + forward * sp
  const depth = forward * cp - u * sp
  const scale = (Math.min(width, height) * 0.72 / frame.spanM) * camera.zoom
  const perspective = projection === 'perspective' ? clamp(1 / (1 + depth / (frame.spanM * 2.4)), 0.35, 2.4) : 1
  return {
    x: width / 2 + camera.panX + x1 * scale * perspective,
    y: height / 2 + camera.panY - screenUp * scale * perspective,
    depth,
  }
}

/** Drag-to-orbit as if grabbing the scene's near edge: dragging down raises the camera, dragging right swings the near side right. */
export function orbitCamera(camera: SceneCamera, dxPx: number, dyPx: number): SceneCamera {
  return {
    ...camera,
    yaw: camera.yaw + dxPx * ORBIT_RADIANS_PER_PIXEL,
    pitch: clamp(camera.pitch + dyPx * ORBIT_RADIANS_PER_PIXEL, -MAX_PITCH, MAX_PITCH),
  }
}

/**
 * Screen direction of each world axis under the camera's rotation, for the
 * orientation gizmo: x right, y DOWN (canvas convention), length 0–1. An axis
 * pointing straight at the viewer has length ~0 — e.g. Up in the Top view.
 */
export function axisScreenDirections(camera: SceneCamera): Record<'east' | 'north' | 'up', { x: number; y: number }> {
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw), cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch)
  const direction = (e: number, n: number, u: number) => {
    const forward = e * sy + n * cy
    return { x: e * cy - n * sy, y: -(u * cp + forward * sp) }
  }
  return { east: direction(1, 0, 0), north: direction(0, 1, 0), up: direction(0, 0, 1) }
}

/** Keyboard orbit/pan/zoom, so the scene can be driven without a pointer. */
export function cameraForKey(camera: SceneCamera, key: string, shift: boolean): SceneCamera | null {
  const step = 24
  if (key === '+' || key === '=') return { ...camera, zoom: clamp(camera.zoom * 1.2, 0.15, 12) }
  if (key === '-' || key === '_') return { ...camera, zoom: clamp(camera.zoom / 1.2, 0.15, 12) }
  const delta = key === 'ArrowLeft' ? [-step, 0] : key === 'ArrowRight' ? [step, 0] : key === 'ArrowUp' ? [0, -step] : key === 'ArrowDown' ? [0, step] : null
  if (!delta) return null
  return shift ? { ...camera, panX: camera.panX + delta[0]!, panY: camera.panY + delta[1]! } : orbitCamera(camera, delta[0]!, delta[1]!)
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }
