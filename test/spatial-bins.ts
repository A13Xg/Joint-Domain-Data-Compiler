// Spatial binning is the reusable half of the density overlay, so it is tested
// on its own: equal-area cell shape, seam safety, and the guards.

import type { TrackPoint } from '../src/core/model.ts'
import { binTrack } from '../src/core/metrics/spatialBins.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function throws(name: string, run: () => unknown, match?: RegExp): void {
  try {
    run()
    check(name, false, 'did not throw')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    check(name, match ? match.test(message) : true, match ? message : '')
  }
}

// ------------------------------------------------------------------- counting

// Twenty samples in one place and one sample far away: the hot cell must carry
// all twenty, and be the maximum.
const clustered: TrackPoint[] = [
  ...Array.from({ length: 20 }, (_, index) => ({ lat: 40 + index * 1e-6, lon: -75 + index * 1e-6 })),
  { lat: 41, lon: -74 },
]
const clusteredBins = binTrack(clustered, 500)
check('Bins into two distinct cells', clusteredBins.cells.length === 2, `${clusteredBins.cells.length}`)
check('The hot cell holds every clustered sample', clusteredBins.max === 20, `${clusteredBins.max}`)
check('Counts sum to the input point count', clusteredBins.cells.reduce((total, cell) => total + cell.count, 0) === clustered.length)
check('Cells are ordered ascending by count so the busiest paint last', clusteredBins.cells.every((cell, index, all) => index === 0 || cell.count >= all[index - 1]!.count))
check('Every cell bound is a real coordinate', clusteredBins.cells.every((cell) => cell.south >= -90 && cell.north <= 90 && cell.west >= -180 && cell.west <= 180 && cell.east >= -180 && cell.east <= 180))
check('Each cell brackets its own points', clusteredBins.cells.every((cell) => cell.north > cell.south))

// ------------------------------------------------------------------ equal area

// At 60°N a degree of longitude is half the ground distance it is at the
// equator, so an equal-area cell must be about twice as wide in degrees.
const equator = binTrack([{ lat: 0, lon: 0 }], 1000)
const high = binTrack([{ lat: 60, lon: 0 }], 1000)
const equatorWidth = equator.cells[0]!.east - equator.cells[0]!.west
const highWidth = high.cells[0]!.east - high.cells[0]!.west
check('Cells widen in degrees with latitude to stay equal-area', highWidth > equatorWidth * 1.9 && highWidth < equatorWidth * 2.1, `${equatorWidth.toFixed(5)}° vs ${highWidth.toFixed(5)}°`)
check('Cell height in degrees does not change with latitude', Math.abs((equator.cells[0]!.north - equator.cells[0]!.south) - (high.cells[0]!.north - high.cells[0]!.south)) < 1e-9)

// --------------------------------------------------------------- antimeridian

// A continuous pass straddling 180°. Raw longitudes jump 179.9 → −179.9, which
// unwrapping must absorb; otherwise this scatters into cells half a globe
// apart and the hotspot disappears.
const seam: TrackPoint[] = []
for (let step = 0; step < 40; step++) {
  const lon = 179.98 + step * 0.001
  seam.push({ lat: 0, lon: lon > 180 ? lon - 360 : lon })
}
const seamBins = binTrack(seam, 5000)
check('A seam-crossing pass stays in a handful of adjacent cells', seamBins.cells.length <= 3, `${seamBins.cells.length} cells`)
check('Seam cells report wrapped longitudes', seamBins.cells.every((cell) => cell.west >= -180 && cell.west <= 180))
check('Seam counts still sum to the input', seamBins.cells.reduce((total, cell) => total + cell.count, 0) === seam.length)

// The same points binned without any seam crossing must produce the same
// number of cells, which is what proves the seam handling is doing work.
const shifted = seam.map((point) => ({ lat: point.lat, lon: point.lon > 0 ? point.lon - 179.98 : point.lon + 180.02 }))
const shiftedBins = binTrack(shifted, 5000)
check('The seam crossing bins the same as an equivalent run away from it', seamBins.cells.length === shiftedBins.cells.length, `${seamBins.cells.length} vs ${shiftedBins.cells.length}`)

// -------------------------------------------------------------------- guards

const empty = binTrack([], 500)
check('An empty track yields no cells and a zero maximum', empty.cells.length === 0 && empty.max === 0)

// Non-finite coordinates are skipped rather than binned into a NaN cell.
const dirty = binTrack([{ lat: Number.NaN, lon: 0 }, { lat: 0, lon: Number.POSITIVE_INFINITY }, { lat: 10, lon: 10 }], 500)
check('Non-finite coordinates are skipped', dirty.cells.length === 1 && dirty.max === 1)

// A pole-adjacent reference latitude must not blow the longitude cell up
// without limit — cos(89.999°) is near zero.
const polar = binTrack([{ lat: 89.999, lon: 0 }, { lat: 89.998, lon: 100 }], 1000)
check('Polar latitudes produce finite cell bounds', polar.cells.every((cell) => Number.isFinite(cell.west) && Number.isFinite(cell.east)))

throws('Rejects a zero cell size', () => binTrack(clustered, 0), /greater than 0/)
throws('Rejects a negative cell size', () => binTrack(clustered, -100), /greater than 0/)
throws('Rejects a non-finite cell size', () => binTrack(clustered, Number.NaN), /finite/)

// The invariant that makes a cell budget unnecessary: however small the cell,
// occupied cells cannot outnumber the points, which the parsers already cap.
const spread: TrackPoint[] = Array.from({ length: 2000 }, (_, index) => ({ lat: -80 + index * 0.08, lon: -179 + index * 0.17 }))
const tiny = binTrack(spread, 0.01)
check('A tiny cell size cannot produce more cells than points', tiny.cells.length <= spread.length, `${tiny.cells.length} cells from ${spread.length} points`)
check('A tiny cell size still bins every point', tiny.cells.reduce((total, cell) => total + cell.count, 0) === spread.length)

console.log(`\n${failures === 0 ? 'ALL SPATIAL BIN CHECKS PASSED' : `${failures} SPATIAL BIN CHECK(S) FAILED`}`)
if (failures > 0) process.exit(1)
