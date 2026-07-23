import type { TrackPoint } from '../src/core/model.ts'
import { buildTrajectory3dGeometry } from '../src/visualization/scene3d/trajectory.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const points: TrackPoint[] = Array.from({ length: 101 }, (_, index) => ({
  lat: 35 + index * 0.00001,
  lon: -117 + index * 0.00002,
  ele: 100 + index,
  ext: { ground_speed_mps: index * 2 },
}))

const geometry = buildTrajectory3dGeometry(points, {
  maxPoints: 11,
  altitudeExaggeration: 2,
  colorChannelId: 'ground_speed_mps',
})

check('Uses first valid point as origin', geometry.origin.latDeg === points[0]!.lat && geometry.origin.lonDeg === points[0]!.lon)
check('Origin vertex is near local zero', Math.hypot(geometry.vertices[0]!.eastM, geometry.vertices[0]!.northM, geometry.vertices[0]!.upM) < 0.001)
check('Respects render point budget', geometry.renderedPointCount === 11)
check('Preserves first and last source indices', geometry.vertices[0]!.sourceIndex === 0 && geometry.vertices.at(-1)!.sourceIndex === 100)
check('Produces positive east and north travel', geometry.bounds.maxEastM > 0 && geometry.bounds.maxNorthM > 0)
check('Applies altitude exaggeration', geometry.vertices.at(-1)!.upM > 190)
check('Computes channel color range', geometry.colorRange?.min === 0 && geometry.colorRange.max === 200)

const withInvalid: TrackPoint[] = [{ lat: 100, lon: 0 }, ...points.slice(0, 2)]
const filtered = buildTrajectory3dGeometry(withInvalid)
check('Skips invalid coordinates and preserves source indices', filtered.validPointCount === 2 && filtered.vertices[0]!.sourceIndex === 1)

let invalidOptionsRejected = false
try { buildTrajectory3dGeometry(points, { maxPoints: 1 }) } catch { invalidOptionsRejected = true }
check('Rejects invalid render budgets', invalidOptionsRejected)

let emptyRejected = false
try { buildTrajectory3dGeometry([]) } catch { emptyRejected = true }
check('Rejects empty trajectories', emptyRejected)

console.log(`\n${failures === 0 ? 'ALL 3D TRAJECTORY CHECKS PASSED' : `${failures} 3D TRAJECTORY CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
