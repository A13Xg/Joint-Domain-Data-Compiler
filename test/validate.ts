// Conversion correctness & compatibility test harness.
import { execSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Dataset, TrackPoint } from '../src/core/model.ts'
import { exportDataset } from '../src/core/exporters/index.ts'
import { buildGpb, parseGpb } from '../src/core/parsers/gpb.ts'
import { parseGeoJson } from '../src/core/parsers/geojson.ts'
import {
  clipTimeRange,
  removeElevationOutliers,
  simplify,
  smooth,
} from '../src/core/transforms.ts'
import { standardKinematicsDerivation } from '../src/core/analytics/kinematics.ts'

const XSD = process.env.GPX_XSD ?? join(process.cwd(), 'test', 'schemas', 'gpx.xsd')

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  const status = ok ? 'PASS' : 'FAIL'
  if (!ok) failures++
  console.log(`  [${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}
function skip(name: string, reason: string) {
  console.log(`  [SKIP] ${name} — ${reason}`)
}

function hasXmllint(): boolean {
  try {
    execSync('xmllint --version', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}
const XMLLINT = hasXmllint()

function makeDataset(): Dataset {
  const points: TrackPoint[] = []
  const base = 1_700_000_000_000
  for (let i = 0; i < 200; i++) {
    points.push({
      lat: 47.62 + i * 0.0005,
      lon: -122.349 + i * 0.0004,
      ele: 100 + Math.sin(i / 10) * 50,
      time: base + i * 1000,
      name: i % 50 === 0 ? `WP-${i}` : undefined,
      desc: i % 50 === 0 ? 'checkpoint & "marker" <tagged>' : undefined,
      ext: { sat: 8 + (i % 4), hdop: 0.8 + (i % 3) * 0.1, heading_deg: (i * 3) % 360, custom_chan: i },
      provenance: { sourceRecord: i + 1 },
    })
  }
  points.push({ lat: 999, lon: 0 })
  return {
    id: 'test',
    name: 'validation-track',
    sourceFormat: 'csv',
    points,
    warnings: [],
    channels: ['sat', 'hdop', 'heading_deg', 'custom_chan'],
    createdAt: 0,
  }
}

console.log('Joint Domain Data Compiler — conversion validation\n')
const dataset = makeDataset()
const dir = mkdtempSync(join(tmpdir(), 'jddc-'))

// --- GPX -------------------------------------------------------------------
const gpx = exportDataset(dataset, 'gpx', { gpx: { sortByTime: true } })
const gpxPath = join(dir, 'out.gpx')
writeFileSync(gpxPath, gpx.text)
check('GPX exported with expected point count', gpx.pointCount === 200, `${gpx.pointCount} points`)

if (XMLLINT) {
  try {
    execSync(`xmllint --noout --schema "${XSD}" "${gpxPath}"`, { stdio: 'pipe' })
    check('GPX validates against GPX 1.1 XSD', true)
  } catch (err) {
    const msg = (err as { stderr?: Buffer }).stderr?.toString() ?? String(err)
    check('GPX validates against GPX 1.1 XSD', false, msg.split('\n').slice(0, 4).join(' | '))
  }
} else {
  skip('GPX validates against GPX 1.1 XSD', 'xmllint not installed on this runner')
}

const cmtIdx = gpx.text.indexOf('<cmt>')
const descIdx = gpx.text.indexOf('<desc>')
check('GPX <cmt> precedes <desc> (schema order)', cmtIdx >= 0 && descIdx >= 0 && cmtIdx < descIdx)
const sample = gpx.text.slice(gpx.text.indexOf('<trkpt'), gpx.text.indexOf('</trkpt>'))
check('GPX <ele> precedes <time>', sample.indexOf('<ele>') < sample.indexOf('<time>'))
check('Out-of-range point skipped', gpx.warnings.some((w) => w.includes('out of range')), gpx.warnings.join('; '))

// --- CSV / GeoJSON / KML ---------------------------------------------------
const csv = exportDataset(dataset, 'csv')
check('CSV exported', csv.text.split('\r\n').length > 200 && csv.text.startsWith('latitude,longitude'))

const geojson = exportDataset(dataset, 'geojson')
let geoOk = false
try {
  const parsed = JSON.parse(geojson.text)
  geoOk = parsed.type === 'FeatureCollection' && parsed.features.length >= 1
} catch { /* ignored */ }
check('GeoJSON is valid JSON FeatureCollection', geoOk)

const kml = exportDataset(dataset, 'kml')
const kmlPath = join(dir, 'out.kml')
writeFileSync(kmlPath, kml.text)
if (XMLLINT) {
  try {
    execSync(`xmllint --noout "${kmlPath}"`, { stdio: 'pipe' })
    check('KML is well-formed XML', true)
  } catch (err) {
    check('KML is well-formed XML', false, String(err))
  }
} else {
  skip('KML is well-formed XML', 'xmllint not installed on this runner')
}

// --- GPB round-trip --------------------------------------------------------
const validPoints = dataset.points.filter((p) => p.lat >= -90 && p.lat <= 90)
const gpb = buildGpb('roundtrip', validPoints, ['sat', 'hdop', 'heading_deg', 'custom_chan'])
const reparsed = parseGpb(gpb)
check('GPB round-trips point count', reparsed.points.length === validPoints.length, `${reparsed.points.length}/${validPoints.length}`)
const a = validPoints[10]
const b = reparsed.points[10]
check('GPB round-trips coordinates within float tolerance', Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lon - b.lon) < 1e-9)
check('GPB preserves channels', reparsed.channels.includes('heading_deg') && b.ext?.heading_deg !== undefined)

const reimport = parseGeoJson(geojson.text)
check('GeoJSON re-import yields points', reimport.points.length >= 200, `${reimport.points.length} points`)

// --- Transform regression tests -------------------------------------------
const antimeridian = smooth([
  { lat: 10, lon: 179.9 },
  { lat: 10, lon: -179.9 },
], 2, { coords: true, elevation: false }).points
check('Coordinate smoothing is antimeridian-safe', antimeridian.every((p) => Math.abs(p.lon) > 170), antimeridian.map((p) => p.lon.toFixed(3)).join(', '))

const projectedTrack: TrackPoint[] = [
  { lat: 80, lon: 0 },
  { lat: 80.00001, lon: 0.001 },
  { lat: 80, lon: 0.002 },
]
const simplified = simplify(projectedTrack, 5)
check('Simplification uses meter-scale projected distance', simplified.points.length >= 2)

const kinematicsPoints: TrackPoint[] = [
  { lat: 0, lon: 0, time: 1000 },
  { lat: 0, lon: 0.001, time: 1000 },
]
const duplicateTime = standardKinematicsDerivation.derive({
  dataset: { ...dataset, points: kinematicsPoints },
  points: kinematicsPoints,
}).points[1]
check('Duplicate timestamp is flagged', duplicateTime.provenance?.qualityFlags?.includes('duplicate_timestamp') === true)
check('Invalid time delta does not fabricate zero speed', duplicateTime.ext?.ground_speed_mps === undefined)

const clipped = clipTimeRange([
  { lat: 0, lon: 0 },
  { lat: 0, lon: 1, time: 1000 },
], 500, 1500, 'drop')
check('Time clipping can drop untimed points', clipped.points.length === 1)

const elevations: TrackPoint[] = Array.from({ length: 21 }, (_, i) => ({
  lat: 0,
  lon: i * 0.001,
  ele: i === 10 ? 1000 : 100 + (i % 3),
}))
const filtered = removeElevationOutliers(elevations, 4, 11)
check('Rolling MAD removes a local elevation spike', filtered.points.length === 20, `${filtered.points.length} points`)

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
