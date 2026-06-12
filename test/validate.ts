// Conversion correctness & compatibility test harness.
//
// Run with:  node --experimental-strip-types test/validate.ts
//
// Verifies:
//   1. Exported GPX validates against the official GPX 1.1 XSD (xmllint).
//   2. <trkpt> child elements follow the schema-mandated order (cmt before desc).
//   3. CSV / GeoJSON / KML exports are produced and structurally sound.
//   4. GPB binary container round-trips losslessly.
//   5. GeoJSON re-import reproduces the point count.
//
// Exits non-zero on any failure so it can gate CI / packaging.
import { execSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Dataset, TrackPoint } from '../src/core/model.ts'
import { exportDataset } from '../src/core/exporters/index.ts'
import { buildGpb, parseGpb } from '../src/core/parsers/gpb.ts'
import { parseGeoJson } from '../src/core/parsers/geojson.ts'

// Resolve the bundled GPX 1.1 schema relative to the working dir (repo root),
// or via an explicit override, so the test runs regardless of bundle location.
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

// xmllint is the gold-standard validator but is not present on every CI runner
// (notably Windows). When absent we skip those checks rather than fail the gate.
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
      lon: -122.349 + i * 0.0004 * (i % 2 === 0 ? 1 : 1),
      ele: 100 + Math.sin(i / 10) * 50,
      time: base + i * 1000,
      name: i % 50 === 0 ? `WP-${i}` : undefined,
      desc: i % 50 === 0 ? 'checkpoint & "marker" <tagged>' : undefined,
      ext: { sat: 8 + (i % 4), hdop: 0.8 + (i % 3) * 0.1, heading_deg: (i * 3) % 360, custom_chan: i },
    })
  }
  // Intentionally include an out-of-range point to confirm it is skipped.
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

// XSD schema validation via xmllint.
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

// Child-order: cmt must precede desc within a trkpt.
const cmtIdx = gpx.text.indexOf('<cmt>')
const descIdx = gpx.text.indexOf('<desc>')
check('GPX <cmt> precedes <desc> (schema order)', cmtIdx >= 0 && descIdx >= 0 && cmtIdx < descIdx)

// ele precedes time precedes name across a sample point.
const sample = gpx.text.slice(gpx.text.indexOf('<trkpt'), gpx.text.indexOf('</trkpt>'))
check('GPX <ele> precedes <time>', sample.indexOf('<ele>') < sample.indexOf('<time>'))

// out-of-range point skipped.
check('Out-of-range point skipped', gpx.warnings.some((w) => w.includes('out of range')), gpx.warnings.join('; '))

// --- CSV / GeoJSON / KML ---------------------------------------------------
const csv = exportDataset(dataset, 'csv')
check('CSV exported', csv.text.split('\r\n').length > 200 && csv.text.startsWith('latitude,longitude'))

const geojson = exportDataset(dataset, 'geojson')
const geoPath = join(dir, 'out.geojson')
writeFileSync(geoPath, geojson.text)
let geoOk = false
try {
  const parsed = JSON.parse(geojson.text)
  geoOk = parsed.type === 'FeatureCollection' && parsed.features.length >= 1
} catch { /* ignore */ }
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
check(
  'GPB round-trips coordinates within float tolerance',
  Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lon - b.lon) < 1e-9,
)
check('GPB preserves channels', reparsed.channels.includes('heading_deg') && b.ext?.heading_deg !== undefined)

// --- GeoJSON re-import -----------------------------------------------------
const reimport = parseGeoJson(geojson.text)
check('GeoJSON re-import yields points', reimport.points.length >= 200, `${reimport.points.length} points`)

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
