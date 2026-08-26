// Covers the shared plan-view projection used by the repair preview and the
// point visualizer. The two properties that matter are equal aspect (a repair
// that moves a sample 50 m must not look like 500 m because the box is wide)
// and antimeridian safety (non-negotiable #3): a track crossing 180° must
// project as the short continuous path it is, not a streak across the plot.

import type { TrackPoint } from '../src/core/model.ts'
import {
  buildPlanFrame, niceScaleBarMeters, planStride, projectPoint, projectTrack,
} from '../src/visualization/diff/planProjection.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const WIDTH = 720
const HEIGHT = 420
const PADDING = 28

console.log('framing')
{
  const track: TrackPoint[] = Array.from({ length: 20 }, (_, index) => ({ lat: 40 + index * 0.001, lon: -75 + index * 0.001 }))
  const frame = buildPlanFrame([track], WIDTH, HEIGHT, PADDING)
  check('a normal track produces a frame', frame !== null)
  const path = projectTrack(track, frame!)
  check('every sample projects', path.length === track.length, `${path.length}`)
  check('the path stays inside the box', path.every((node) => node.x >= 0 && node.x <= WIDTH && node.y >= 0 && node.y <= HEIGHT))
  check('north is up', path[0]!.y > path[path.length - 1]!.y)
  check('east is right', path[0]!.x < path[path.length - 1]!.x)
}

console.log('equal aspect')
{
  // A one-kilometre leg east and a one-kilometre leg north must draw the same
  // length, whatever shape the viewport is.
  const eastMeters = 1000
  const northMeters = 1000
  const originLat = 40
  const metersPerDegree = (6371008.8 * Math.PI) / 180
  const track: TrackPoint[] = [
    { lat: originLat, lon: 0 },
    { lat: originLat, lon: eastMeters / (metersPerDegree * Math.cos((originLat * Math.PI) / 180)) },
    { lat: originLat + northMeters / metersPerDegree, lon: 0 },
  ]
  const frame = buildPlanFrame([track], WIDTH, HEIGHT, PADDING)!
  const path = projectTrack(track, frame)
  const eastLength = Math.hypot(path[1]!.x - path[0]!.x, path[1]!.y - path[0]!.y)
  const northLength = Math.hypot(path[2]!.x - path[0]!.x, path[2]!.y - path[0]!.y)
  check('equal ground distances draw equal lengths', Math.abs(eastLength - northLength) / northLength < 0.01, `${eastLength.toFixed(2)} vs ${northLength.toFixed(2)}`)
}

console.log('antimeridian')
{
  const crossing: TrackPoint[] = [
    { lat: 10, lon: 179.7 },
    { lat: 10, lon: 179.9 },
    { lat: 10, lon: -179.9 },
    { lat: 10, lon: -179.7 },
  ]
  const frame = buildPlanFrame([crossing], WIDTH, HEIGHT, PADDING)!
  const path = projectTrack(crossing, frame)
  const steps = path.slice(1).map((node, index) => Math.abs(node.x - path[index]!.x))
  const longest = Math.max(...steps)
  const shortest = Math.min(...steps)
  check('the crossing does not become a giant jump', longest / shortest < 1.5, `${longest.toFixed(2)} vs ${shortest.toFixed(2)}`)
  check('the track advances monotonically eastwards', path.every((node, index) => index === 0 || node.x > path[index - 1]!.x))
}

console.log('two tracks share one frame')
{
  const before: TrackPoint[] = [{ lat: 10, lon: 179.9 }, { lat: 10, lon: -179.9 }]
  const after: TrackPoint[] = [{ lat: 10, lon: -179.9 }, { lat: 10, lon: 179.9 }]
  const frame = buildPlanFrame([before, after], WIDTH, HEIGHT, PADDING)!
  const projectedAfter = projectTrack(after, frame)
  check('the second track is framed beside the first, not a turn away', projectedAfter.every((node) => node.x >= 0 && node.x <= WIDTH), projectedAfter.map((node) => node.x.toFixed(0)).join(','))
}

console.log('degenerate input')
{
  check('an empty track has no frame', buildPlanFrame([[]], WIDTH, HEIGHT, PADDING) === null)
  check('non-finite coordinates produce no frame', buildPlanFrame([[{ lat: Number.NaN, lon: 0 }]], WIDTH, HEIGHT, PADDING) === null)
  const stationary = buildPlanFrame([[{ lat: 5, lon: 5 }, { lat: 5, lon: 5 }]], WIDTH, HEIGHT, PADDING)
  check('a stationary track still frames without dividing by zero', stationary !== null && Number.isFinite(stationary.scale))
  const single = projectPoint({ lat: 5, lon: 5 }, stationary!)
  check('a single point lands in the middle', single !== null && Math.abs(single.x - WIDTH / 2) < 1 && Math.abs(single.y - HEIGHT / 2) < 1)
}

console.log('display downsampling')
{
  check('a short track is drawn whole', planStride(500, 2000) === 1)
  check('a long track is thinned', planStride(10_000, 2000) === 5)
  const dense: TrackPoint[] = Array.from({ length: 10_000 }, (_, index) => ({ lat: 40 + index * 1e-5, lon: -75 + index * 1e-5 }))
  const frame = buildPlanFrame([dense], WIDTH, HEIGHT, PADDING)!
  const path = projectTrack(dense, frame, 2000)
  check('the thinned path respects the budget', path.length <= 2001, `${path.length}`)
  check('the final sample is always drawn', path[path.length - 1]!.sourceIndex === dense.length - 1)
}

console.log('scale bar')
{
  const frame = buildPlanFrame([[{ lat: 40, lon: -75 }, { lat: 40.01, lon: -75.01 }]], WIDTH, HEIGHT, PADDING)!
  const bar = niceScaleBarMeters(frame)
  check('the scale bar is a round number', [1, 2, 5].includes(bar / 10 ** Math.floor(Math.log10(bar))), `${bar}`)
  check('the scale bar fits inside the frame', bar * frame.scale < WIDTH)
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll plan-projection checks passed.')
