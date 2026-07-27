import { strict as assert } from 'node:assert'
import './helpers/linkedomShim.ts'
import type { Dataset, TrackPoint } from '../src/core/model.ts'
import { parseGeoJson } from '../src/core/parsers/geojson.ts'
import { parseGpx } from '../src/core/parsers/gpx.ts'
import { parseKml } from '../src/core/parsers/kml.ts'
import { parseNmea } from '../src/core/parsers/nmea.ts'
import { dedupe, dropInvalid, shiftTime, simplify, smooth, sortByTime, swapLatLon } from '../src/core/transforms.ts'
import { buildProjectManifest, createProjectArchive, parseProjectArchive, serializeProjectArchive } from '../src/persistence/project/archive.ts'
import { EMPTY_WORKSPACE_SELECTION } from '../src/core/selection.ts'

const ITERATIONS = 160
let state = 0x4a444443
const random = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0
  return state / 0x1_0000_0000
}
const between = (min: number, max: number) => min + random() * (max - min)

for (let iteration = 0; iteration < ITERATIONS; iteration++) {
  const points = randomTrack(2 + Math.floor(random() * 80))
  const snapshot = structuredClone(points)

  const swappedTwice = swapLatLon(swapLatLon(points).points).points
  assert.equal(JSON.stringify(swappedTwice), JSON.stringify(points), 'swapping latitude/longitude twice must be a semantic identity')

  const shiftedBack = shiftTime(shiftTime(points, 25).points, -25).points
  assert.equal(JSON.stringify(shiftedBack), JSON.stringify(points), 'opposite time shifts must round-trip')

  const sorted = sortByTime(points).points.filter((point) => point.time !== undefined)
  assert.ok(sorted.every((point, index) => index === 0 || point.time! >= sorted[index - 1]!.time!), 'timed sort output must be monotonic')

  const valid = dropInvalid(points).points
  assert.ok(valid.every((point) => point.lat >= -90 && point.lat <= 90 && point.lon >= -180 && point.lon <= 180), 'dropInvalid must retain only normalized coordinates')

  const simplified = simplify(valid, between(0, 500)).points
  assert.ok(simplified.length <= valid.length, 'simplification cannot add points')
  if (valid.length >= 2) {
    assert.deepEqual(simplified[0], valid[0], 'simplification must preserve the first point')
    assert.deepEqual(simplified.at(-1), valid.at(-1), 'simplification must preserve the last point')
  }

  const smoothed = smooth(valid, 1 + Math.floor(random() * 12), { coords: true, elevation: true }).points
  assert.equal(smoothed.length, valid.length, 'smoothing must preserve point count')
  assert.ok(smoothed.every((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon)), 'smoothing must emit finite coordinates')

  const deduped = dedupe(valid, between(0, 25)).points
  assert.ok(deduped.length <= valid.length, 'dedupe cannot add points')
  assert.deepEqual(points, snapshot, 'pure transforms must never mutate their input')
}

for (let iteration = 0; iteration < ITERATIONS; iteration++) {
  const positions = Array.from({ length: Math.floor(random() * 30) }, () => (
    random() < 0.18
      ? [random() < 0.5 ? 'bad' : null]
      : [between(-180, 180), between(-90, 90), between(-500, 15_000)]
  ))
  const parsed = parseGeoJson(JSON.stringify({
    type: 'Feature',
    properties: { iteration, label: `seed-${iteration}` },
    geometry: { type: 'LineString', coordinates: positions },
  }))
  assert.ok(parsed.points.length <= positions.length, 'GeoJSON fuzz parse cannot amplify positions')
  assert.ok(parsed.points.every((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon)), 'GeoJSON fuzz parse emits finite coordinates')
}

const textParsers = [parseGpx, parseKml, parseNmea]
const alphabet = '<>/":,[]{}ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 \n'
for (let iteration = 0; iteration < 80; iteration++) {
  const text = Array.from({ length: Math.floor(random() * 600) }, () => alphabet[Math.floor(random() * alphabet.length)]).join('')
  for (const parser of textParsers) {
    try {
      const result = parser(text)
      assert.ok(result.points.length <= 1_000, 'bounded parser fuzz input cannot produce unbounded point output')
    } catch (error) {
      assert.ok(error instanceof Error && !/TypeError/.test(error.name), 'malformed parser input may be rejected only with an intentional domain error')
    }
  }
}

const archiveDataset: Dataset = {
  id: 'fuzz-track',
  name: 'Fuzz track',
  sourceFormat: 'gpx',
  points: [{ lat: 1, lon: 2, time: 3 }],
  warnings: [],
  channels: [],
  createdAt: 4,
}
const manifest = buildProjectManifest({
  datasets: [archiveDataset],
  activeDatasetId: archiveDataset.id,
  activeTab: 'overview',
  selection: { ...EMPTY_WORKSPACE_SELECTION, datasetId: archiveDataset.id },
  applicationVersion: '0.1.0',
})
const archive = createProjectArchive({ manifest, datasets: [archiveDataset], histories: {} })
interface MutableFuzzArchive {
  schema: string
  schemaVersion: number
  datasets: Array<{ id: string; points: Array<{ lat: number }> }>
  histories: Record<string, unknown>
  manifest: { view: { activeDatasetId: string | null } }
}
const mutations: Array<(value: MutableFuzzArchive) => void> = [
  (value) => { value.schema = 'wrong' },
  (value) => { value.schemaVersion = 99 },
  (value) => { value.datasets[0].id = 'mismatch' },
  (value) => { value.datasets[0].points[0].lat = Number.NaN },
  (value) => { value.histories.ghost = { past: [], future: [] } },
  (value) => { value.manifest.view.activeDatasetId = 'missing' },
]
for (const mutate of mutations) {
  const corrupted = JSON.parse(serializeProjectArchive(archive)) as MutableFuzzArchive
  mutate(corrupted)
  assert.throws(() => parseProjectArchive(JSON.stringify(corrupted)), 'corrupted archive mutation must be rejected')
}

console.log(`PROPERTY/FUZZ CHECKS PASSED (${ITERATIONS} transform tracks, ${ITERATIONS} GeoJSON documents, 240 text parser inputs, ${mutations.length} archive corruptions)`)

function randomTrack(length: number): TrackPoint[] {
  let time = 1_700_000_000_000
  return Array.from({ length }, (_, index) => {
    time += Math.floor(between(-500, 2_000))
    const invalid = random() < 0.08
    return {
      lat: invalid ? between(91, 150) : between(-89, 89),
      lon: invalid ? between(181, 260) : between(-179, 179),
      ele: between(-500, 15_000),
      time: random() < 0.12 ? undefined : time,
      ext: { sample: index },
    }
  })
}
